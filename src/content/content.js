(function () {
// Guard against re-injection: the popup re-runs this file via executeScript
// (e.g. when starting the element picker) on top of the manifest-injected
// instance. Running a second time would spin up a duplicate MutationObserver
// and re-run init(), which together cause a runaway increment loop. If an
// instance is already live, the existing message handler keeps serving, so we
// simply bail out here.
if (window.__SuperTextSwapLoaded) return;
window.__SuperTextSwapLoaded = true;

let currentRules = [];
let observer = null;
let processedMark = new WeakMap();
let uiLang = "zh_CN";
let incrementCache = {};
let incrementCacheTimer = null;
// Per page-load session: the increment value chosen for each refresh-increment
// slot this session. Persisted cache accumulates across reloads; this map keeps
// the value stable within a single session so re-renders / observer callbacks
// don't re-trigger the increment (which would loop endlessly).
let sessionIncrement = {};

const SKIP_TAGS = new Set([
  "SCRIPT",
  "STYLE",
  "NOSCRIPT",
  "IFRAME",
  "TEXTAREA",
  "INPUT",
  "CODE",
  "PRE",
  "SELECT",
  "OPTION",
]);

// Context-aware replacement for punctuation presets.
// Protects patterns like domain.com, file.txt, 3.14, 1,000, http://
function smartReplace(text, from, to) {
  switch (from) {
    case ".":
      // Skip when dot is between alphanumeric chars: domain.com, file.txt, 3.14
      return text.replace(/\./g, (m, i, s) => {
        const prev = i > 0 ? s[i - 1] : "";
        const next = i < s.length - 1 ? s[i + 1] : "";
        return /[a-zA-Z0-9]/.test(prev) && /[a-zA-Z0-9]/.test(next) ? m : to;
      });
    case ",":
      // Skip when comma is between digits: 1,000,000
      return text.replace(/,/g, (m, i, s) => {
        const prev = i > 0 ? s[i - 1] : "";
        const next = i < s.length - 1 ? s[i + 1] : "";
        return /\d/.test(prev) && /\d/.test(next) ? m : to;
      });
    case ":":
      // Skip in URL protocols: http:// https:// ftp://
      return text.replace(/:/g, (m, i, s) =>
        s.slice(i + 1, i + 3) === "//" ? m : to,
      );
    default:
      return text.split(from).join(to);
  }
}

function normalizeNumberToken(raw) {
  const text = String(raw);
  const negative = text.includes("-");
  const numeric = text.replace(/[^0-9.]/g, "");
  const value = Number(numeric);
  if (!Number.isFinite(value)) return null;
  const decimal = numeric.includes(".") ? numeric.split(".").pop().length : 0;
  return { value: negative ? -value : value, decimal };
}

function formatNumberLike(raw, value, decimal) {
  const text = String(raw);
  const fixed = value.toFixed(decimal);
  const [intPart, fraction] = fixed.split(".");
  const withCommas = /,\d{3}/.test(text)
    ? intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",")
    : intPart;
  const prefix = (text.match(/^[^\d-]+/) || [""])[0];
  const suffix = (text.match(/[^\d.]+$/) || [""])[0];
  return prefix + withCommas + (fraction !== undefined ? "." + fraction : "") + suffix;
}

function getProtectedNumberRanges(text) {
  const ranges = [];
  const addMatches = (re) => {
    for (const match of String(text).matchAll(re)) {
      ranges.push([match.index, match.index + match[0].length]);
    }
  };

  addMatches(/\b[\w.%+-]+@[\w.-]+\.[A-Za-z]{2,}\b/g);
  addMatches(/\b(?:https?:\/\/|www\.)[^\s<>"']+/gi);
  addMatches(/\b\d{4}[-/.年]\d{1,2}[-/.月]\d{1,2}(?:日)?\b/g);
  addMatches(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g);
  addMatches(/(?:\+?\d{1,3}[\s-]?)?(?:\(?\d{2,4}\)?[\s-]?)?\d{3,4}[\s-]\d{4}(?:[\s-]\d{1,6})?\b/g);
  addMatches(/\b1[3-9]\d{9}\b/g);
  addMatches(/(?:电话|手机|座机|传真|Tel|TEL|Phone|phone|Mobile|mobile)[:：\s-]*(?:\+?\d[\d\s().-]{5,}\d)/g);

  return ranges.sort((a, b) => a[0] - b[0]);
}

function isRangeProtected(start, end, ranges) {
  return ranges.some(([from, to]) => start < to && end > from);
}

function hasAmountContext(text, start, end) {
  const before = text.slice(Math.max(0, start - 3), start);
  const after = text.slice(end, Math.min(text.length, end + 3));
  return /[$￥¥€£]\s*$/.test(before) || /^\s*(?:元|万|亿|USD|CNY|RMB|美元|人民币|kg|g|km|m²|㎡|%)/i.test(after);
}

function hasIdentifierContext(text, start) {
  const before = text.slice(Math.max(0, start - 12), start);
  return /(?:ID|id|编号|单号|订单|账号|帐号|卡号|证号|身份证|QQ|微信|邮编|邮政编码)\s*[:：#-]?\s*$/.test(before);
}

function addThousandsToNumberText(numberText) {
  const text = String(numberText);
  const sign = text.startsWith("-") ? "-" : "";
  const unsigned = sign ? text.slice(1) : text;
  const [integer, fraction] = unsigned.split(".");
  const plainInteger = integer.replace(/,/g, "");
  if (plainInteger.length < 4) return text;
  if (!/^\d+$/.test(plainInteger)) return text;
  const formattedInteger = plainInteger.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return sign + formattedInteger + (fraction !== undefined ? "." + fraction : "");
}

function formatThousandsInText(text) {
  const source = String(text);
  const protectedRanges = getProtectedNumberRanges(source);
  return source.replace(/(?<![\w@])[-+]?\d[\d,]*(?:\.\d+)?(?![\w@])/g, (token, offset) => {
    const end = offset + token.length;
    if (isRangeProtected(offset, end, protectedRanges)) return token;

    const digitsOnly = token.replace(/[^0-9]/g, "");
    if (digitsOnly.length < 4) return token;
    if (digitsOnly.length >= 6 && !/[,.]/.test(token) && !hasAmountContext(source, offset, end) && hasIdentifierContext(source, offset)) {
      return token;
    }

    return addThousandsToNumberText(token);
  });
}

function scheduleIncrementCacheSave() {
  if (incrementCacheTimer) return;
  incrementCacheTimer = setTimeout(() => {
    incrementCacheTimer = null;
    chrome.storage.local.set({ incrementCache }).catch(() => {});
  }, 120);
}

function makeIncrementCacheKey(rule, match, token, index) {
  return [
    location.hostname,
    rule.id || rule.from,
    rule.updatedAt || rule.createdAt || "",
    match,
    token,
    index,
  ].join("::");
}

function makeIncrementRecordKey(rule, index) {
  return [
    "record",
    location.hostname,
    location.pathname,
    rule.id || rule.from,
    rule.updatedAt || rule.createdAt || "",
    rule.scope?.domSelector || "",
    index,
  ].join("::");
}

function getCachedIncrement(rule, match, token, index) {
  const config = rule.valueTransform;
  const min = Number(config?.min);
  const max = Number(config?.max);
  if (!config?.enabled || !Number.isFinite(min) || !Number.isFinite(max)) return 0;
  const low = Math.min(min, max);
  const high = Math.max(min, max);
  const key = makeIncrementCacheKey(rule, match, token, index);
  if (typeof incrementCache[key] === "number") return incrementCache[key];
  const decimalPlaces = Math.max(
    String(low).split(".")[1]?.length || 0,
    String(high).split(".")[1]?.length || 0,
  );
  const delta = Number((low + Math.random() * (high - low)).toFixed(decimalPlaces));
  incrementCache[key] = delta;
  scheduleIncrementCacheSave();
  return delta;
}

function getRefreshIncrementValue(rule, parsed, index) {
  const config = rule.valueTransform;
  const min = Number(config?.min);
  const max = Number(config?.max);
  if (!config?.enabled || !Number.isFinite(min) || !Number.isFinite(max))
    return parsed.value;

  const key = makeIncrementRecordKey(rule, index);

  // Already decided for this session → return the same value so re-renders and
  // observer callbacks don't re-increment (which would loop without end).
  if (typeof sessionIncrement[key] === "number") return sessionIncrement[key];

  const low = Math.min(min, max);
  const high = Math.max(min, max);
  const decimalPlaces = Math.max(
    parsed.decimal,
    String(low).split(".")[1]?.length || 0,
    String(high).split(".")[1]?.length || 0,
  );
  // Accumulate on refresh: read the previously cached value and increment it.
  // First time ever (no cache), start from the value currently on the page.
  const record = incrementCache[key];
  const base =
    record && typeof record.value === "number" ? record.value : parsed.value;
  const delta = Number((low + Math.random() * (high - low)).toFixed(decimalPlaces));
  const value = Number((base + delta).toFixed(decimalPlaces));
  sessionIncrement[key] = value;
  incrementCache[key] = { value, updatedAt: Date.now() };
  scheduleIncrementCacheSave();
  return value;
}

function applyValueTransform(replacement, rule, match) {
  if (!rule.valueTransform?.enabled) return replacement;
  let tokenIndex = 0;
  return String(replacement).replace(
    /(?:[$￥¥]\s*)?-?\d[\d,]*(?:\.\d+)?(?:\s*(?:元|万|亿|USD|CNY|RMB|美元|人民币))?/gi,
    (token) => {
      const parsed = normalizeNumberToken(token);
      if (!parsed) return token;
      const index = tokenIndex++;
      const nextValue = rule.valueTransform.refreshIncrement
        ? getRefreshIncrementValue(rule, parsed, index)
        : parsed.value + getCachedIncrement(rule, match, token, index);
      const decimal = Math.max(
        parsed.decimal,
        String(rule.valueTransform.min).split(".")[1]?.length || 0,
        String(rule.valueTransform.max).split(".")[1]?.length || 0,
      );
      return formatNumberLike(token, nextValue, decimal);
    },
  );
}

function applyNumberRule(text, rule) {
  return applyValueTransform(text, rule, text);
}

function replacementFor(rule, match) {
  const base = rule.to || match;
  return applyValueTransform(base, rule, match);
}

function applyRuleToText(text, rule) {
  if (rule.type === "number") {
    return applyNumberRule(text, rule);
  }

  if (rule.type === "regex") {
    try {
      return text.replace(new RegExp(rule.from, "g"), (match) =>
        replacementFor(rule, match),
      );
    } catch {
      return text;
    }
  }

  if (rule.smart && !rule.valueTransform?.enabled) {
    return smartReplace(text, rule.from, rule.to || "");
  }

  if (rule.smart) {
    return smartReplace(text, rule.from, replacementFor(rule, rule.from));
  }

  return text.split(rule.from).join(replacementFor(rule, rule.from));
}

// ── i18n: load pick-mode strings from _locales ─────────
let uiMessages = {};

async function loadUIMessages(locale) {
  try {
    if (!chrome.runtime?.id) {
      uiMessages = {};
      return;
    }
    const url = chrome.runtime.getURL(`_locales/${locale}/messages.json`);
    if (!url || url.includes("://invalid/")) {
      uiMessages = {};
      return;
    }
    uiMessages = await (await fetch(url)).json();
  } catch {
    uiMessages = {};
  }
}

const msg = (key, sub) => {
  let str = uiMessages[key]?.message ?? key;
  if (sub !== undefined) str = str.replace(/\$[A-Z_]+\$/g, sub);
  return str;
};

// ── URL scope matching ─────────────────────────────────
function matchesCurrentUrl(rule) {
  const scope = rule.scope;
  if (!scope?.urlMode || scope.urlMode === "all") return true;

  if (scope.urlMode === "domain") {
    const pattern = (scope.urlPattern || "").trim();
    if (!pattern) return true;
    const host = location.hostname;
    return host === pattern || host.endsWith("." + pattern);
  }

  if (scope.urlMode === "custom") {
    const pattern = (scope.urlPattern || "").trim();
    if (!pattern) return true;
    try {
      const re = pattern
        .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
        .replace(/\*/g, ".*");
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
    chrome.storage.sync.get(["rules"]),
    chrome.storage.local.get(["lang", "incrementCache"]),
  ]);
  uiLang = localResult.lang || "zh_CN";
  incrementCache = localResult.incrementCache || {};
  currentRules = (syncResult.rules || []).filter(
    (r) =>
      r.enabled &&
      (r.from || r.type === "number" || r.type === "compute") &&
      matchesCurrentUrl(r),
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
    if (!rule.from && rule.type !== "number") continue;
    if (rule.scope?.domSelector) {
      if (!matchesDomScope(anchorEl, rule.scope.domSelector)) continue;
    }
    result = applyRuleToText(result, rule);
  }
  return result;
}

// ── Replace a single text node ─────────────────────────
function replaceTextNode(node) {
  if (shouldSkipNode(node)) return;
  const original = node.nodeValue;
  if (!original || !original.trim()) return;
  if (processedMark.get(node) === original) return;

  const anchor = node.parentElement;
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
    acceptNode: (node) =>
      shouldSkipNode(node)
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT,
  });
  let node;
  while ((node = walker.nextNode())) replaceTextNode(node);
}

function replaceTextNodeWithRules(node, ruleSet) {
  if (shouldSkipNode(node)) return;
  const original = node.nodeValue;
  if (!original || !original.trim()) return;
  if (processedMark.get(node) === original) return;

  let replaced = original;
  for (const rule of ruleSet) {
    if (!rule.from && rule.type !== "number") continue;
    replaced = applyRuleToText(replaced, rule);
  }

  if (replaced !== original) {
    node.nodeValue = replaced;
    processedMark.set(node, replaced);
  } else {
    processedMark.set(node, original);
  }
}

function walkAndReplaceWithRules(root, ruleSet) {
  if (!root || !ruleSet.length) return;
  if (root.nodeType === Node.TEXT_NODE) {
    replaceTextNodeWithRules(root, ruleSet);
    return;
  }
  if (root.nodeType !== Node.ELEMENT_NODE) return;

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) =>
      shouldSkipNode(node)
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT,
  });
  let node;
  while ((node = walker.nextNode())) replaceTextNodeWithRules(node, ruleSet);
}

