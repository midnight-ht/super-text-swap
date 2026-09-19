# SuperContentExport Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone Chrome MV3 extension at `E:\project\plug-in\SuperContentExport` for selecting webpage elements and copying/downloading Markdown or exporting PNG images.

**Architecture:** Copy only the proven export-related behavior from `text-swap` into a new independent extension. The new content script owns picking, toolbar state, Markdown actions, PNG loading, and capture-session cleanup; `export-utils.js` owns pure Markdown and PNG rendering logic; the background service worker owns `captureVisibleTab`; the popup only starts picking and forwards toolbar actions. No runtime dependency or import points to `text-swap`.

**Tech Stack:** Chrome Manifest V3, vanilla JavaScript, Node.js built-in test runner, `archiver`, `crx`, `cross-env`, JavaScript Obfuscator-compatible build script.

**Spec:** `docs/superpowers/specs/2026-09-19-SuperContentExport-design.md`

## Global Constraints

- The new extension directory is exactly `E:\project\plug-in\SuperContentExport`.
- The current `E:\project\plug-in\text-swap` runtime code remains unchanged by the new plugin implementation.
- The new plugin must not import or read source files from `text-swap` at runtime.
- Chrome MV3 permissions are limited to `storage`, `activeTab`, and `scripting`, plus `<all_urls>` host access needed by the existing capture flow.
- PNG native capture calls are spaced by at least 550ms, and the extension retries one capture-rate-limit response after the same interval.
- Every PNG action must clean up loading UI, toolbar state, temporary page overlay hiding, button state, and scroll position on success and failure.
- Unit tests run with `npm test`; plain packaging runs with `npm run build:plain`.

---

### Task 1: Create the standalone extension skeleton

**Files:**
- Create: `E:\project\plug-in\SuperContentExport\package.json`
- Create: `E:\project\plug-in\SuperContentExport\manifest.json`
- Create: `E:\project\plug-in\SuperContentExport\build.js`
- Create: `E:\project\plug-in\SuperContentExport\LICENSE`
- Create: `E:\project\plug-in\SuperContentExport\icons\icon16.png`
- Create: `E:\project\plug-in\SuperContentExport\icons\icon48.png`
- Create: `E:\project\plug-in\SuperContentExport\icons\icon128.png`

**Interfaces:**
- Produces a standalone MV3 build root with `npm run build`, `npm run build:plain`, and `npm test` scripts.
- Manifest uses `__MSG_extName__`/`__MSG_extDesc__`, `default_locale: "en"`, `storage`, `activeTab`, `scripting`, and `<all_urls>`.

- [ ] **Step 1: Create the directory and copy only non-runtime assets**

  Create `SuperContentExport`, `icons`, `src/background`, `src/content`, `src/popup`, `_locales/en`, `_locales/zh_CN`, and `test`. Copy the existing icon files and license as independent files; do not create symlinks.

- [ ] **Step 2: Add standalone package metadata**

  Use package name `super-content-export-extension`, version `0.1.0`, and scripts:

  ```json
  {
    "scripts": {
      "build": "node build.js",
      "build:plain": "cross-env NO_OBFUSCATE=1 node build.js",
      "test": "node --test"
    }
  }
  ```

  Copy only the build-time dependencies needed by `build.js`: `archiver`, `cross-env`, `crx`, and `javascript-obfuscator`.

- [ ] **Step 3: Add the MV3 manifest**

  Set the action popup to `src/popup/popup.html`, the service worker to `src/background/background.js`, and content scripts in this order:

  ```json
  [
    "src/content/i18n-utils.js",
    "src/content/export-utils.js",
    "src/content/content.js"
  ]
  ```

- [ ] **Step 4: Run a manifest and package smoke check**

  Run from `E:\project\plug-in\SuperContentExport`:

  ```powershell
  node -e "JSON.parse(require('fs').readFileSync('manifest.json','utf8')); JSON.parse(require('fs').readFileSync('package.json','utf8')); console.log('metadata ok')"
  ```

  Expected: `metadata ok`.

### Task 2: Port the export core and regression tests

**Files:**
- Create: `E:\project\plug-in\SuperContentExport\src\content\export-utils.js`
- Create: `E:\project\plug-in\SuperContentExport\src\content\i18n-utils.js`
- Create: `E:\project\plug-in\SuperContentExport\test\export-utils.test.js`
- Create: `E:\project\plug-in\SuperContentExport\test\i18n-utils.test.js`

