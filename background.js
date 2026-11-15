// Background Service Worker: global hotkeys + routing voice commands to the right YouTube tab

// Target priority: audible YouTube tab -> the tab that sent the command -> active tab -> first YouTube tab
async function pickTargetTab(senderTab) {
  const tabs = await chrome.tabs.query({ url: "*://*.youtube.com/*" });
  if (!tabs || tabs.length === 0) return null;
  const senderIsYouTube = senderTab && tabs.find((t) => t.id === senderTab.id);
  return (
    tabs.find((t) => t.audible) ||
    senderIsYouTube ||
    tabs.find((t) => t.active) ||
    tabs[0]
  );
}

// Global keyboard shortcuts (work even when the browser is not focused)
chrome.commands.onCommand.addListener(async (command) => {
  const targetTab = await pickTargetTab(null);
  if (targetTab && targetTab.id) {
    chrome.tabs
      .sendMessage(targetTab.id, { type: "EXECUTE_ACTION", action: command })
      .catch(() => {
        // Content script might not be loaded yet if the tab wasn't refreshed
      });
  }
});

// Voice commands: the tab with the mic on sends them here, we forward to the audible tab
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === "ROUTE_ACTION") {
    pickTargetTab(sender.tab)
      .then((target) => {
        if (!target || !target.id) {
          sendResponse({ routed: false });
          return;
        }
        chrome.tabs
          .sendMessage(target.id, { type: "EXECUTE_ACTION", action: msg.action, arg: msg.arg })
          .then(() => sendResponse({ routed: true }))
          .catch(() => sendResponse({ routed: false }));
      })
      .catch(() => sendResponse({ routed: false }));
    return true; // keep the message channel open for the async response
  }
});