// ── Input / textarea replacement ───────────────────────
function replaceInInputs() {
  const inputRules = currentRules.filter((r) => r.scope?.includeInputs);
  if (!inputRules.length) return;
  const sel =
    'input[type="text"],input[type="search"],input[type="email"],input[type="url"],input:not([type]),textarea';
  document.querySelectorAll(sel).forEach((el) => {
    if (!el.value) return;
    const replaced = applyRules(el.value, el, inputRules);
    if (replaced !== el.value) el.value = replaced;
  });
}

// ── Contenteditable (rich text) replacement ────────────
function replaceInEditables() {
  const editableRules = currentRules.filter((r) => r.scope?.includeEditable);
  if (!editableRules.length) return;
  document.querySelectorAll('[contenteditable="true"]').forEach((editable) => {
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
let scopeRefreshTimer = null;

function flushPendingNodes() {
  mutationTimer = null;
  const batch = pendingNodes.splice(0);
  for (const node of batch) {
    if (node.nodeType === Node.TEXT_NODE) replaceTextNode(node);
    else if (node.nodeType === Node.ELEMENT_NODE) walkAndReplace(node);
  }
}

function getDomScopeNodes(scopeSelector) {
  const selector = String(scopeSelector || "").trim();
  if (!selector) return [];
  if (selector.startsWith("xpath=") || selector.startsWith("/")) {
    return getXPathScopeNodes(selector);
  }
  try {
    return Array.from(document.querySelectorAll(selector));
  } catch {
    return [];
  }
}

function refreshRenderedScopes() {
  scopeRefreshTimer = null;
  const scopedRules = currentRules.filter((rule) => rule.scope?.domSelector);
  if (!scopedRules.length) return;

  for (const rule of scopedRules) {
    const nodes = getDomScopeNodes(rule.scope.domSelector);
    for (const node of nodes) {
      if (!node) continue;
      walkAndReplaceWithRules(node, [rule]);
    }
  }
}

function scheduleRenderedScopeRefresh() {
  if (scopeRefreshTimer) return;
  scopeRefreshTimer = setTimeout(refreshRenderedScopes, 80);
}

// ── Auto compute (sum / avg / min / max / count) ───────
// Collects numbers from multiple picked source elements, aggregates them,
// and writes the result into the target element (rule.scope.domSelector).
let computeRefreshTimer = null;

function extractNumberFromElement(el) {
  if (!el) return null;
  const text = (el.textContent || "").trim();
  if (!text) return null;
  const match = text.match(
    /(?:[$￥¥]\s*)?-?\d[\d,]*(?:\.\d+)?(?:\s*(?:元|万|亿|USD|CNY|RMB|美元|人民币))?/i,
  );
  if (!match) return null;
  const parsed = normalizeNumberToken(match[0]);
  if (!parsed) return null;
  return { value: parsed.value, decimal: parsed.decimal, token: match[0] };
}

function computeAggregate(op, values) {
  if (!values.length) return null;
  switch (op) {
    case "avg":
      return values.reduce((a, b) => a + b, 0) / values.length;
    case "min":
      return Math.min(...values);
    case "max":
      return Math.max(...values);
    case "count":
      return values.length;
    case "sum":
    default:
      return values.reduce((a, b) => a + b, 0);
  }
}

function formatComputeResult(rule, result, sources) {
  if (rule.compute.op === "count") return String(result);
  const decimals = Math.max(0, ...sources.map((s) => s.decimal || 0));
  if (rule.compute.keepFormat && sources[0]) {
    return formatNumberLike(sources[0].token, result, decimals);
  }
  return result.toFixed(decimals);
}

function setElementResultText(el, text) {
  if (!el) return;
  if ((el.textContent || "").trim() === text) return; // no change → avoid loops
  // Prefer writing into an existing single text node to disturb structure less.
  const textNodes = Array.from(el.childNodes).filter(
    (n) => n.nodeType === Node.TEXT_NODE,
  );
  if (
    el.childNodes.length === 1 &&
    textNodes.length === 1
  ) {
    textNodes[0].nodeValue = text;
  } else {
    el.textContent = text;
  }
}

function applyComputeRule(rule) {
  const c = rule.compute;
  if (!c || !Array.isArray(c.sources) || !c.sources.length) return;
  const targetSel = rule.scope?.domSelector;
  if (!targetSel) return;
  const targets = getDomScopeNodes(targetSel);
  if (!targets.length) return;
  const targetSet = new Set(targets);

  const sources = [];
  for (const sel of c.sources) {
    const el = getDomScopeNodes(sel).find((node) => !targetSet.has(node));
    if (!el) continue;
    const parsed = extractNumberFromElement(el);
    if (parsed) sources.push(parsed);
  }
  if (!sources.length) return;

  const result = computeAggregate(c.op, sources.map((s) => s.value));
  if (result == null || !Number.isFinite(result)) return;
  const text = formatComputeResult(rule, result, sources);

  for (const target of targets) setElementResultText(target, text);
}

function refreshComputeRules() {
  computeRefreshTimer = null;
  for (const rule of currentRules) {
    if (rule.type === "compute") applyComputeRule(rule);
  }
}

function scheduleComputeRefresh() {
  if (computeRefreshTimer) return;
  computeRefreshTimer = setTimeout(refreshComputeRules, 100);
}

function observePageChanges() {
  if (observer) observer.disconnect();
  observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.type === "characterData") {
        pendingNodes.push(m.target);
        continue;
      }
      for (const n of m.addedNodes) pendingNodes.push(n);
    }
    if (!mutationTimer) mutationTimer = setTimeout(flushPendingNodes, 50);
    scheduleRenderedScopeRefresh();
    scheduleComputeRefresh();
  });
  observer.observe(document.body, {
    childList: true,
    characterData: true,
    subtree: true,
  });
}

