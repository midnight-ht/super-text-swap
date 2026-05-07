let currentRules = [];
let observer = null;
let processedMark = new WeakMap();
let uiLang = 'zh_CN';

const SKIP_TAGS = new Set([
  'SCRIPT', 'STYLE', 'NOSCRIPT', 'IFRAME',
  'TEXTAREA', 'INPUT', 'CODE', 'PRE', 'SELECT', 'OPTION',
]);

// ── i18n: load pick-mode strings from _locales ─────────
let uiMessages = {};

async function loadUIMessages(locale) {
  try {
    const url = chrome.runtime.getURL(`_locales/${locale}/messages.json`);
    uiMessages = await (await fetch(url)).json();
  } catch {
    uiMessages = {};
  }
}

const msg = (key, sub) => {
  let str = uiMessages[key]?.message ?? key;
  if (sub !== undefined) str = str.replace(/\$[A-Z_]+\$/g, sub);
  return str;
  return typeof v === 'function' ? v(arg) : v;
};

// ── URL scope matching ─────────────────────────────────
function matchesCurrentUrl(rule) {
  const scope = rule.scope;
  if (!scope?.urlMode || scope.urlMode === 'all') return true;

  if (scope.urlMode === 'domain') {
    const pattern = (scope.urlPattern || '').trim();
    if (!pattern) return true;
    const host = location.hostname;
    return host === pattern || host.endsWith('.' + pattern);
  }

  if (scope.urlMode === 'custom') {
    const pattern = (scope.urlPattern || '').trim();
    if (!pattern) return true;
    try {
      const re = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
      return new RegExp(re).test(location.href);
    } catch {
      return location.href.includes(pattern);
    }
  }

  return true;
}

// ── Load rules + language ──────────────────────────────
async function loadRules() {
  const [syncResult, localResult] = await Promise.all([
    chrome.storage.sync.get(['rules']),
    chrome.storage.local.get(['lang']),
  ]);
  uiLang = localResult.lang || 'zh_CN';
  currentRules = (syncResult.rules || []).filter(
    r => r.enabled && r.from && matchesCurrentUrl(r)
  );
  await loadUIMessages(uiLang);
}

// ── Node filtering ─────────────────────────────────────
function shouldSkipNode(node) {
  const parent = node.parentElement;
  if (!parent) return true;
  if (SKIP_TAGS.has(parent.tagName)) return true;
  if (parent.isContentEditable) return true;
  return false;
}

// ── Apply rules to text (with per-rule DOM scope) ──────
function applyRules(text, anchorEl, ruleSet) {
  let result = text;
  for (const rule of ruleSet) {
    if (!rule.from) continue;
    if (rule.scope?.domSelector) {
      try {
        if (!anchorEl?.closest(rule.scope.domSelector)) continue;
      } catch { continue; }
    }
    if (rule.type === 'regex') {
      try { result = result.replace(new RegExp(rule.from, 'g'), rule.to || ''); } catch {}
    } else {
      result = result.split(rule.from).join(rule.to || '');
    }
  }
  return result;
}

// ── Replace a single text node ─────────────────────────
function replaceTextNode(node) {
  if (shouldSkipNode(node)) return;
  const original = node.nodeValue;
  if (!original || !original.trim()) return;
  if (processedMark.get(node) === original) return;

  const anchor   = node.parentElement;
  const replaced = applyRules(original, anchor, currentRules);
  if (replaced !== original) {
    node.nodeValue = replaced;
    processedMark.set(node, replaced);
  } else {
    processedMark.set(node, original);
  }
}

// ── Walk DOM text nodes ────────────────────────────────
function walkAndReplace(root = document.body) {
  if (!root) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: node =>
      shouldSkipNode(node) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  });
  let node;
  while ((node = walker.nextNode())) replaceTextNode(node);
}

