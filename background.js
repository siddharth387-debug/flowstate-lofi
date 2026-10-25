// Background Service Worker for Global Hotkeys & Tab Messaging

chrome.commands.onCommand.addListener(async (command) => {
  const tabs = await chrome.tabs.query({ url: "*://*.youtube.com/*" });
  if (!tabs || tabs.length === 0) return;

  // Prefer active or audible YouTube tab
  const targetTab = tabs.find((t) => t.audible) || tabs.find((t) => t.active) || tabs[0];

  if (targetTab && targetTab.id) {
    chrome.tabs.sendMessage(targetTab.id, {
      type: "EXECUTE_ACTION",
      action: command
    }).catch(() => {
      // Content script might not be loaded yet if tab wasn't refreshed
    });
  }
});