// ── Full refresh ───────────────────────────────────────
async function refresh() {
  await loadRules();
  processedMark = new WeakMap();
  walkAndReplace();
  replaceInInputs();
  replaceInEditables();
  observePageChanges();
  refreshRenderedScopes();
  refreshComputeRules();
}

// ══════════════════════════════════════════════════════
// Element Picker
// ══════════════════════════════════════════════════════
let pickMode = false;
let pickHighlight = null;
let pickMulti = false;
let pickedSelectors = [];
let pickToolbar = null;
let pickedOverlays = [];

const STABLE_ATTRS = [
  "data-testid",
  "data-test",
  "data-cy",
  "data-qa",
  "aria-label",
  "name",
  "title",
  "placeholder",
  "alt",
];

function cssString(value) {
  return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function isLikelyHashedToken(token) {
  if (!token || token.length <= 1 || /^\d/.test(token)) return true;

  const value = String(token);
  const lower = value.toLowerCase();
  if (/^(css|jss|jsx|emotion|styled|sc|makeStyles|mui|chakra)-/i.test(value)) return true;
  if (/^(__|ng-|svelte-|astro-|v-)/i.test(value)) return true;

  const chunks = value.split(/[_-]/).filter(Boolean);
  if (
    chunks.length >= 3 &&
    chunks.some((part, index) => /^\d+$/.test(part) && index > 0 && index < chunks.length - 1) &&
    /[a-z]/.test(value) &&
    /[A-Z]/.test(value)
  ) {
    return true;
  }

  const hasHashChunk = chunks.some(
    (part) =>
      part.length >= 5 &&
      ((/[a-z]/i.test(part) && /\d/.test(part)) ||
        (/[a-z]/.test(part) && /[A-Z]/.test(part))) &&
      /^[a-z0-9]+$/i.test(part),
  );
  if (hasHashChunk) return true;

  if (value.length >= 8 && /^[a-z0-9_-]+$/i.test(value)) {
    const letters = (value.match(/[a-z]/gi) || []).length;
    const digits = (value.match(/\d/g) || []).length;
    if (letters >= 3 && digits >= 3) return true;
  }

  return /(?:^|[-_])(hash|hashed|module|generated|random)(?:[-_]|$)/.test(lower);
}

function getStableAttrSelector(el) {
  for (const attr of STABLE_ATTRS) {
    const value = el.getAttribute(attr);
    if (value && value.trim() && value.length <= 80) {
      return `[${attr}=${cssString(value.trim())}]`;
    }
  }
  return "";
}

function getNthOfType(el) {
  let index = 1;
  let sibling = el.previousElementSibling;
  while (sibling) {
    if (sibling.tagName === el.tagName) index += 1;
    sibling = sibling.previousElementSibling;
  }
  return `${el.tagName.toLowerCase()}:nth-of-type(${index})`;
}

function getElementXPath(el) {
  const segments = [];
  let node = el;
  while (node && node.nodeType === Node.ELEMENT_NODE) {
    const tag = node.tagName.toLowerCase();
    let index = 1;
    let sibling = node.previousElementSibling;
    while (sibling) {
      if (sibling.tagName === node.tagName) index += 1;
      sibling = sibling.previousElementSibling;
    }
    segments.unshift(`${tag}[${index}]`);
    node = node.parentElement;
  }
  return `xpath=/${segments.join("/")}`;
}

function getXPathLiteral(text) {
  const value = String(text);
  if (!value.includes("'")) return `'${value}'`;
  if (!value.includes('"')) return `"${value}"`;
  return `concat('${value.split("'").join(`', "'", '`)}')`;
}

function getOwnText(el) {
  if (!el?.childNodes) return "";
  return Array.from(el.childNodes)
    .filter((node) => node.nodeType === Node.TEXT_NODE)
    .map((node) => node.nodeValue.trim())
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function isStableTextAnchor(text) {
  if (!text || text.length > 60) return false;
  return /[\p{L}\u4e00-\u9fff]/u.test(text);
}

function getTextAnchoredXPath(el) {
  const tag = el.tagName.toLowerCase();
  const prevText = getOwnText(el.previousElementSibling || {});
  if (isStableTextAnchor(prevText)) {
    return `xpath=//*[normalize-space()=${getXPathLiteral(prevText)}]/following-sibling::${tag}[1]`;
  }

  const parent = el.parentElement;
  if (!parent) return "";

  const siblings = Array.from(parent.children);
  const index = siblings.indexOf(el);
  const anchor = siblings
    .slice(0, Math.max(index, 0))
    .reverse()
    .find((node) => isStableTextAnchor(getOwnText(node)));

  if (anchor) {
    const anchorText = getOwnText(anchor);
    const distance = siblings.indexOf(el) - siblings.indexOf(anchor);
    return `xpath=//*[normalize-space()=${getXPathLiteral(anchorText)}]/following-sibling::*[${distance}]`;
  }

  return "";
}

function getXPathScopeNodes(scopeSelector) {
  const raw = String(scopeSelector || "").trim();
  const hasPrefix = raw.startsWith("xpath=");
  const xpath = hasPrefix ? raw.slice(6).trim() : raw;
  if (!xpath || (!hasPrefix && !xpath.startsWith("/"))) return [];
  try {
    const result = document.evaluate(
      xpath,
      document,
      null,
      XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
      null,
    );
    const nodes = [];
    for (let i = 0; i < result.snapshotLength; i++) {
      nodes.push(result.snapshotItem(i));
    }
    return nodes;
  } catch {
    return [];
  }
}

function matchesDomScope(anchorEl, scopeSelector) {
  if (!anchorEl || !scopeSelector) return false;
  const selector = String(scopeSelector).trim();
  if (!selector) return true;

  if (selector.startsWith("xpath=") || selector.startsWith("/")) {
    return getXPathScopeNodes(selector).some(
      (scopeNode) => scopeNode === anchorEl || scopeNode.contains(anchorEl),
    );
  }

  try {
    return !!anchorEl.closest(selector);
  } catch {
    return false;
  }
}

function getSelectorSegment(el, preferBroad = false) {
  const tag = el.tagName.toLowerCase();
  const stableAttr = getStableAttrSelector(el);
  if (stableAttr) return preferBroad ? stableAttr : `${tag}${stableAttr}`;

  if (el.id && !isLikelyHashedToken(el.id)) return `#${CSS.escape(el.id)}`;

  const classes = Array.from(el.classList).filter((c) => !isLikelyHashedToken(c));
  if (classes.length) {
    return (
      tag +
      classes
        .slice(0, 2)
        .map((c) => `.${CSS.escape(c)}`)
        .join("")
    );
  }

  return getNthOfType(el);
}

function generateSelector(el) {
  if (!el || el === document.body) return "body";

  if (
    (el.id && isLikelyHashedToken(el.id)) ||
    Array.from(el.classList).some(isLikelyHashedToken)
  ) {
    return getTextAnchoredXPath(el) || getElementXPath(el);
  }

  const direct = getSelectorSegment(el, true);
  if (!direct.includes(":nth-of-type")) return direct;

  const segments = [];
  let node = el;
  while (node && node !== document.documentElement && segments.length < 4) {
    if (node.id && !isLikelyHashedToken(node.id)) {
      segments.unshift(`#${CSS.escape(node.id)}`);
      break;
    }
    segments.unshift(getSelectorSegment(node));
    node = node.parentElement;
  }
  return segments.join(" > ") || el.tagName.toLowerCase();
}

function showPageToast(text) {
  document.getElementById("__SuperTextSwap_toast__")?.remove();
  const el = document.createElement("div");
  el.id = "__SuperTextSwap_toast__";
  el.style.cssText = [
    "position:fixed",
    "bottom:24px",
    "left:50%",
    "transform:translateX(-50%)",
    "background:rgba(0,0,0,0.82)",
    "color:#fff",
    "padding:8px 18px",
    "border-radius:8px",
    "font-size:13px",
    "z-index:2147483647",
    "font-family:system-ui,sans-serif",
    "pointer-events:none",
    "white-space:nowrap",
    "max-width:90vw",
    "overflow:hidden",
    "text-overflow:ellipsis",
  ].join(";");
  el.textContent = text;
  document.body.appendChild(el);
  setTimeout(() => el?.remove(), 3000);
}

function onPickMouseMove(e) {
  if (!pickHighlight || e.target === pickHighlight) return;
  const r = e.target.getBoundingClientRect();
  Object.assign(pickHighlight.style, {
    top: `${r.top}px`,
    left: `${r.left}px`,
    width: `${r.width}px`,
    height: `${r.height}px`,
  });
}

function onPickClick(e) {
  if (e.target === pickHighlight || isPickToolbar(e.target)) return;
  e.preventDefault();
  e.stopPropagation();
  if (pickMulti) {
    const selector = generateSelector(e.target);
    if (selector && !pickedSelectors.includes(selector)) {
      pickedSelectors.push(selector);
      addPickedOverlay(e.target, pickedSelectors.length);
      updatePickToolbar();
    }
    return;
  }
  exitPickMode(generateSelector(e.target));
}

function onPickKeyDown(e) {
  if (e.key === "Escape") {
    if (pickMulti) finishMultiPick(false);
    else exitPickMode(null);
  } else if (e.key === "Enter" && pickMulti) {
    finishMultiPick(true);
  }
}

function isPickToolbar(el) {
  return !!(pickToolbar && el && pickToolbar.contains(el));
}

function addPickedOverlay(el, n) {
  const r = el.getBoundingClientRect();
  const box = document.createElement("div");
  box.style.cssText = [
    "position:fixed",
    `top:${r.top}px`,
    `left:${r.left}px`,
    `width:${r.width}px`,
    `height:${r.height}px`,
    "pointer-events:none",
    "border:2px solid #16a34a",
    "background:rgba(22,163,74,0.12)",
    "border-radius:3px",
    "z-index:2147483645",
    "box-sizing:border-box",
  ].join(";");
  const tag = document.createElement("span");
  tag.textContent = String(n);
  tag.style.cssText = [
    "position:absolute",
    "top:-9px",
    "left:-9px",
    "min-width:18px",
    "height:18px",
    "padding:0 4px",
    "border-radius:9px",
    "background:#16a34a",
    "color:#fff",
    "font:600 11px/18px system-ui,sans-serif",
    "text-align:center",
  ].join(";");
  box.appendChild(tag);
  document.body.appendChild(box);
  pickedOverlays.push(box);
}

function buildPickToolbar() {
  pickToolbar = document.createElement("div");
  pickToolbar.id = "__SuperTextSwap_picktoolbar__";
  pickToolbar.style.cssText = [
    "position:fixed",
    "top:16px",
    "left:50%",
    "transform:translateX(-50%)",
    "z-index:2147483647",
    "display:flex",
    "gap:8px",
    "align-items:center",
    "background:#111827",
    "color:#fff",
    "padding:8px 10px",
    "border-radius:10px",
    "font:13px/1 system-ui,sans-serif",
    "box-shadow:0 6px 24px rgba(0,0,0,0.35)",
  ].join(";");

  const label = document.createElement("span");
  label.id = "__SuperTextSwap_pickcount__";
  label.textContent = msg("pickMultiCount", "0");
  label.style.cssText = "margin-right:4px;white-space:nowrap";

  const doneBtn = document.createElement("button");
  doneBtn.textContent = msg("pickDoneBtn");
  doneBtn.style.cssText = btnStyle("#2563eb");
  doneBtn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    finishMultiPick(true);
  });

  const cancelBtn = document.createElement("button");
  cancelBtn.textContent = msg("pickCancelBtn");
  cancelBtn.style.cssText = btnStyle("#4b5563");
  cancelBtn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    finishMultiPick(false);
  });

  pickToolbar.append(label, doneBtn, cancelBtn);
  document.body.appendChild(pickToolbar);
}

