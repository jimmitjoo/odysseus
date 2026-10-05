// crisp.js: lokal förfining (jimmitjoo/odysseus local/sv-search).
//
// 1. Enhetlig stängning. Fönster stängs via många vägar (Esc, X, minimera,
//    verktygens egna close-funktioner) som alla slutar i `.modal.hidden`.
//    Bara några få animerar ut själva. När ett fönster får `hidden` utan att
//    redan ha animerat, behåller vi det synligt med `.crisp-exit` medan
//    innehållet tonar ut. `hidden` står kvar, så appens logik ser fönstret
//    som stängt, och öppnas det igen avbryts uttoningen direkt.
//
// 2. Fokus i modala dialoger (WCAG 2.4.3 / 2.1.2). För synliga
//    [role="dialog"][aria-modal="true"]: flytta in fokus när dialogen öppnas,
//    håll Tab inne i den, och lämna tillbaka fokus till det som öppnade den.

const EXIT_MS = 170;
const PRE_ANIMATED_WINDOW_MS = 600;   // fönster som själva just animerat ut
const FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])', 'textarea:not([disabled])', '[tabindex]:not([tabindex="-1"])',
  '[contenteditable="true"]',
].join(',');

const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// ── 1. Stängningsanimation ────────────────────────────────────────────
// Web Animations API i stället för CSS-klasser: verktygen sätter egna
// inline-stilar och !important-regler som annars vinner. `scale` och
// `translate` är egna egenskaper, så fönstrets egen transform (position
// efter dragning) lämnas orörd.

const exits = new WeakMap();

function fadeOut(el) {
  return el.animate(
    [{ opacity: 1 }, { opacity: 0, scale: '0.975', translate: '0 4px' }],
    { duration: EXIT_MS, easing: 'cubic-bezier(0.4, 0, 1, 1)', fill: 'forwards' },
  );
}

function startExit(modal) {
  const content = modal.querySelector('.modal-content');
  if (!content || reduceMotion()) return;
  if ((performance.now() - (content._crispSelfAnimatedAt || 0)) < PRE_ANIMATED_WINDOW_MS) return;
  modal.classList.add('crisp-exit');
  const anim = fadeOut(content);
  const done = () => { modal.classList.remove('crisp-exit'); anim.cancel(); exits.delete(modal); };
  anim.onfinish = done;
  exits.set(modal, done);
}

function cancelExit(modal) {
  const done = exits.get(modal);
  if (done) done();
}

// Några verktyg (Email, Compare, Deep Research) tar bort fönstret ur DOM:en
// när det stängs. Lägg in en livlös kopia som tonar ut i dess ställe.
function ghostExit(node, parent, next) {
  if (reduceMotion() || !parent.isConnected) return;
  // Id:n behålls (originalet är redan borta) eftersom fönstrens placering
  // styrs av id-regler. Öppnas fönstret igen tas kopian bort direkt.
  const ghost = node.cloneNode(true);
  ghost.classList.add('crisp-ghost');
  if (node.id) ghosts.set(node.id, ghost);
  ghost.setAttribute('aria-hidden', 'true');
  ghost.inert = true;
  parent.insertBefore(ghost, next && next.parentNode === parent ? next : null);
  const anim = fadeOut(ghost.querySelector('.modal-content') || ghost);
  anim.onfinish = anim.oncancel = () => { ghost.remove(); if (ghosts.get(node.id) === ghost) ghosts.delete(node.id); };
}
const ghosts = new Map();   // id -> kopia som tonar ut

// Mobilmenyn göms med bredd 0 direkt. Håll den synlig medan den glider ut.
const mobile = window.matchMedia('(max-width: 768px)');
function drawerExit(sidebar, wasRight) {
  if (!mobile.matches || reduceMotion()) return;
  sidebar.classList.add('crisp-drawer-exit');
  const anim = sidebar.animate(
    [{ translate: '0 0', '--crisp-drawer-op': 1 }, { translate: (wasRight ? '24px' : '-24px') + ' 0', '--crisp-drawer-op': 0 }],
    { duration: EXIT_MS, easing: 'cubic-bezier(0.4, 0, 1, 1)', fill: 'forwards' },
  );
  const done = () => { sidebar.classList.remove('crisp-drawer-exit'); anim.cancel(); };
  anim.onfinish = done;
  sidebar._crispDrawerExit = done;
}