**Interfaces:**
- `elementToMarkdown(element): string`
- `renderElementToPng(element, options): Promise<Blob>`
- `isSameOriginResource(url, baseUrl): boolean`
- `getExportScale(width, height, requestedScale, maxPixels): number`
- `shouldRetryWithoutResources(error): boolean`
- `getCaptureTilePositions(width, height, viewportWidth, viewportHeight): Array<{x:number,y:number}>`
- `getVisibleCaptureDelay(lastCaptureAt, now, interval): number`
- `renderElementFromVisibleCaptures(element, captureVisibleTab, options): Promise<Blob>`
- `resolveMessage(key, substitution, chromeApi, fetchedMessages, locale): string`

- [ ] **Step 1: Copy the current pure Markdown and PNG tests into the new test root**

  Retain cases for headings, paragraphs, emphasis, links, nested lists, code blocks, ignored nodes, origin checks, scale limits, tainted-canvas retry decisions, viewport tile completeness, and capture throttling. Update relative imports to `../src/content/...`.

- [ ] **Step 2: Run the tests before implementation**

  Run:

  ```powershell
  npm test -- --test-reporter=spec
  ```

  Expected: FAIL because the new modules do not exist yet.

- [ ] **Step 3: Implement the standalone UMD export utility**

  Port the current implementation without any text-replacement dependency. Preserve the following behavior: computed-style cloning, cross-origin resource stripping, all-resource fallback, scale limiting, `canvas.toBlob`/`toDataURL` fallback, native visible-tab tile stitching, white opaque output background, and scroll restoration in `finally`.

- [ ] **Step 4: Implement the standalone i18n fallback utility**

  Keep explicit fetched locale messages first, then built-in Chinese/English export labels, then Chrome native i18n, then the key itself. Support `$TOKEN$` substitution.

- [ ] **Step 5: Run the focused tests**

  Run:

  ```powershell
  npm test -- --test-reporter=spec
  ```

  Expected: all export and i18n tests PASS.

### Task 3: Implement the page picker and export toolbar

**Files:**
- Create: `E:\project\plug-in\SuperContentExport\src\content\content.js`

**Interfaces:**
- Handles message `SCE_PICK_START` to enter picker mode.
- Handles message `SCE_EXPORT_ACTION` with `action` equal to `copy`, `markdown`, or `png`.
- Sends `SCE_CAPTURE_VISIBLE_TAB` to the background worker when the PNG fallback requests a tile.

- [ ] **Step 1: Add picker state and selector metadata**

  Track `pickMode`, `exportTarget`, `exportToolbar`, `exportLoading`, `exportBusy`, and the original scroll/overlay cleanup state. Hover highlighting must not remain after selection or cancellation.

- [ ] **Step 2: Add the export toolbar actions**

  The selected-element toolbar must expose exactly these actions: `复制 Markdown`, `下载 Markdown`, `导出 PNG`, and `取消`. Copy and download use `elementToMarkdown(exportTarget)`; PNG uses `renderElementToPng(exportTarget, { captureVisibleTab })`.

- [ ] **Step 3: Add PNG loading and capture cleanup**

  Before PNG rendering, disable toolbar buttons and show a full-screen status overlay. Before each native capture, hide the extension toolbar and loading overlay for two paint frames. During the capture session, hide page elements whose computed `position` is `fixed` or `sticky`, except the selected element and its ancestors. Restore all inline style attributes in a `finally` path.

- [ ] **Step 4: Add rate limiting and retry**

  Keep `lastVisibleCaptureAt`, wait using `getVisibleCaptureDelay(..., 550)`, and retry one error matching `MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND`, `too often`, or `rate limit` after 550ms.

- [ ] **Step 5: Add localized success/failure toasts and cleanup**

  Ensure copy, Markdown download, and PNG download show success messages. On any error log `[SuperContentExport] <action> export failed`, show the localized failure message, remove Loading, restore buttons, restore overlays, and keep the page usable.

- [ ] **Step 6: Run syntax validation**

  Run:

  ```powershell
  node --check src/content/content.js
  node --check src/content/export-utils.js
  ```

  Expected: exit code 0 for both commands.

### Task 4: Add the background capture bridge

**Files:**
- Create: `E:\project\plug-in\SuperContentExport\src\background\background.js`

**Interfaces:**
- Receives `{ type: "SCE_CAPTURE_VISIBLE_TAB" }` from the content script.
- Responds `{ ok: true, dataUrl }` or `{ ok: false, error }`.

- [ ] **Step 1: Implement the message listener**

  Read `sender.tab.windowId`, call `chrome.tabs.captureVisibleTab(windowId, { format: "png" }, callback)`, inspect `chrome.runtime.lastError`, and return `true` from the listener for the asynchronous response.

- [ ] **Step 2: Validate the bridge syntax**

  Run:

  ```powershell
  node --check src/background/background.js
  ```

  Expected: exit code 0.

### Task 5: Implement the minimal popup and locale resources