// ── Input / textarea replacement ───────────────────────
function replaceInInputs() {
  const inputRules = currentRules.filter(r => r.scope?.includeInputs);
  if (!inputRules.length) return;
  const sel = 'input[type="text"],input[type="search"],input[type="email"],input[type="url"],input:not([type]),textarea';
  document.querySelectorAll(sel).forEach(el => {
    if (!el.value) return;
    const replaced = applyRules(el.value, el, inputRules);
    if (replaced !== el.value) el.value = replaced;
  });
}

// ── Contenteditable (rich text) replacement ────────────
function replaceInEditables() {
  const editableRules = currentRules.filter(r => r.scope?.includeEditable);
  if (!editableRules.length) return;
  document.querySelectorAll('[contenteditable="true"]').forEach(editable => {
    const walker = document.createTreeWalker(editable, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const original = node.nodeValue;
      if (!original || !original.trim()) continue;
      const replaced = applyRules(original, node.parentElement, editableRules);
      if (replaced !== original) node.nodeValue = replaced;
    }
  });
}

// ── MutationObserver with throttle ────────────────────
let mutationTimer = null;
const pendingNodes = [];

function flushPendingNodes() {
  mutationTimer = null;
  const batch = pendingNodes.splice(0);
  for (const node of batch) {
    if (node.nodeType === Node.TEXT_NODE)    replaceTextNode(node);
    else if (node.nodeType === Node.ELEMENT_NODE) walkAndReplace(node);
  }
}