// ── 2. Fokus i modala dialoger ────────────────────────────────────────

const isShown = el => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
const openDialogs = new Map();   // dialog -> element som hade fokus innan

function topDialog() {
  const shown = [...openDialogs.keys()].filter(isShown);
  return shown[shown.length - 1] || null;
}

function syncDialogs() {
  for (const dlg of document.querySelectorAll('[role="dialog"][aria-modal="true"]')) {
    const visible = isShown(dlg) && !dlg.closest('.modal.hidden');
    if (visible && !openDialogs.has(dlg)) {
      openDialogs.set(dlg, document.activeElement);
      if (!dlg.contains(document.activeElement)) {
        const target = dlg.querySelector('[autofocus]') || dlg;
        if (target === dlg && !dlg.hasAttribute('tabindex')) dlg.setAttribute('tabindex', '-1');
        target.focus({ preventScroll: true });
      }
    } else if (!visible && openDialogs.has(dlg)) {
      const opener = openDialogs.get(dlg);
      openDialogs.delete(dlg);
      const focusLost = !document.activeElement || document.activeElement === document.body
        || dlg.contains(document.activeElement) || document.activeElement.id === 'message';
      if (focusLost && opener && opener.isConnected && isShown(opener)) opener.focus({ preventScroll: true });
    }
  }
  for (const dlg of [...openDialogs.keys()]) if (!dlg.isConnected) openDialogs.delete(dlg);
}

document.addEventListener('keydown', e => {
  if (e.key !== 'Tab') return;
  const dlg = topDialog();
  if (!dlg) return;
  const items = [...dlg.querySelectorAll(FOCUSABLE)].filter(isShown);
  if (!items.length) { e.preventDefault(); dlg.focus(); return; }
  const first = items[0], last = items[items.length - 1];
  const active = document.activeElement;
  if (!dlg.contains(active)) { e.preventDefault(); (e.shiftKey ? last : first).focus(); }
  else if (e.shiftKey && (active === first || active === dlg)) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
}, true);

// ── 3. Läsbara verktygsnamn ───────────────────────────────────────────
// Agentens tidslinje visar råa namn (manage_memory, mcp__builtin_browser__
// browser_navigate). Visa vanlig text, behåll originalet i data-raw så att
// export och kopiering av chatten är oförändrade.

const TOOL_LABELS = {
  web_search: 'Web search', web_fetch: 'Read web page', fetch_url: 'Read web page',
  manage_memory: 'Memory', update_memory: 'Memory', search_memory: 'Search memory',
  read_file: 'Read file', write_file: 'Write file', edit_file: 'Edit file', list_files: 'List files',
  bash: 'Terminal', python: 'Python', manage_calendar: 'Calendar', manage_email: 'Email',
  search_chats: 'Search chats', ask_user: 'Question', get_workspace: 'Workspace',
  generate_image: 'Generate image', manage_notes: 'Notes', manage_tasks: 'Automations',
};

