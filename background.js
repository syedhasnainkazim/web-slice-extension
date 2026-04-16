chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {

  // ── Screenshot capture ──────────────────────────────────────────────────────
  // Content script requests a full-viewport PNG, then crops it client-side.
  if (msg.action === "captureTab") {
    chrome.tabs.captureVisibleTab(
      sender.tab.windowId,
      { format: "png" },
      (dataUrl) => {
        if (chrome.runtime.lastError) {
          sendResponse({ dataUrl: null });
        } else {
          sendResponse({ dataUrl });
        }
      }
    );
    return true; // keep the message channel open for the async response
  }

  // ── Capture state persistence ───────────────────────────────────────────────
  // Keeps storage in sync so the popup shows the correct toggle state on open.
  if (msg.action === "startCapture") {
    chrome.storage.local.set({ capturing: true });
  }
  if (msg.action === "stopCapture" || msg.action === "captureStopped") {
    chrome.storage.local.set({ capturing: false });
  }
});