function btnStyle(bg) {
  return [
    "border:0",
    "cursor:pointer",
    "padding:5px 12px",
    "border-radius:7px",
    "font:600 12px/1 system-ui,sans-serif",
    "color:#fff",
    `background:${bg}`,
  ].join(";");
}

function updatePickToolbar() {
  const label = document.getElementById("__SuperTextSwap_pickcount__");
  if (label) label.textContent = msg("pickMultiCount", String(pickedSelectors.length));
}

function cleanupPickMode() {
  pickMode = false;
  pickMulti = false;
  document.body.style.cursor = "";
  pickHighlight?.remove();
  pickHighlight = null;
  pickToolbar?.remove();
  pickToolbar = null;
  pickedOverlays.forEach((o) => o.remove());
  pickedOverlays = [];
  document.removeEventListener("mousemove", onPickMouseMove, true);
  document.removeEventListener("click", onPickClick, true);
  document.removeEventListener("keydown", onPickKeyDown, true);
}

function startPickMode(multi) {
  if (pickMode) return;
  pickMode = true;
  pickMulti = !!multi;
  pickedSelectors = [];
  document.body.style.cursor = "crosshair";

  pickHighlight = document.createElement("div");
  pickHighlight.style.cssText = [
    "position:fixed",
    "pointer-events:none",
    "border:2px solid #2563eb",
    "background:rgba(37,99,235,0.1)",
    "border-radius:3px",
    "z-index:2147483646",
    "transition:top 0.05s,left 0.05s,width 0.05s,height 0.05s",
    "box-shadow:0 0 0 2000px rgba(0,0,0,0.18)",
  ].join(";");
  document.body.appendChild(pickHighlight);

  document.addEventListener("mousemove", onPickMouseMove, true);
  document.addEventListener("click", onPickClick, true);
  document.addEventListener("keydown", onPickKeyDown, true);

  if (pickMulti) {
    buildPickToolbar();
    showPageToast(msg("pickPromptMulti"));
  } else {
    showPageToast(msg("pickPrompt"));
  }
}

