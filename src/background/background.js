const POPUP_PATH = 'src/popup/popup.html';

async function applyDisplayMode(mode) {
  const normalized = mode === 'sidebar' ? 'sidebar' : 'popup';
  if (normalized === 'sidebar' && !chrome.sidePanel?.setPanelBehavior) {
    throw new Error('Side panel API unavailable');
  }

  await chrome.action.setPopup({
    popup: normalized === 'sidebar' ? '' : POPUP_PATH,
  });

  if (chrome.sidePanel?.setPanelBehavior) {
    await chrome.sidePanel.setPanelBehavior({
      openPanelOnActionClick: normalized === 'sidebar',
    });
  }

  return normalized;
}

async function restoreDisplayMode() {
  const { displayMode } = await chrome.storage.local.get(['displayMode']);
  await applyDisplayMode(displayMode);
}

chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') {
    await chrome.storage.sync.set({ rules: [] });
    await chrome.storage.local.set({ displayMode: 'popup' });
    await applyDisplayMode('popup');
  } else {
    restoreDisplayMode().catch(() => {});
  }
});

chrome.runtime.onStartup.addListener(() => {
  restoreDisplayMode().catch(() => {});
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'TEXT_SWAP_SET_DISPLAY_MODE') {
    const mode = message.mode === 'sidebar' ? 'sidebar' : 'popup';
    Promise.all([
      chrome.storage.local.set({ displayMode: mode }),
      applyDisplayMode(mode),
    ])
      .then(() => sendResponse({ ok: true, mode }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === 'TEXT_SWAP_OPEN_POPUP') {
    chrome.storage.local.get(['displayMode']).then(({ displayMode }) => {
      if (displayMode === 'sidebar' && sender.tab?.windowId !== undefined && chrome.sidePanel?.open) {
        chrome.sidePanel.open({ windowId: sender.tab.windowId }).catch(() => {});
        chrome.runtime.sendMessage({ type: 'TEXT_SWAP_RESTORE_PICKER' }).catch(() => {});
        return;
      }
      if (chrome.action.openPopup) {
        chrome.action.openPopup().catch(() => {
          // Silently ignore: older Chrome or user-gesture required.
        });
      }
    }).catch(() => {});
  }
});