function humanizeTool(raw) {
  const key = raw.trim();
  const known = TOOL_LABELS[key.toLowerCase()];
  if (known) return known;
  if (!/[_]/.test(key) && key !== key.toUpperCase()) return key;   // redan läsbart, t.ex. "Writing"
  const name = key.replace(/^mcp__(.+?)__/, (_, server) => server.replace(/^builtin_/, '') + ' ');
  const words = name.toLowerCase().split(/[_\s]+/).filter(Boolean);
  const deduped = words.filter((w, i) => w !== words[i - 1]);      // "browser browser navigate"
  const text = deduped.join(' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function humanizeIn(root) {
  const els = root.matches?.('.agent-thread-tool') ? [root] : root.querySelectorAll?.('.agent-thread-tool') || [];
  for (const el of els) {
    if (el.dataset.raw && el.textContent === el.dataset.crispLabel) continue;
    const raw = el.textContent;
    const label = humanizeTool(raw);
    if (label === raw) continue;
    el.dataset.raw = raw;
    el.dataset.crispLabel = label;
    el.textContent = label;
  }
}

// ── 4. Kontrastnivåer per tema (WCAG AA) ──────────────────────────────
// En fast blandning räcker inte: "dark" klarar 4.5:1 med 73 % fg, "light"
// behöver 90 %. Räkna fram lägsta blandning mot temats faktiska ytor och
// sätt --ink-2 / --ink-3 / --accent-ink. crisp.css har reservvärden.

const cv = document.createElement('canvas'); cv.width = cv.height = 1;
const cx = cv.getContext('2d', { willReadFrequently: true });
const rgb = c => { cx.clearRect(0, 0, 1, 1); cx.fillStyle = '#000'; cx.fillStyle = c; cx.fillRect(0, 0, 1, 1); return cx.getImageData(0, 0, 1, 1).data; };
const lum = c => { const d = rgb(c); const f = x => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(d[0]) + 0.7152 * f(d[1]) + 0.0722 * f(d[2]); };
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

let themeKey = '';
function tuneInk() {
  const cs = getComputedStyle(document.documentElement);
  const v = n => cs.getPropertyValue(n).trim();
  const fg = v('--fg'), bg = v('--bg'), panel = v('--panel'), red = v('--red');
  const key = [fg, bg, panel, red].join('|');
  if (!fg || !bg || key === themeKey) return;
  themeKey = key;
  const surfaces = [bg, panel || bg, `color-mix(in oklab, ${fg} 8%, ${bg})`];
  const worst = c => Math.min(...surfaces.map(s => ratio(c, s)));
  const least = (mk, need, from, to) => { for (let x = from; x <= to; x++) if (worst(mk(x)) >= need) return x; return to; };
  const ink = x => `color-mix(in oklab, ${fg} ${x}%, ${bg})`;
  const accent = x => `color-mix(in oklab, ${red || fg} ${x}%, ${fg})`;
  const root = document.documentElement.style;
  root.setProperty('--ink-2', ink(least(ink, 4.6, 60, 100)));
  root.setProperty('--ink-3', ink(least(ink, 3.1, 45, 100)));
  root.setProperty('--accent-ink', accent(100 - least(x => accent(100 - x), 4.6, 0, 100)));
  root.setProperty('--ink-pole', lum(bg) > 0.18 ? '#000' : '#fff');
}

// ── 6. Läsbara scheman i Automations ──────────────────────────────────
// "Cron: 0 */2 * * *" -> "Every 2 hours". Originalet ligger kvar i title.

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const pad = n => String(n).padStart(2, '0');

function humanizeCron(expr) {
  const f = expr.trim().split(/\s+/);
  if (f.length !== 5) return null;
  const [m, h, dom, mon, dow] = f;
  const isNum = x => /^\d+$/.test(x);
  const step = x => (x.match(/^\*\/(\d+)$/) || [])[1];
  if (dom !== '*' || mon !== '*') return null;
  const times = () => (isNum(m) && /^\d+(,\d+)*$/.test(h))
    ? h.split(',').map(x => `${pad(x)}:${pad(m)}`) : null;
  const join = arr => arr.length < 2 ? arr[0] : arr.slice(0, -1).join(', ') + ' and ' + arr[arr.length - 1];
  if (dow === '*') {
    if (m === '*' && h === '*') return 'Every minute';
    if (step(m) && h === '*') return step(m) === '1' ? 'Every minute' : `Every ${step(m)} minutes`;
    if (isNum(m) && h === '*') return m === '0' ? 'Every hour' : `Every hour at :${pad(m)}`;
    if (isNum(m) && step(h)) return step(h) === '1' ? 'Every hour' : `Every ${step(h)} hours`;
    const t = times(); if (t) return `Daily at ${join(t)}`;
    return null;
  }
  const t = times();
  if (t && /^[0-6](,[0-6])*$/.test(dow)) return `${join(dow.split(',').map(d => DAYS[+d]))} at ${join(t)}`;
  if (t && dow === '1-5') return `Weekdays at ${join(t)}`;
  return null;
}

function humanizeSchedules(root) {
  const metas = root.querySelectorAll ? root.querySelectorAll('#tasks-modal .memory-item-meta') : [];
  for (const el of metas) {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const t = walker.currentNode;
      const m = t.nodeValue.match(/Cron:\s*([^·]+?)\s*(?=·|$)/);
      if (!m) continue;
      const nice = humanizeCron(m[1]);
      if (!nice) continue;
      t.nodeValue = t.nodeValue.replace(m[0], nice + ' ');
      el.title = 'Cron: ' + m[1].trim();
    }
  }
}