**Files:**
- Create: `E:\project\plug-in\SuperContentExport\src\popup\popup.html`
- Create: `E:\project\plug-in\SuperContentExport\src\popup\popup.js`
- Create: `E:\project\plug-in\SuperContentExport\_locales\en\messages.json`
- Create: `E:\project\plug-in\SuperContentExport\_locales\zh_CN\messages.json`

**Interfaces:**
- Popup sends `SCE_PICK_START` through `chrome.scripting.executeScript` or `chrome.tabs.sendMessage`.
- Popup forwards `SCE_EXPORT_ACTION` to the active tab when a selection exists.
- Popup displays the last selected element text/selector from `chrome.storage.local`.

- [ ] **Step 1: Create the minimal popup markup**

  Include the title, current selection status, a `选择元素` button, and three action buttons: `复制为 MD`, `导出为 MD`, and `导出 PNG`. Disable export buttons until `exportSelection` exists.

- [ ] **Step 2: Implement active-tab messaging**

  Query the active tab, inject the content scripts when needed, send `SCE_PICK_START`, and close the popup after starting the picker. For export buttons send `SCE_EXPORT_ACTION` and leave the selection toolbar available for repeated actions.

- [ ] **Step 3: Add English and Simplified Chinese messages**

  Include extension name/description, picker prompts, toolbar labels, Loading text, success text, empty-selection text, and failure text. Keep message keys identical between locales.

- [ ] **Step 4: Validate popup JavaScript and locale JSON**

  Run:

  ```powershell
  node --check src/popup/popup.js
  node -e "JSON.parse(require('fs').readFileSync('_locales/en/messages.json','utf8')); JSON.parse(require('fs').readFileSync('_locales/zh_CN/messages.json','utf8')); console.log('locales ok')"
  ```

  Expected: exit code 0 and `locales ok`.

### Task 6: Add independent documentation and build packaging

**Files:**
- Create: `E:\project\plug-in\SuperContentExport\README.md`
- Create: `E:\project\plug-in\SuperContentExport\README.zh-CN.md`
- Modify: `E:\project\plug-in\SuperContentExport\build.js` if the copied script still names the old extension or package artifacts.

**Interfaces:**
- `npm run build:plain` creates `dist/`, `super-content-export-v<version>.zip`, and `super-content-export-v<version>.crx` inside `SuperContentExport`.

- [ ] **Step 1: Add focused usage documentation**

  Document installation from `dist/`, picker usage, Markdown copy/download, PNG export behavior, long-page capture delay, and the limitation that browser-protected pages may reject injection or visible-tab capture.

- [ ] **Step 2: Make build artifact names independent**

  Set the ZIP and CRX names from the new package name/version rather than `text-swap`.

- [ ] **Step 3: Run the complete build and test cycle**

  Run from `E:\project\plug-in\SuperContentExport`:

  ```powershell
  npm test -- --test-reporter=spec
  npm run build:plain
  $m = Get-Content dist/manifest.json -Raw | ConvertFrom-Json
  $m.content_scripts[0].js -join ','
  ```

  Expected: all tests pass, build exits 0, and the script order is `src/content/i18n-utils.js,src/content/export-utils.js,src/content/content.js`.

- [ ] **Step 4: Verify the new plugin boundary**

  Run:

  ```powershell
  rg -n "text-swap|SuperTextSwap|TEXT_SWAP" --glob '!node_modules/**' --glob '!package-lock.json' .
  ```

  Expected: no runtime source reference to the old plugin name or message prefix.

### Task 7: Manual acceptance and final handoff

**Files:**
- Verify: `E:\project\plug-in\SuperContentExport\dist\manifest.json`
- Verify: `E:\project\plug-in\SuperContentExport\super-content-export-v0.1.0.zip`
- Verify: `E:\project\plug-in\SuperContentExport\super-content-export-v0.1.0.crx`

- [ ] **Step 1: Load the unpacked extension**

  In Chrome, open `chrome://extensions`, enable Developer mode, choose Load unpacked, and select `E:\project\plug-in\SuperContentExport\dist`.

- [ ] **Step 2: Validate the short-selection flow**

  On a normal page, click `选择元素`, select a paragraph, then verify copy Markdown, download Markdown, and short PNG export.

- [ ] **Step 3: Validate the long-selection flow**

  Select a long documentation section with sticky navigation. Verify the Loading overlay remains visible between tiles, the downloaded PNG has no repeated sticky navigation bands, no extension toolbar/Loading dark regions, and the page scroll position is restored afterward.

- [ ] **Step 4: Record any browser-only limitation**

  If a protected page rejects scripting or visible-tab capture, report the exact Chrome error and mark that case as an environment limitation rather than claiming the extension is universally compatible.
