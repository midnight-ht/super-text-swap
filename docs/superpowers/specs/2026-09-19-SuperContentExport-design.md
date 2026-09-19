# SuperContentExport Design

## Goal

Create a standalone Chrome MV3 extension named `SuperContentExport` in the sibling directory `E:\project\plug-in\SuperContentExport`. It lets a user pick a webpage element, copy its content as Markdown, download Markdown, or export the selected element as a PNG, without carrying the text replacement features from `text-swap`.

## Scope

Included:

- Popup action to start element picking.
- Page-side selection toolbar.
- Copy Markdown to the clipboard.
- Download Markdown as a `.md` file.
- Export the selected element as a PNG.
- Full-screen PNG loading state.
- Cross-origin-safe DOM rendering retry.
- Native visible-tab screenshot fallback for content that cannot be rendered through SVG/Canvas.
- Large-selection screenshot tiling, capture throttling, scroll settling, and stitching.
- Temporary hiding of extension UI and page `fixed`/`sticky` overlays during native capture.
- English and Simplified Chinese labels.
- Independent tests and build artifacts.

Excluded:

- Text replacement rules and persistent rule storage.
- Regex, URL scope, DOM replacement scope, numeric increment, and calculation features.
- Reusing source files at runtime from `text-swap`.
- Cloud sync, remote upload, OCR, or external service dependencies.

## Architecture

`SuperContentExport` is a separate MV3 extension with its own `manifest.json`, build script, package metadata, locale files, popup, content scripts, background service worker, tests, and icons. The export implementation is copied into focused standalone modules so the new extension can be built from its own directory and does not depend on the current plugin's checkout.

The page flow is:

1. The popup injects or messages the content script to enter picker mode.
2. The user clicks an element.
3. The content script shows an export toolbar and stores only the current selection metadata locally for popup state.
4. Markdown actions use the pure DOM-to-Markdown module.
5. PNG first uses cloned DOM/SVG rendering. If the canvas is tainted, it retries with external resources removed, then falls back to tiled `chrome.tabs.captureVisibleTab` screenshots.
6. The background service worker performs visible-tab capture and returns data URLs.

## PNG capture requirements

- Native capture calls are spaced by at least 550ms to stay below Chrome's documented two-calls-per-second limit.
- A rate-limit response is retried once after the same interval.
- Each tile waits for scroll/layout and two browser paint frames before capture.
- The export toolbar and loading overlay must not appear in captured tiles.
- Page elements whose computed position is `fixed` or `sticky` are temporarily hidden for the capture session and restored afterward.
- The output canvas is initialized with an opaque white background so failed alpha composition does not produce black transparent bands.
- The original page scroll position is restored in a `finally` path.

## Error handling

- Unsupported pages show a user-facing failure message and do not leave picker or loading UI behind.
- Clipboard, download, renderer, capture, and canvas errors are logged with the action name and surfaced through the localized failure toast.
- A native capture failure must not silently produce a partial PNG.
- Cleanup restores page overlays, extension UI, scroll position, and button state even when any tile fails.

## Testing and acceptance

- Unit tests cover Markdown headings, paragraphs, links, emphasis, lists, code blocks, same-origin detection, PNG scale limits, tainted-canvas retry decisions, tile positions, capture throttling, and locale fallback.
- `node --check` validates each runtime JavaScript file.
- `npm test` must pass with zero failures.
- The plain build must produce a loadable `dist/`, a versioned ZIP, and a CRX in the new plugin directory.
- Manual acceptance: reload `SuperContentExport` from `dist/`, pick a normal element, copy Markdown, download Markdown, export a short PNG, and export a long page section containing sticky navigation without repeated navigation bands or black overlay regions.

## Compatibility boundary

The current `text-swap` plugin remains unchanged by the new plugin implementation. Any later bug fix should be applied independently to both repositories or deliberately moved into a shared package in a separate task.
