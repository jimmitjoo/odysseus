#!/usr/bin/env bash
# Uppdaterar Odysseus till senaste origin/dev med våra lokala fixar ovanpå
# (branch local/sv-search). Rullar tillbaka automatiskt om något går sönder.
#
#   ./update-odysseus.sh            uppdatera
#   ./update-odysseus.sh --dry-run  bara visa vad som kommer in
set -euo pipefail
cd "$(dirname "$0")"

IMG=ghcr.io/odysseus-dev/odysseus:latest
BRANCH=local/sv-search
# Regressionstester för våra fixar: språkpinnen + åäö-tokens (#6411) och PDF-extraktionen (#6493).
GUARD_TESTS="${GUARD_TESTS:-tests/test_service_search_provider_guards.py tests/test_web_fetch_size_caps.py}"

log() { printf '\n==> %s\n' "$*"; }
die() { printf '\nFEL: %s\n' "$*" >&2; exit 1; }

[ "$(git branch --show-current)" = "$BRANCH" ] || die "står inte på $BRANCH"
[ -z "$(git status --porcelain --untracked-files=no)" ] || die "ocommittade ändringar i trackade filer, committa eller städa först"

git fetch -q origin
OLD=$(git rev-parse HEAD)
log "Nytt i origin/dev: $(git rev-list --count HEAD..origin/dev) commits"
log "Våra lokala commits:"; git log --oneline origin/dev..HEAD
[ "${1:-}" = "--dry-run" ] && exit 0

rollback() {
  log "Rullar tillbaka till $OLD"
  git rebase --abort 2>/dev/null || true
  git reset -q --hard "$OLD"
  docker image inspect odysseus:rollback >/dev/null 2>&1 && docker tag odysseus:rollback "$IMG"
  docker compose up -d >/dev/null 2>&1
  die "$1 (gamla versionen kör igen)"
}

log "Backup"
B=~/backups/odysseus-$(date +%F-%H%M)
mkdir -p "$B"; echo "$OLD" > "$B/commit.txt"
docker tag "$IMG" odysseus:rollback
docker compose stop >/dev/null 2>&1
tar czf "$B/files.tgz" .env docker-compose.override.yml config data logs
for v in chromadb-data ntfy-cache searxng-data tailscale-state; do
  docker run --rm -v "odysseus_$v":/v:ro -v "$B":/b alpine tar czf "/b/vol-$v.tgz" -C /v .
done
docker compose up -d >/dev/null 2>&1
echo "backup: $B"

log "Rebase på origin/dev"
git rebase -q origin/dev || rollback "rebase-konflikt, en upstream-ändring krockar med våra fixar"
log "Kvarvarande lokala commits (de som upstream redan har tappas automatiskt):"
git log --oneline origin/dev..HEAD

log "Bygger"
docker compose build -q odysseus || docker compose build -q odysseus || rollback "bygget misslyckades"

log "Regressionstester i nya imagen"
docker run --rm --entrypoint "" -v "$PWD":/w -w /w -e HOME=/tmp "$IMG" \
  python -m pytest -q -p no:cacheprovider $GUARD_TESTS || rollback "regressionstesterna failar"

log "Driftsätter"
docker compose up -d >/dev/null 2>&1 || rollback "compose up misslyckades"
sleep 15

log "Röktest"
[ "$(docker compose exec -T odysseus printenv SEARXNG_LANGUAGE 2>/dev/null)" = all ] \
  || rollback "SEARXNG_LANGUAGE når inte containern"
n=$(docker compose exec -T odysseus python -c '
from services.search.providers import searxng_search_api
print(len(searxng_search_api("Kalmar slott öppettider", count=3)))' 2>/dev/null | tail -1)
[ "${n:-0}" -gt 0 ] || rollback "SearXNG ger inga träffar"
code=$(docker compose exec -T odysseus python -c '
import urllib.request,urllib.error
try: print(urllib.request.urlopen("http://localhost:7000/",timeout=10).status)
except urllib.error.HTTPError as e: print(e.code)' 2>/dev/null | tail -1)
case "$code" in 2*|3*|401) ;; *) rollback "appen svarar inte (HTTP $code)";; esac

log "Klart: $(git log -1 --format='%h %s')"
