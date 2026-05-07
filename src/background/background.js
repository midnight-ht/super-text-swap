chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    chrome.storage.sync.set({ rules: [] });
  }
});

// Reopen the popup after element picker completes.
// chrome.action.openPopup() is available since Chrome 127 and can be called
// from a service worker without a user gesture.
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'TEXT_SWAP_OPEN_POPUP') {
    if (chrome.action.openPopup) {
      chrome.action.openPopup().catch(() => {
        // Silently ignore: older Chrome or user-gesture required
      });
    }
  }
});
