const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const popupHtml = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'popup', 'popup.html'),
  'utf8',
);
const popupJs = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'popup', 'popup.js'),
  'utf8',
);
const contentJs = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'content', 'content.js'),
  'utf8',
);
const backgroundJs = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'background', 'background.js'),
  'utf8',
);
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'manifest.json'), 'utf8'));

test('shows regex help on hover without click or focus triggers', () => {
  assert.match(popupHtml, /\.regex-help:hover \.regex-help-bubble\s*\{\s*display:\s*block;/);
  assert.doesNotMatch(popupHtml, /\.regex-help:focus-within \.regex-help-bubble/);
  assert.match(popupHtml, /\.regex-help\s*\{[^}]*width:\s*28px[^}]*height:\s*28px/s);
  assert.doesNotMatch(popupJs, /regexHelpBtn\.addEventListener\(['"]click['"]/);
  assert.doesNotMatch(popupJs, /setRegexHelpOpen/);
  assert.doesNotMatch(popupHtml, /\.regex-help-bubble\.open\s*\{\s*display:\s*block;/);
});

test('keeps the replacement input at the expanded height in the stacked form', () => {
  assert.match(popupHtml, /#toInput\s*\{[^}]*flex:\s*0 0 auto[^}]*height:\s*46px/s);
});

test('offers popup and side panel switching from the header', () => {
  assert.ok(manifest.permissions.includes('sidePanel'));
  assert.equal(manifest.side_panel.default_path, 'src/popup/popup.html');
  assert.equal(manifest.action.default_popup, 'src/popup/popup.html');
  assert.match(popupHtml, /id="displayModeBtn"/);
  assert.match(popupJs, /chrome\.sidePanel\.open\(/);
  assert.match(popupJs, /TEXT_SWAP_SET_DISPLAY_MODE/);
  assert.match(backgroundJs, /chrome\.action\.setPopup\(/);
  assert.match(backgroundJs, /openPanelOnActionClick/);
});

test('makes the side panel layout fluid without changing popup width', () => {
  assert.match(popupHtml, /body\s*\{[^}]*width:\s*400px/s);
  assert.match(popupHtml, /body\.sidebar-mode\s*\{[^}]*width:\s*100%[^}]*min-width:\s*0[^}]*overflow-x:\s*hidden/s);
  assert.match(popupHtml, /class="header-brand"/);
  assert.match(popupHtml, /body\.sidebar-mode \.header\s*\{[^}]*display:\s*grid/s);
  assert.match(popupHtml, /body\.sidebar-mode \.header-actions\s*\{[^}]*grid-area:\s*actions/s);
  assert.match(popupHtml, /body\.sidebar-mode \.header-context\s*\{[^}]*grid-area:\s*context/s);
  assert.match(popupHtml, /\.header-context\s*>\s*span:not\(\.context-dot\)\s*\{[^}]*white-space:\s*nowrap/s);
  assert.match(popupJs, /classList\.toggle\(['"]sidebar-mode['"],\s*displayMode\s*===\s*['"]sidebar['"]\)/);
});

test('removes markdown and image export workflows', () => {
  for (const id of ['exportCopyBtn', 'exportMarkdownBtn', 'exportPngBtn', 'exportPickBtn', 'pageTools']) {
    assert.doesNotMatch(popupHtml, new RegExp(`id="${id}"`));
  }
  assert.doesNotMatch(popupJs, /runSidebarExport|exportSelection|TEXT_SWAP_EXPORT_ACTION|export-utils\.js/);
  assert.doesNotMatch(contentJs, /runExportAction|showExportToolbar|TEXT_SWAP_EXPORT_ACTION|captureVisibleTabForExport/);
  assert.doesNotMatch(backgroundJs, /TEXT_SWAP_CAPTURE_VISIBLE_TAB|captureVisibleTab/);
  assert.equal(fs.existsSync(path.join(__dirname, '..', 'src', 'content', 'export-utils.js')), false);
});
