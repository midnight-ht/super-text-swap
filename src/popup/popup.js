// ── Punctuation presets ────────────────────────────────
// Applied as temporary rules (not saved).
// zh: non-quote rules only; " and ' pairing handled by applyZhQuoteParser in content.js.
// en: all Chinese/fullwidth punctuation collapsed to ASCII equivalents.
// All non-ASCII in string values use \u escapes to avoid encoding-normalization issues.
const PUNCT_PRESETS = {
  zh: [
    { from: '...', to: '……' }, // ... -> ……
    { from: '--',  to: '——' }, // -- -> ——
    { from: '(',   to: '（' },        // ( -> （
    { from: ')',   to: '）' },        // ) -> ）
    { from: '[',   to: '【' },        // [ -> 【
    { from: ']',   to: '】' },        // ] -> 】
    { from: '{',   to: '｛' },        // { -> ｛
    { from: '}',   to: '｝' },        // } -> ｝
    { from: '<',   to: '〈' },        // < -> 〈
    { from: '>',   to: '〉' },        // > -> 〉
    { from: ',',   to: '，', smart: true },  // , -> ，  (skip digit,digit)
    { from: '.',   to: '。', smart: true },  // . -> 。  (skip word.word)
    { from: '!',   to: '！' },        // ! -> ！
    { from: '?',   to: '？' },        // ? -> ？
    { from: ':',   to: '：', smart: true },  // : -> ：  (skip proto://)
    { from: ';',   to: '；' },        // ; -> ；
    { from: '~',   to: '～' },        // ~ -> ～
  ],
  en: [
    { from: '……', to: '...' },  // …… -> ...
    { from: '…',       to: '...' },  // … -> ...
    { from: '——', to: '--'  },  // —— -> --
    { from: '—',       to: '-'   },  // — -> -
    { from: '－',       to: '-'   },  // － -> -
    { from: '“',       to: '"'   },  // " -> "
    { from: '”',       to: '"'   },  // " -> "
    { from: '‘',       to: '\''  },  // ' -> '
    { from: '’',       to: '\''  },  // ' -> '
    { from: '「',       to: '"'   },  // 「 -> "
    { from: '」',       to: '"'   },  // 」 -> "
    { from: '『',       to: '\''  },  // 『 -> '
    { from: '』',       to: '\''  },  // 』 -> '
    { from: '《',       to: '<<'  },  // 《 -> <<
    { from: '》',       to: '>>'  },  // 》 -> >>
    { from: '〈',       to: '<'   },  // 〈 -> <
    { from: '〉',       to: '>'   },  // 〉 -> >
    { from: '〔',       to: '['   },  // 〔 -> [
    { from: '〕',       to: ']'   },  // 〕 -> ]
    { from: '（',       to: '('   },  // （ -> (
    { from: '）',       to: ')'   },  // ） -> )
    { from: '【',       to: '['   },  // 【 -> [
    { from: '】',       to: ']'   },  // 】 -> ]
    { from: '｛',       to: '{'   },  // ｛ -> {
    { from: '｝',       to: '}'   },  // ｝ -> }
    { from: '，',       to: ','   },  // ， -> ,
    { from: '。',       to: '.'   },  // 。 -> .
    { from: '！',       to: '!'   },  // ！ -> !
    { from: '？',       to: '?'   },  // ？ -> ?
    { from: '：',       to: ':'   },  // ： -> :
    { from: '；',       to: ';'   },  // ； -> ;
    { from: '、',       to: ','   },  // 、 -> ,
    { from: '～',       to: '~'   },  // ～ -> ~
    { from: '・',       to: '.'   },  // ・ -> .
    { from: '　',       to: ' '   },  // ideographic space -> space
  ],
};

// ── i18n ──────────────────────────────────────────────
// Strings are defined in _locales/{locale}/messages.json.
// We load via fetch so the in-popup toggle can override the browser locale.

let messages = {};
let lang = 'zh_CN';