function enterPickMode() {
  startPickMode(false);
}

function enterMultiPickMode() {
  startPickMode(true);
}

async function exitPickMode(selector) {
  cleanupPickMode();

  if (selector) {
    await chrome.storage.local.set({ pendingSelector: selector });
    // Ask background to reopen the popup (Chrome 127+, no user gesture needed)
    chrome.runtime
      .sendMessage({ type: "TEXT_SWAP_OPEN_POPUP" })
      .catch(() => {});
    showPageToast(msg("pickDone", selector));
  } else {
    showPageToast(msg("pickCancel"));
  }
}

async function finishMultiPick(confirm) {
  const selectors = pickedSelectors.slice();
  cleanupPickMode();

  if (confirm && selectors.length) {
    await chrome.storage.local.set({ pendingSources: selectors });
    chrome.runtime
      .sendMessage({ type: "TEXT_SWAP_OPEN_POPUP" })
      .catch(() => {});
    showPageToast(msg("pickMultiDone", String(selectors.length)));
  } else {
    showPageToast(msg("pickCancel"));
  }
}

// ── Temporary apply (one-shot, not saved) ─────────────
// Applies caller-supplied rules directly to the current page state.
// Does not touch currentRules or processedMark, so a subsequent
// refresh() will restore the page to saved-rules-only state.
function applyTempRules(tempRules) {
  if (!tempRules?.length) return;
  const active = tempRules.filter(
    (r) => r.enabled && (r.from || r.type === "number") && matchesCurrentUrl(r),
  );
  if (!active.length) return;

  // Regular text nodes
  const walker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode: (node) =>
        shouldSkipNode(node)
          ? NodeFilter.FILTER_REJECT
          : NodeFilter.FILTER_ACCEPT,
    },
  );
  let node;
  while ((node = walker.nextNode())) {
    const original = node.nodeValue;
    if (!original || !original.trim()) continue;
    const replaced = applyRules(original, node.parentElement, active);
    if (replaced !== original) node.nodeValue = replaced;
  }

  // Input / textarea
  const inputRules = active.filter((r) => r.scope?.includeInputs);
  if (inputRules.length) {
    const sel =
      'input[type="text"],input[type="search"],input[type="email"],' +
      'input[type="url"],input:not([type]),textarea';
    document.querySelectorAll(sel).forEach((el) => {
      if (!el.value) return;
      const replaced = applyRules(el.value, el, inputRules);
      if (replaced !== el.value) el.value = replaced;
    });
  }

  // Contenteditable
  const editableRules = active.filter((r) => r.scope?.includeEditable);
  if (editableRules.length) {
    document
      .querySelectorAll('[contenteditable="true"]')
      .forEach((editable) => {
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

function shouldAcceptScopedTextNode(node, scope) {
  if (shouldSkipNode(node)) return false;
  if (scope?.domSelector && !matchesDomScope(node.parentElement, scope.domSelector)) {
    return false;
  }
  return true;
}

function applyThousandsFormat(scope) {
  const pseudoRule = { scope: scope || null };
  if (!matchesCurrentUrl(pseudoRule)) return;

  const walker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode: (node) =>
        shouldAcceptScopedTextNode(node, scope)
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_REJECT,
    },
  );
  let node;
  while ((node = walker.nextNode())) {
    const original = node.nodeValue;
    if (!original || !/\d{4,}/.test(original)) continue;
    const replaced = formatThousandsInText(original);
    if (replaced !== original) node.nodeValue = replaced;
  }

  if (scope?.includeInputs) {
    const sel =
      'input[type="text"],input[type="search"],input[type="email"],' +
      'input[type="url"],input:not([type]),textarea';
    document.querySelectorAll(sel).forEach((el) => {
      if (!el.value || !/\d{4,}/.test(el.value)) return;
      if (scope?.domSelector && !matchesDomScope(el, scope.domSelector)) return;
      const replaced = formatThousandsInText(el.value);
      if (replaced !== el.value) el.value = replaced;
    });
  }

  if (scope?.includeEditable) {
    document
      .querySelectorAll('[contenteditable="true"]')
      .forEach((editable) => {
        if (scope?.domSelector && !matchesDomScope(editable, scope.domSelector)) return;
        const w = document.createTreeWalker(editable, NodeFilter.SHOW_TEXT);
        let n;
        while ((n = w.nextNode())) {
          const original = n.nodeValue;
          if (!original || !/\d{4,}/.test(original)) continue;
          const replaced = formatThousandsInText(original);
          if (replaced !== original) n.nodeValue = replaced;
        }
      });
  }
}

// ── Stateful quote parser for EN→ZH conversion ────────
// Tracks open/close parity across text nodes so "hello" "world"
// pairs correctly even when the quotes span multiple DOM elements.
// ASCII " toggles between U+201C (open) and U+201D (close).
// ASCII ' between two word chars becomes U+2019 (apostrophe);
// otherwise toggles between U+2018 (open) and U+2019 (close).
function applyZhQuoteParser(scope) {
  let dq = false; // false = next " is opening U+201C
  let sq = false; // false = next ' is opening U+2018

  function parseText(text) {
    if (text.indexOf('"') === -1 && text.indexOf("'") === -1) return text;
    let out = "";
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      const prev = i > 0 ? text[i - 1] : "\n";
      const next = i < text.length - 1 ? text[i + 1] : "\n";
      if (ch === '"') {
        out += dq ? "”" : "“";
        dq = !dq;
      } else if (ch === "'") {
        if (/\w/.test(prev) && /\w/.test(next)) {
          out += "’"; // typographic apostrophe — don't toggle parity
        } else {
          out += sq ? "’" : "‘";
          sq = !sq;
        }
      } else {
        out += ch;
      }
    }
    return out;
  }

  // Walk text nodes; state persists across nodes for correct cross-element pairing
  const walker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode(node) {
        const el = node.parentElement;
        if (!el) return NodeFilter.FILTER_REJECT;
        if (SKIP_TAGS.has(el.tagName)) return NodeFilter.FILTER_REJECT;
        if (el.isContentEditable && !scope?.includeEditable)
          return NodeFilter.FILTER_REJECT;
        if (scope?.domSelector) {
          if (!matchesDomScope(el, scope.domSelector))
            return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    },
  );

  let node;
  while ((node = walker.nextNode())) {
    const original = node.nodeValue;
    if (!original) continue;
    const result = parseText(original);
    if (result !== original) node.nodeValue = result;
  }

  // Input/textarea: fresh state per element (quotes don't span multiple fields)
  if (scope?.includeInputs) {
    const sel =
      'input[type="text"],input[type="search"],input[type="email"],' +
      'input[type="url"],input:not([type]),textarea';
    document.querySelectorAll(sel).forEach((el) => {
      const v = el.value;
      if (!v || (v.indexOf('"') === -1 && v.indexOf("'") === -1)) return;
      let d = false,
        s = false,
        out = "";
      for (let i = 0; i < v.length; i++) {
        const ch = v[i],
          prev = i > 0 ? v[i - 1] : "\n",
          next = i < v.length - 1 ? v[i + 1] : "\n";
        if (ch === '"') {
          out += d ? "”" : "“";
          d = !d;
        } else if (ch === "'") {
          if (/\w/.test(prev) && /\w/.test(next)) out += "’";
          else {
            out += s ? "’" : "‘";
            s = !s;
          }
        } else {
          out += ch;
        }
      }
      if (out !== v) el.value = out;
    });
  }
}

