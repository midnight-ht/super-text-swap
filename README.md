# SuperTextSwap

**English** | **[中文文档](README.zh-CN.md)**

A Chrome extension that automatically replaces specified text on any web page based on custom rules. Designed for content creators, operators, and testers.

![en poster](./public/en%20-%20poster.png)

---

## Features

| Feature          | Description                                                       |
| ---------------- | ----------------------------------------------------------------- |
| Custom rules     | Add find-and-replace pairs with one click                         |
| Instant apply    | Rules take effect immediately — no page reload needed             |
| Dynamic pages    | Handles React / Vue / infinite-scroll via MutationObserver        |
| URL scope        | Restrict a rule to all pages, current domain, or a custom pattern |
| DOM scope        | Limit replacement to a CSS-selected element; pick it visually     |
| Input fields     | Optionally replace text inside `input` / `textarea`               |
| Rich text        | Optionally replace text inside `contenteditable` editors          |
| i18n             | UI switches between Simplified Chinese and English                |
| Persistent rules | Rules survive browser restarts via `chrome.storage.sync`          |

---

## Installation

### Method 1 — CRX (recommended for end users)

1. Download `text-swap-vX.X.X.crx` from [Releases](../../releases).
2. Open `chrome://extensions/` and enable **Developer mode** (top-right toggle).
3. Drag the `.crx` file directly onto the page and confirm the installation prompt.

> Chrome may warn that the extension is not from the Web Store. Click **Add extension** to proceed.

### Method 2 — ZIP (load unpacked)

1. Download `text-swap-vX.X.X.zip` from [Releases](../../releases).
2. Extract the ZIP to any local folder.
3. Open `chrome://extensions/` and enable **Developer mode**.
4. Click **Load unpacked** and select the extracted folder.

> This method does not require a signed key. Useful for testing or corporate deployment.

### From Source

```bash
git clone https://github.com/YOUR_USERNAME/text-swap.git
cd text-swap
npm install
npm run build        # produces dist/ and text-swap-vX.X.X.zip/.crx
```

Load the unpacked `dist/` folder via Chrome → Extensions → **Load unpacked**.

---

## Usage

1. Click the **SuperTextSwap** icon in the Chrome toolbar.
2. Enter the **From** text and the **To** replacement.
3. Expand **Scope & Targets** to restrict by URL or DOM element (optional).
4. Click **Add Rule** — the current page updates instantly.
5. Click **⟳ Apply Now** to re-apply all rules to the current tab at any time.

### Element Picker

Click **⊕ Pick** → the popup closes and a blue highlight follows your cursor. Click any element to capture its CSS selector. Reopen the popup to find the selector pre-filled.

---

## Project Structure

```
text-swap/
├── manifest.json            Chrome Manifest V3
├── _locales/
│   ├── en/messages.json     English strings
│   └── zh_CN/messages.json  Simplified Chinese strings
├── src/
│   ├── popup/               Extension popup (HTML + JS)
│   ├── content/             Content script injected into pages
│   └── background/          Service Worker
├── icons/                   Extension icons (16 / 48 / 128 px)
├── build.js                 Build & packaging script
└── .github/workflows/       GitHub Actions release pipeline
```

---

## Build & Package

```bash
npm install          # first time only
npm run build
```

| Output                 | Purpose                                                                |
| ---------------------- | ---------------------------------------------------------------------- |
| `dist/`                | Obfuscated source — load unpacked in Chrome for testing                |
| `text-swap-vX.X.X.zip` | Upload to Chrome Web Store                                             |
| `text-swap-vX.X.X.crx` | Signed package for direct distribution                                 |
| `key.pem`              | RSA signing key — **back this up**; losing it changes the extension ID |

> `.js` files are obfuscated with `javascript-obfuscator`. `.json` files are minified. Binary and HTML files are copied as-is.

---

## Releases (GitHub Actions)

Pushing a version tag triggers the release pipeline automatically.

### One-time setup

Store `key.pem` as a repository secret so CI can sign the CRX consistently:

1. Go to **Settings → Secrets and variables → Actions → New repository secret**.
2. Name: `EXTENSION_KEY_PEM`
3. Value: paste the full contents of your local `key.pem`.

### Create a release

```bash
git tag v0.2.0
git push origin v0.2.0
```

GitHub Actions will build, sign, and attach the `.zip` and `.crx` to a new GitHub Release automatically.

---

## Roadmap

| Version  | Goal                                                |
| -------- | --------------------------------------------------- |
| **v0.1** | DOM text replacement MVP ← _current_                |
| v0.2     | Rule toggle, domain scope, regex, import/export     |
| v0.3     | Platform rule packs, AI-feel expression replacement |
| v0.4     | Image OCR + overlay preview                         |
| v0.5     | Canvas image redraw & export                        |

---

## License

[MIT License — Non-Commercial](LICENSE)

Free for personal and non-commercial use. Commercial use requires written authorization.  
Contact: <ht@zyweb.vip>

![en appreciate](./public/en%20-%20appreciate.png)