async function loadMessages(locale) {
  const url = chrome.runtime.getURL(`_locales/${locale}/messages.json`);
  messages  = await (await fetch(url)).json();
}

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
const featureSection    = q('featureSection');
const featureToggleIcon = q('featureToggleIcon');
const domainLabel       = q('domainLabel');
const customUrlRow      = q('customUrlRow');
const urlPatternInput   = q('urlPatternInput');
const domSelectorInput  = q('domSelectorInput');
const includeInputsCb   = q('includeInputs');
const includeEditableCb = q('includeEditable');
const incrementEnabledCb = q('incrementEnabled');
const incrementMinInput  = q('incrementMin');
const incrementMaxInput  = q('incrementMax');
const refreshIncrementCb = q('refreshIncrement');

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
  const setText = (id, key, sub) => { const el = q(id); if (el) el.textContent = t(key, sub); };
  const setPh   = (id, key)      => { const el = q(id); if (el) el.placeholder  = t(key); };
  const setHtml = (id, key)      => { const el = q(id); if (el) el.innerHTML    = t(key); };

  setText('langToggleBtn',        'langToggle');
  setText('applyBtn',             'applyBtn');
  setText('headerSubtitle',       'subtitle');
  setText('fromLabel',            'fromLabel');
  setPh  ('fromInput',            'fromPh');
  setText('regexHelpBtn',         'regexHelpBtn');
  setHtml('regexHelpBubble',      'regexHelpHtml');
  setText('toLabel',              'toLabel');
  setPh  ('toInput',              'toPh');
  setText('featureToggleText',    'featureToggleText');
  setText('advancedToggleText',   'advancedTitle');
  setText('urlScopeLabel',        'urlScopeLabel');
  setText('urlAll',               'urlAll');
  setText('urlDomainText',        'urlDomain');
  setText('urlCustomText',        'urlCustom');
  setPh  ('urlPatternInput',      'urlPh');
  setText('domScopeLabel',        'domScopeLabel');
  setPh  ('domSelectorInput',     'domPh');
  setText('pickBtn',              'pickBtn');
  setText('targetLabel',          'targetLabel');
  setText('featureTitle',         'featureTitle');
  setText('includeInputsLabel',   'includeInputsLabel');
  setText('includeEditableLabel', 'includeEditableLabel');
  setText('incrementEnabledLabel','incrementEnabledLabel');
  setPh  ('incrementMin',         'incrementMinPh');
  setPh  ('incrementMax',         'incrementMaxPh');
  setText('refreshIncrementLabel','refreshIncrementLabel');
  setText('addBtn',               'addBtn');
  setText('clearBtn',             'clearBtn');
  setText('rulesTitle',           'rulesTitle');
  setText('quickLabel',           'quickLabel');
  setText('punctZhBtn',           'punctZhBtn');
  setText('punctEnBtn',           'punctEnBtn');
  setText('refreshIncrementBtn',  'refreshIncrementBtn');
  setText('helpTitle',            'helpTitle');
  setText('helpClose',            'helpClose');

  renderRules();
  if (q('helpModal').classList.contains('open')) renderHelpBody();
}

// ── Language toggle ────────────────────────────────────
async function toggleLang() {
  lang = lang === 'zh_CN' ? 'en' : 'zh_CN';
  await Promise.all([chrome.storage.local.set({ lang }), loadMessages(lang)]);
  applyTranslations();
}

// ── Advanced panel toggle ──────────────────────────────
q('advancedToggle').addEventListener('click', () => {
  const isOpen = advancedSection.classList.toggle('open');
  toggleIcon.classList.toggle('open', isOpen);
});

q('featureToggle').addEventListener('click', () => {
  const isOpen = featureSection.classList.toggle('open');
  featureToggleIcon.classList.toggle('open', isOpen);
});

document.querySelectorAll('input[name="urlMode"]').forEach(radio => {
  radio.addEventListener('change', () => {
    const mode = document.querySelector('input[name="urlMode"]:checked').value;
    customUrlRow.style.display = mode === 'custom' ? 'block' : 'none';
  });
});

// ── Help modal ─────────────────────────────────────────
function renderHelpBody() {
  const sections = [
    ['helpS1Title', 'helpS1Desc'],
    ['helpS2Title', 'helpS2Desc'],
    ['helpS3Title', 'helpS3Desc'],
    ['helpS4Title', 'helpS4Desc'],
    ['helpS5Title', 'helpS5Desc'],
    ['helpS6Title', 'helpS6Desc'],
    ['helpS7Title', 'helpS7Desc'],
  ];
  q('helpBody').innerHTML = sections.map(([tk, dk]) => `
    <div class="help-section">
      <div class="help-section-title">${escapeHtml(t(tk))}</div>
      <div class="help-section-desc">${escapeHtml(t(dk)).replace(/\n/g, '<br>')}</div>
    </div>
  `).join('');
}