// ── Message listener ───────────────────────────────────
if (window.__SuperTextSwapMessageHandler) {
  chrome.runtime.onMessage.removeListener(window.__SuperTextSwapMessageHandler);
}

window.__SuperTextSwapMessageHandler = (message) => {
  if (message.type === "TEXT_SWAP_RULES_UPDATED") refresh();
  if (message.type === "TEXT_SWAP_INCREMENT_CACHE_CLEARED") {
    incrementCache = {};
    sessionIncrement = {};
    processedMark = new WeakMap();
    refresh();
  }
  if (
    message.type === "TEXT_SWAP_PICK_START" ||
    message.type === "TEXT_SWAP_PICK_START_V2"
  ) {
    loadRules().then(enterPickMode);
  }
  if (message.type === "TEXT_SWAP_PICK_START_MULTI") {
    loadRules().then(enterMultiPickMode);
  }
  if (message.type === "TEXT_SWAP_APPLY_TEMP") applyTempRules(message.rules);
  if (message.type === "TEXT_SWAP_APPLY_PUNCT") {
    applyTempRules(message.rules); // simple rules first (brackets, punctuation)
    if (message.direction === "zh") applyZhQuoteParser(message.scope);
  }
  if (message.type === "TEXT_SWAP_FORMAT_THOUSANDS") {
    applyThousandsFormat(message.scope);
  }
};

chrome.runtime.onMessage.addListener(window.__SuperTextSwapMessageHandler);

refresh();
})();
