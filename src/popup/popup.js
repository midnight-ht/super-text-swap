// ── i18n ──────────────────────────────────────────────
// All strings live in _locales/{locale}/messages.json.
// We load the file manually so the in-popup language toggle
// can override the browser's own locale at runtime.

let messages = {};
let lang = 'zh_CN';

async function loadMessages(locale) {
  const url = chrome.runtime.getURL(`_locales/${locale}/messages.json`);
  const res  = await fetch(url);
  messages   = await res.json();
}

// Substitute a single positional value into $PLACEHOLDER$ slots
function t(key, sub) {
  let str = messages[key]?.message ?? key;
  if (sub !== undefined) str = str.replace(/\$[A-Z_]+\$/g, sub);
  return str;
}

// ── State ──────────────────────────────────────────────
let rules = [];
let currentHostname = '';

// ── DOM refs ───────────────────────────────────────────
const q = id => document.getElementById(id);
const fromInput         = q('fromInput');
const toInput           = q('toInput');
const rulesList         = q('rulesList');
const rulesCount        = q('rulesCount');
const toast             = q('toast');
const advancedSection   = q('advancedSection');
const toggleIcon        = q('toggleIcon');
const domainLabel       = q('domainLabel');
const customUrlRow      = q('customUrlRow');
const urlPatternInput   = q('urlPatternInput');
const domSelectorInput  = q('domSelectorInput');
const includeInputsCb   = q('includeInputs');
const includeEditableCb = q('includeEditable');

// ── Toast ──────────────────────────────────────────────
let toastTimer = null;
function showToast(msg) {
  toast.textContent = msg;
  toast.classList.add('show');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 1800);
}

// ── Security ───────────────────────────────────────────
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Apply translations to DOM ──────────────────────────
function applyTranslations() {
  const setText = (id, key, sub) => {
    const el = q(id);
    if (el) el.textContent = t(key, sub);
  };
  const setPh = (id, key) => {
    const el = q(id);
    if (el) el.placeholder = t(key);
  };

  setText('langToggleBtn',       'langToggle');
  setText('applyBtn',            'applyBtn');
  setText('headerSubtitle',      'subtitle');
  setText('fromLabel',           'fromLabel');
  setPh  ('fromInput',           'fromPh');
  setText('toLabel',             'toLabel');
  setPh  ('toInput',             'toPh');
  setText('advancedToggleText',  'advancedTitle');
  setText('urlScopeLabel',       'urlScopeLabel');
  setText('urlAll',              'urlAll');
  setText('urlDomainText',       'urlDomain');
  setText('urlCustomText',       'urlCustom');
  setPh  ('urlPatternInput',     'urlPh');
  setText('domScopeLabel',       'domScopeLabel');
  setPh  ('domSelectorInput',    'domPh');
  setText('pickBtn',             'pickBtn');
  setText('targetLabel',         'targetLabel');
  setText('includeInputsLabel',  'includeInputsLabel');
  setText('includeEditableLabel','includeEditableLabel');
  setText('addBtn',              'addBtn');
  setText('clearBtn',            'clearBtn');
  setText('rulesTitle',          'rulesTitle');

  renderRules();
}

// ── Language toggle ────────────────────────────────────
async function toggleLang() {
  lang = lang === 'zh_CN' ? 'en' : 'zh_CN';
  await Promise.all([
    chrome.storage.local.set({ lang }),
    loadMessages(lang),
  ]);
  applyTranslations();
}

// ── Advanced panel toggle ──────────────────────────────
q('advancedToggle').addEventListener('click', () => {
  const isOpen = advancedSection.classList.toggle('open');
  toggleIcon.classList.toggle('open', isOpen);
});

document.querySelectorAll('input[name="urlMode"]').forEach(radio => {
  radio.addEventListener('change', () => {
    const mode = document.querySelector('input[name="urlMode"]:checked').value;
    customUrlRow.style.display = mode === 'custom' ? 'block' : 'none';
  });
});

// ── Current tab hostname ───────────────────────────────
chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
  if (!tab?.url) return;
  try {
    currentHostname = new URL(tab.url).hostname;
    if (currentHostname) domainLabel.textContent = ` (${currentHostname})`;
  } catch {}
});

// ── Pending selector from element picker ──────────────
async function checkPendingSelector() {
  const result = await chrome.storage.local.get(['pendingSelector']);
  if (!result.pendingSelector) return;
  await chrome.storage.local.remove(['pendingSelector']);
  advancedSection.classList.add('open');
  toggleIcon.classList.add('open');
  domSelectorInput.value = result.pendingSelector;
  showToast(t('toastSelectorFilled', result.pendingSelector));
}

// ── Element picker ─────────────────────────────────────
q('pickBtn').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) { showToast(t('toastNoPage')); return; }

  const sendPick = () =>
    chrome.tabs.sendMessage(tab.id, { type: 'TEXT_SWAP_PICK_START' });

  try {
    await sendPick();
  } catch {
    // Content script not yet injected (tab opened before extension loaded).
    // Inject it first, then retry the message.
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['src/content/content.js'],
      });
      await sendPick();
    } catch {
      showToast(t('toastNoPick'));
      return;
    }
  }

  window.close();
});