function openHelp()  { renderHelpBody(); q('helpModal').classList.add('open'); }
function closeHelp() { q('helpModal').classList.remove('open'); }

q('helpBtn').addEventListener('click', openHelp);
q('helpClose').addEventListener('click', closeHelp);
q('helpModal').addEventListener('click', e => { if (e.target === q('helpModal')) closeHelp(); });

// ── Current tab hostname ───────────────────────────────
chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
  if (!tab?.url) return;
  try {
    currentHostname = new URL(tab.url).hostname;
    if (currentHostname) domainLabel.textContent = ` (${currentHostname})`;
  } catch {}
});

// ── Restore picker state on popup open ────────────────
// Called on init. Reads form data + picked selector saved before popup closed.
async function restorePickerState() {
  const result = await chrome.storage.local.get(['pendingFormState', 'pendingSelector']);
  if (!result.pendingFormState && !result.pendingSelector) return;

  // Restore form fields saved before the picker was launched
  if (result.pendingFormState) {
    const s = result.pendingFormState;
    fromInput.value  = s.from  || '';
    toInput.value    = s.to    || '';
    const radio = document.querySelector(`input[name="urlMode"][value="${s.urlMode || 'all'}"]`);
    if (radio) radio.checked = true;
    customUrlRow.style.display  = s.urlMode === 'custom' ? 'block' : 'none';
    urlPatternInput.value       = s.urlPattern  || '';
    includeInputsCb.checked     = !!s.includeInputs;
    includeEditableCb.checked   = !!s.includeEditable;
    incrementEnabledCb.checked  = !!s.incrementEnabled;
    incrementMinInput.value     = s.incrementMin || '';
    incrementMaxInput.value     = s.incrementMax || '';
    refreshIncrementCb.checked  = !!s.refreshIncrement;
    await chrome.storage.local.remove(['pendingFormState']);
  }

  // Fill picked selector and show confirmation
  if (result.pendingSelector) {
    advancedSection.classList.add('open');
    toggleIcon.classList.add('open');
    domSelectorInput.value = result.pendingSelector;
    await chrome.storage.local.remove(['pendingSelector']);
    showToast(t('toastSelectorFilled', result.pendingSelector));
  }
}

// ── Element picker ─────────────────────────────────────
q('pickBtn').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) { showToast(t('toastNoPage')); return; }

  // Persist current form data so it survives popup close/reopen
  await chrome.storage.local.set({
    pendingFormState: {
      from:            fromInput.value,
      to:              toInput.value,
      urlMode:         document.querySelector('input[name="urlMode"]:checked')?.value || 'all',
      urlPattern:      urlPatternInput.value,
      includeInputs:   includeInputsCb.checked,
      includeEditable: includeEditableCb.checked,
      incrementEnabled: incrementEnabledCb.checked,
      incrementMin:     incrementMinInput.value,
      incrementMax:     incrementMaxInput.value,
      refreshIncrement: refreshIncrementCb.checked,
    },
  });

  const sendPick = () =>
    chrome.tabs.sendMessage(tab.id, { type: 'TEXT_SWAP_PICK_START_V2' });
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['src/content/content.js'] });
    await sendPick();
  } catch {
    try {
      await sendPick();
    } catch {
      showToast(t('toastNoPick'));
      await chrome.storage.local.remove(['pendingFormState']);
      return;
    }
  }
  window.close();
});

// ── Punctuation preset apply ───────────────────────────
// Sends TEXT_SWAP_APPLY_PUNCT so content.js can:
//   - apply simple rules via applyTempRules
//   - run applyZhQuoteParser for stateful " ' pairing (zh direction only)
async function applyPunctPreset(type) {
  const scope = readScopeFromForm();
  const rules = PUNCT_PRESETS[type].map((pair, i) => ({
    id: '__punct_' + type + '_' + i + '__',
    from: pair.from,
    to: pair.to,
    type: 'plain',
    enabled: true,
    smart: !!pair.smart,
    scope,
  }));

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) { showToast(t('toastNoPage')); return; }

  const sendMsg = () =>
    chrome.tabs.sendMessage(tab.id, { type: 'TEXT_SWAP_APPLY_PUNCT', direction: type, rules, scope });

  try {
    await sendMsg();
    showToast(t('toastPunctApplied'));
  } catch {
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['src/content/content.js'] });
      await sendMsg();
      showToast(t('toastPunctApplied'));
    } catch {
      showToast(t('toastNoInject'));
    }
  }
}