function observePageChanges() {
  if (observer) observer.disconnect();
  observer = new MutationObserver(mutations => {
    for (const m of mutations) for (const n of m.addedNodes) pendingNodes.push(n);
    if (!mutationTimer) mutationTimer = setTimeout(flushPendingNodes, 50);
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

// ── Full refresh ───────────────────────────────────────
async function refresh() {
  await loadRules();
  processedMark = new WeakMap();
  walkAndReplace();
  replaceInInputs();
  replaceInEditables();
  observePageChanges();
}

// ══════════════════════════════════════════════════════
// Element Picker
// ══════════════════════════════════════════════════════
let pickMode    = false;
let pickHighlight = null;

function generateSelector(el) {
  if (!el || el === document.body) return 'body';
  if (el.id) return `#${CSS.escape(el.id)}`;

  const classes = Array.from(el.classList).filter(c => c.length > 1 && !/^\d/.test(c));
  if (classes.length) {
    return el.tagName.toLowerCase() + classes.slice(0, 2).map(c => `.${CSS.escape(c)}`).join('');
  }

  const segments = [];
  let node = el;
  while (node && node !== document.documentElement && segments.length < 4) {
    if (node.id) { segments.unshift(`#${CSS.escape(node.id)}`); break; }
    const tag = node.tagName.toLowerCase();
    const cls = Array.from(node.classList)
      .filter(c => c.length > 1 && !/^\d/.test(c))
      .slice(0, 1).map(c => `.${CSS.escape(c)}`).join('');
    segments.unshift(cls ? `${tag}${cls}` : tag);
    node = node.parentElement;
  }
  return segments.join(' > ') || el.tagName.toLowerCase();
}

function showPageToast(text) {
  document.getElementById('__textswap_toast__')?.remove();
  const el = document.createElement('div');
  el.id = '__textswap_toast__';
  el.style.cssText = [
    'position:fixed','bottom:24px','left:50%','transform:translateX(-50%)',
    'background:rgba(0,0,0,0.82)','color:#fff','padding:8px 18px',
    'border-radius:8px','font-size:13px','z-index:2147483647',
    'font-family:system-ui,sans-serif','pointer-events:none',
    'white-space:nowrap','max-width:90vw','overflow:hidden','text-overflow:ellipsis',
  ].join(';');
  el.textContent = text;
  document.body.appendChild(el);
  setTimeout(() => el?.remove(), 3000);
}

function onPickMouseMove(e) {
  if (!pickHighlight || e.target === pickHighlight) return;
  const r = e.target.getBoundingClientRect();
  Object.assign(pickHighlight.style, {
    top: `${r.top}px`, left: `${r.left}px`,
    width: `${r.width}px`, height: `${r.height}px`,
  });
}

function onPickClick(e) {
  if (e.target === pickHighlight) return;
  e.preventDefault();
  e.stopPropagation();
  exitPickMode(generateSelector(e.target));
}

function onPickKeyDown(e) {
  if (e.key === 'Escape') exitPickMode(null);
}

function enterPickMode() {
  if (pickMode) return;
  pickMode = true;
  document.body.style.cursor = 'crosshair';

  pickHighlight = document.createElement('div');
  pickHighlight.style.cssText = [
    'position:fixed','pointer-events:none',
    'border:2px solid #2563eb',
    'background:rgba(37,99,235,0.1)',
    'border-radius:3px','z-index:2147483646',
    'transition:top 0.05s,left 0.05s,width 0.05s,height 0.05s',
    'box-shadow:0 0 0 2000px rgba(0,0,0,0.18)',
  ].join(';');
  document.body.appendChild(pickHighlight);

  document.addEventListener('mousemove', onPickMouseMove, true);
  document.addEventListener('click',     onPickClick,     true);
  document.addEventListener('keydown',   onPickKeyDown,   true);

  showPageToast(msg('pickPrompt'));
}

async function exitPickMode(selector) {
  pickMode = false;
  document.body.style.cursor = '';
  pickHighlight?.remove();
  pickHighlight = null;
  document.removeEventListener('mousemove', onPickMouseMove, true);
  document.removeEventListener('click',     onPickClick,     true);
  document.removeEventListener('keydown',   onPickKeyDown,   true);

  if (selector) {
    await chrome.storage.local.set({ pendingSelector: selector });
    showPageToast(msg('pickDone', selector));
  } else {
    showPageToast(msg('pickCancel'));
  }
}

// ── Temporary apply (one-shot, not saved) ─────────────
// Applies caller-supplied rules directly to the current page state.
// Does not touch currentRules or processedMark, so a subsequent
// refresh() will restore the page to saved-rules-only state.
function applyTempRules(tempRules) {
  if (!tempRules?.length) return;
  const active = tempRules.filter(r => r.enabled && r.from && matchesCurrentUrl(r));
  if (!active.length) return;

  // Regular text nodes
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode: node =>
      shouldSkipNode(node) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  });
  let node;
  while ((node = walker.nextNode())) {
    const original = node.nodeValue;
    if (!original || !original.trim()) continue;
    const replaced = applyRules(original, node.parentElement, active);
    if (replaced !== original) node.nodeValue = replaced;
  }

  // Input / textarea
  const inputRules = active.filter(r => r.scope?.includeInputs);
  if (inputRules.length) {
    const sel = 'input[type="text"],input[type="search"],input[type="email"],' +
                'input[type="url"],input:not([type]),textarea';
    document.querySelectorAll(sel).forEach(el => {
      if (!el.value) return;
      const replaced = applyRules(el.value, el, inputRules);
      if (replaced !== el.value) el.value = replaced;
    });
  }

  // Contenteditable
  const editableRules = active.filter(r => r.scope?.includeEditable);
  if (editableRules.length) {
    document.querySelectorAll('[contenteditable="true"]').forEach(editable => {
      const w = document.createTreeWalker(editable, NodeFilter.SHOW_TEXT);
      let n;
      while ((n = w.nextNode())) {
        const original = n.nodeValue;
        if (!original || !original.trim()) continue;
        const replaced = applyRules(original, n.parentElement, editableRules);
        if (replaced !== original) n.nodeValue = replaced;
      }
    });
  }
}

// ── Message listener ───────────────────────────────────
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'TEXT_SWAP_RULES_UPDATED') refresh();
  if (message.type === 'TEXT_SWAP_PICK_START')
    loadRules().then(enterPickMode);
  if (message.type === 'TEXT_SWAP_APPLY_TEMP')
    applyTempRules(message.rules);
});

refresh();