// ── Apply to current tab ───────────────────────────────
async function applyToCurrentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) { showToast(t('toastNoPage')); return; }
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'TEXT_SWAP_RULES_UPDATED' });
    showToast(t('toastApplied'));
  } catch {
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['src/content/content.js'],
      });
      showToast(t('toastApplied'));
    } catch {
      showToast(t('toastNoInject'));
    }
  }
}

// ── Render ─────────────────────────────────────────────
function getScopeBadgesHtml(rule) {
  if (!rule.scope) return '';
  const { urlMode, urlPattern, domSelector, includeInputs, includeEditable } = rule.scope;
  const parts = [];
  if ((urlMode === 'domain' || urlMode === 'custom') && urlPattern)
    parts.push(`<span class="badge badge-url">${escapeHtml(urlPattern)}</span>`);
  if (domSelector)
    parts.push(`<span class="badge badge-dom">${escapeHtml(domSelector)}</span>`);
  if (includeInputs)
    parts.push(`<span class="badge badge-target">${t('badgeInput')}</span>`);
  if (includeEditable)
    parts.push(`<span class="badge badge-target">${t('badgeEditable')}</span>`);
  return parts.length ? `<div class="rule-badges">${parts.join('')}</div>` : '';
}

function renderRules() {
  rulesCount.textContent = `${rules.length}${t('countSuffix')}`;

  if (rules.length === 0) {
    rulesList.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📝</div>
        <div>${t('rulesEmpty')}</div>
      </div>`;
    return;
  }

  rulesList.innerHTML = rules.map((rule, index) => `
    <div class="rule-item">
      <div class="rule-main">
        <span class="rule-from" title="${escapeHtml(rule.from)}">${escapeHtml(rule.from)}</span>
        <span class="rule-arrow">→</span>
        <span class="rule-to"   title="${escapeHtml(rule.to)}">${escapeHtml(rule.to)}</span>
        <button class="rule-delete" data-index="${index}">×</button>
      </div>
      ${getScopeBadgesHtml(rule)}
    </div>
  `).join('');

  rulesList.querySelectorAll('.rule-delete').forEach(btn => {
    btn.addEventListener('click', e => deleteRule(parseInt(e.target.dataset.index, 10)));
  });
}

// ── Rule CRUD ──────────────────────────────────────────
function generateId() {
  return 'rule_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
}

function readScopeFromForm() {
  const urlMode = document.querySelector('input[name="urlMode"]:checked')?.value || 'all';
  let urlPattern = '';
  if (urlMode === 'domain')      urlPattern = currentHostname;
  else if (urlMode === 'custom') urlPattern = urlPatternInput.value.trim();

  const domSelector     = domSelectorInput.value.trim();
  const includeInputs   = includeInputsCb.checked;
  const includeEditable = includeEditableCb.checked;
  const hasScope = urlMode !== 'all' || domSelector || includeInputs || includeEditable;

  return hasScope ? { urlMode, urlPattern, domSelector, includeInputs, includeEditable } : null;
}

function resetForm() {
  fromInput.value = '';
  toInput.value   = '';
  document.querySelector('input[name="urlMode"][value="all"]').checked = true;
  customUrlRow.style.display = 'none';
  urlPatternInput.value      = '';
  domSelectorInput.value     = '';
  includeInputsCb.checked    = false;
  includeEditableCb.checked  = false;
  fromInput.focus();
}

async function saveRules() {
  await chrome.storage.sync.set({ rules });
}

async function addRule() {
  const from = fromInput.value.trim();
  const to   = toInput.value.trim();
  if (!from) { showToast(t('toastFromRequired')); fromInput.focus(); return; }
  if (rules.find(r => r.from === from)) { showToast(t('toastExists')); return; }

  const now = Date.now();
  rules.push({
    id: generateId(), from, to, type: 'plain', enabled: true,
    scope: readScopeFromForm(), createdAt: now, updatedAt: now,
  });
  await saveRules();
  renderRules();
  resetForm();
  showToast(t('toastAdded'));
  applyToCurrentTab();
}

async function deleteRule(index) {
  rules.splice(index, 1);
  await saveRules();
  renderRules();
  showToast(t('toastDeleted'));
  applyToCurrentTab();
}

async function clearRules() {
  if (!rules.length) { showToast(t('toastNoRules')); return; }
  rules = [];
  await saveRules();
  renderRules();
  showToast(t('toastCleared'));
  applyToCurrentTab();
}

// ── Event listeners ────────────────────────────────────
q('addBtn').addEventListener('click', addRule);
q('clearBtn').addEventListener('click', clearRules);
q('applyBtn').addEventListener('click', applyToCurrentTab);
q('langToggleBtn').addEventListener('click', toggleLang);
fromInput.addEventListener('keydown', e => { if (e.key === 'Enter') toInput.focus(); });
toInput.addEventListener('keydown',   e => { if (e.key === 'Enter') addRule(); });

// ── Init ───────────────────────────────────────────────
(async () => {
  const [syncResult, localResult] = await Promise.all([
    chrome.storage.sync.get(['rules']),
    chrome.storage.local.get(['lang']),
  ]);
  rules = syncResult.rules || [];
  lang  = localResult.lang || 'zh_CN';

  await loadMessages(lang);
  applyTranslations();
  await checkPendingSelector();
})();