// ── Apply Now — TEMPORARY (does not save to rules) ────
// Reads current form inputs + scope, applies once to the page.
// The effect resets on page refresh.
async function applyTemp() {
  const from = fromInput.value.trim();
  const to    = toInput.value.trim();
  const scope = readScopeFromForm();
  const valueTransform = readValueTransformFromForm();
  if (!from && !valueTransform) { showToast(t('toastTempFromRequired')); fromInput.focus(); return; }
  if (from && !isRegexValid(from)) { showToast(t('toastRegexInvalid')); fromInput.focus(); return; }
  if (incrementEnabledCb.checked && !valueTransform) {
    showToast(t('toastIncrementRangeRequired'));
    incrementMinInput.focus();
    return;
  }
  const tempRules = [];
  if (from) {
    tempRules.push({
      id: '__temp_text__',
      from,
      to,
      type: inferRuleType(from),
      enabled: true,
      scope,
    });
  }
  if (valueTransform) {
    tempRules.push({
      id: '__temp_number__',
      from: '',
      to: '',
      type: 'number',
      valueTransform,
      enabled: true,
      scope,
    });
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) { showToast(t('toastNoPage')); return; }

  const sendTemp = () =>
    chrome.tabs.sendMessage(tab.id, { type: 'TEXT_SWAP_APPLY_TEMP', rules: tempRules });

  try {
    await sendTemp();
    showToast(t('toastTempApplied'));
  } catch {
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['src/content/content.js'] });
      await sendTemp();
      showToast(t('toastTempApplied'));
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
  if (rule.type === 'regex')
    parts.push(`<span class="badge badge-mode">${t('badgeRegex')}</span>`);
  if (rule.type === 'number')
    parts.push(`<span class="badge badge-mode">${t('badgeNumberFeature')}</span>`);
  if (rule.valueTransform?.enabled)
    parts.push(`<span class="badge badge-mode">${t('badgeIncrement', formatIncrementRange(rule.valueTransform))}</span>`);
  if (rule.valueTransform?.refreshIncrement)
    parts.push(`<span class="badge badge-mode">${t('badgeRefreshIncrement')}</span>`);
  return parts.length ? `<div class="rule-badges">${parts.join('')}</div>` : '';
}

function getRuleBadgesHtml(rule) {
  const scopeHtml = getScopeBadgesHtml(rule);
  if (scopeHtml) return scopeHtml;
  const parts = [];
  if (rule.type === 'regex')
    parts.push(`<span class="badge badge-mode">${t('badgeRegex')}</span>`);
  if (rule.type === 'number')
    parts.push(`<span class="badge badge-mode">${t('badgeNumberFeature')}</span>`);
  if (rule.valueTransform?.enabled)
    parts.push(`<span class="badge badge-mode">${t('badgeIncrement', formatIncrementRange(rule.valueTransform))}</span>`);
  if (rule.valueTransform?.refreshIncrement)
    parts.push(`<span class="badge badge-mode">${t('badgeRefreshIncrement')}</span>`);
  return parts.length ? `<div class="rule-badges">${parts.join('')}</div>` : '';
}

function formatIncrementRange(config) {
  return `${config.min}~${config.max}`;
}