// ── 5. Sidofältets grupper ────────────────────────────────────────────
// Verktygslistan har inte längre någon rubrik att fälla ihop med, så ett
// sparat "ihopfällt" läge får inte dölja den.
function keepToolsOpen() {
  const sec = document.getElementById('tools-section');
  if (sec && sec.classList.contains('collapsed')) sec.classList.remove('collapsed');
}
document.addEventListener('click', e => {
  if (e.target.closest('#settings-open-theme')) document.getElementById('tool-theme-btn')?.click();
});

// ── Observatör ────────────────────────────────────────────────────────

let syncQueued = false;
const observer = new MutationObserver(records => {
  const addedIds = new Set();
  for (const r of records) for (const n of r.addedNodes) {
    if (n.nodeType !== 1 || !n.id || n.classList.contains('crisp-ghost')) continue;
    addedIds.add(n.id);
    ghosts.get(n.id)?.remove();
  }
  for (const r of records) {
    const t = r.target;
    if (r.type === 'childList') {
      for (const n of r.addedNodes) if (n.nodeType === 1) { humanizeIn(n); humanizeSchedules(n.parentElement || n); }
      if (t.nodeType === 1 && t.classList.contains('agent-thread-tool')) humanizeIn(t);
      for (const n of r.removedNodes) {
        if (n.nodeType !== 1 || n.classList.contains('crisp-ghost')) continue;
        const isWindow = n.classList.contains('modal') || (n.id && /-(modal|overlay)$/.test(n.id));
        if (!isWindow || n.classList.contains('hidden') || !n.querySelector('.modal-content, [class*="-pane"]')) continue;
        if (n.id && addedIds.has(n.id)) continue;   // omritning, inte stängning
        ghostExit(n, t, r.nextSibling);
      }
      continue;
    }
    if (r.attributeName !== 'class' || !(t instanceof Element)) continue;
    const had = (r.oldValue || '').split(/\s+/);
    if (t.classList.contains('modal-content') && t.classList.contains('modal-closing') && !had.includes('modal-closing')) {
      t._crispSelfAnimatedAt = performance.now();
    }
    if (t.classList.contains('sidebar')) {
      const hidNow = t.classList.contains('hidden');
      if (hidNow && !had.includes('hidden')) drawerExit(t, had.includes('right-side'));
      else if (!hidNow && had.includes('hidden')) t._crispDrawerExit?.();
    }
    if (t.classList.contains('modal')) {
      const nowHidden = t.classList.contains('hidden');
      if (nowHidden && !had.includes('hidden')) startExit(t);
      else if (!nowHidden && had.includes('hidden')) cancelExit(t);
    }
  }
  if (!syncQueued) { syncQueued = true; requestAnimationFrame(() => { syncQueued = false; syncDialogs(); tuneInk(); keepToolsOpen(); }); }
});
observer.observe(document.documentElement, {
  subtree: true, childList: true, attributes: true, attributeOldValue: true, attributeFilter: ['class', 'style', 'hidden'],
});
humanizeIn(document.body);
tuneInk();
keepToolsOpen();

// Självtest: node --input-type=module -e "import('./static/js/crisp.js')" körs inte i node
// (DOM krävs), så logiken testas via window.__crispSelfTest() i webbläsaren.
window.__crispSelfTest = () => {
  const cron = { '0 */2 * * *': 'Every 2 hours', '0 6,18 * * *': 'Daily at 06:00 and 18:00', '0 * * * *': 'Every hour',
    '*/15 * * * *': 'Every 15 minutes', '30 8 * * 1-5': 'Weekdays at 08:30', '0 9 * * 1': 'Monday at 09:00', '0 0 1 * *': null,
    '0 */1 * * *': 'Every hour', '*/1 * * * *': 'Every minute' };
  const cronOk = Object.entries(cron).map(([i, want]) => [i, humanizeCron(i), humanizeCron(i) === want]);
  const cases = {
    manage_memory: 'Memory', MANAGE_MEMORY: 'Memory', Writing: 'Writing',
    mcp__builtin_browser__browser_navigate: 'Browser navigate', some_new_tool: 'Some new tool',
  };
  return Object.entries(cases).map(([i, want]) => [i, humanizeTool(i), humanizeTool(i) === want]).concat(cronOk);
};