function renderRules() {
  rulesCount.textContent = `${rules.length}${t('countSuffix')}`;
  if (rules.length === 0) {
    rulesList.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">&#x1F4DD;</div>
        <div>${t('rulesEmpty')}</div>
      </div>`;
    return;
  }
  rulesList.innerHTML = rules.map((rule, index) => `
    <div class="rule-item">
      <div class="rule-main">
        <span class="rule-from" title="${escapeHtml(getRuleFromText(rule))}">${escapeHtml(getRuleFromText(rule))}</span>
        <span class="rule-arrow">&#x2192;</span>
        <span class="rule-to"   title="${escapeHtml(getRuleToText(rule))}">${escapeHtml(getRuleToText(rule))}</span>
        <button class="rule-delete" data-index="${index}">&#xD7;</button>
      </div>
      ${getRuleBadgesHtml(rule)}
    </div>
  `).join('');
  rulesList.querySelectorAll('.rule-delete').forEach(btn => {
    btn.addEventListener('click', e => deleteRule(parseInt(e.target.dataset.index, 10)));
  });
}

function getRuleFromText(rule) {
  return rule.type === 'number' ? t('numberRuleFrom') : rule.from;
}

function getRuleToText(rule) {
  if (rule.type === 'number') return formatIncrementRange(rule.valueTransform || {});
  return rule.to;
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

function looksLikeRegex(pattern) {
  return /\\[dDsSwWbB]|\[[^\]]+\]|\([^)]*\)|\{\d+(?:,\d*)?\}|[|^$+*?]/.test(pattern) || /(^|[^\\])\./.test(pattern);
}

function inferRuleType(pattern) {
  return looksLikeRegex(pattern) ? 'regex' : 'plain';
}

function isRegexValid(pattern) {
  if (!looksLikeRegex(pattern)) return true;
  try {
    new RegExp(pattern, 'g');
    return true;
  } catch {
    return false;
  }
}

function readValueTransformFromForm() {
  if (!incrementEnabledCb.checked) return null;
  const min = Number(incrementMinInput.value);
  const max = Number(incrementMaxInput.value);
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
  return { enabled: true, min, max, refreshIncrement: refreshIncrementCb.checked };
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
  incrementEnabledCb.checked = false;
  incrementMinInput.value    = '';
  incrementMaxInput.value    = '';
  refreshIncrementCb.checked = false;
  fromInput.focus();
}

async function saveRules() { await chrome.storage.sync.set({ rules }); }

async function notifyPageRefresh() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  // Ensure the content script is present (no-op if already injected), then
  // always tell it to re-apply. Re-injection itself is a no-op now that the
  // content script guards against duplicate instances, so the message is what
  // actually triggers the refresh.
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      files: ['src/content/content.js'],
    });
  } catch {}
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'TEXT_SWAP_RULES_UPDATED' });
  } catch {}
}

async function addRule() {
  const from = fromInput.value.trim();
  const to   = toInput.value.trim();
  const valueTransform = readValueTransformFromForm();
  if (!from && !valueTransform) { showToast(t('toastFromRequired')); fromInput.focus(); return; }
  if (from && !isRegexValid(from)) { showToast(t('toastRegexInvalid')); fromInput.focus(); return; }
  if (incrementEnabledCb.checked && !valueTransform) {
    showToast(t('toastIncrementRangeRequired'));
    incrementMinInput.focus();
    return;
  }
  if (!valueTransform && from && rules.find(r => r.from === from)) { showToast(t('toastExists')); return; }
  const now = Date.now();
  const scope = readScopeFromForm();
  if (valueTransform) {
    rules.push({ id: generateId(), from: '', to: '', type: 'number', enabled: true,
                 valueTransform, scope, createdAt: now, updatedAt: now });
  } else if (from) {
    rules.push({ id: generateId(), from, to, type: inferRuleType(from), enabled: true,
                 scope, createdAt: now, updatedAt: now });
  }
  await saveRules();
  if (valueTransform) await chrome.storage.local.set({ incrementCache: {} });
  renderRules();
  resetForm();
  showToast(t('toastAdded'));
  notifyPageRefresh();
}

async function refreshIncrementCache() {
  await chrome.storage.local.set({ incrementCache: {} });
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) {
    try {
      await chrome.tabs.sendMessage(tab.id, { type: 'TEXT_SWAP_INCREMENT_CACHE_CLEARED' });
    } catch {
      try {
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['src/content/content.js'] });
      } catch {}
    }
    chrome.tabs.reload(tab.id).catch(() => {});
  }
  showToast(t('toastIncrementRefreshed'));
}

async function deleteRule(index) {
  rules.splice(index, 1);
  await saveRules();
  renderRules();
  showToast(t('toastDeleted'));
  notifyPageRefresh();
}

async function clearRules() {
  if (!rules.length) { showToast(t('toastNoRules')); return; }
  rules = [];
  await saveRules();
  renderRules();
  showToast(t('toastCleared'));
  notifyPageRefresh();
}

// ── Event listeners ────────────────────────────────────
q('addBtn').addEventListener('click',     addRule);
q('clearBtn').addEventListener('click',   clearRules);
q('applyBtn').addEventListener('click',   applyTemp);
q('punctZhBtn').addEventListener('click', () => applyPunctPreset('zh'));
q('punctEnBtn').addEventListener('click', () => applyPunctPreset('en'));
q('refreshIncrementBtn').addEventListener('click', refreshIncrementCache);
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
  await restorePickerState();
})();
