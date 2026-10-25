async function getYouTubeTab() {
  const tabs = await chrome.tabs.query({ url: "*://*.youtube.com/*" });
  return tabs.find((t) => t.audible) || tabs.find((t) => t.active) || tabs[0];
}

async function sendAction(action, extra = {}) {
  const tab = await getYouTubeTab();
  if (!tab) return null;
  try {
    return await chrome.tabs.sendMessage(tab.id, {
      type: "EXECUTE_ACTION",
      action,
      ...extra
    });
  } catch (e) {
    return null;
  }
}

function updateMicButton(isListening) {
  const btn = document.getElementById("toggle-mic-btn");
  if (!btn) return;
  if (isListening) {
    btn.textContent = "🟢 Listening...";
    btn.classList.add("active");
  } else {
    btn.textContent = "🎙️ Start Mic";
    btn.classList.remove("active");
  }
}

function renderBookmarks(bookmarks = []) {
  const container = document.getElementById("bookmarks-list");
  if (!container) return;
  container.textContent = "";

  if (!bookmarks.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = 'No saved beats yet. Say "Save" or "Save beat" when a good drop hits!';
    container.appendChild(empty);
    return;
  }

  bookmarks.forEach((bm) => {
    const item = document.createElement("div");
    item.className = "bookmark-item";

    const info = document.createElement("span");
    info.className = "bm-info";
    info.title = bm.title || "";
    info.textContent = bm.chapter || bm.title || "Saved Beat";

    const time = document.createElement("span");
    time.className = "bm-time";
    time.textContent = `▶ ${bm.formattedTime}`;

    item.appendChild(info);
    item.appendChild(time);

    item.addEventListener("click", async () => {
      const tab = await getYouTubeTab();
      if (tab && tab.url && tab.url.includes(bm.videoId)) {
        sendAction("jump-to-time", { timestamp: bm.timestamp });
      } else {
        chrome.tabs.create({
          url: `https://www.youtube.com/watch?v=${bm.videoId}&t=${bm.timestamp}s`
        });
      }
    });
    container.appendChild(item);
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  const rewindSelect = document.getElementById("rewind-select");
  const wakeToggle = document.getElementById("wake-word-toggle");

  chrome.storage.local.get(["lofiSettings", "lofiBookmarks"], (res) => {
    if (res.lofiSettings) {
      rewindSelect.value = String(res.lofiSettings.rewindSeconds || 30);
      wakeToggle.checked = Boolean(res.lofiSettings.requireWakeWord);
    }
    renderBookmarks(res.lofiBookmarks || []);
  });

  chrome.storage.onChanged.addListener((changes) => {
    if (changes.lofiBookmarks) {
      renderBookmarks(changes.lofiBookmarks.newValue || []);
    }
  });

  const tab = await getYouTubeTab();
  if (tab) {
    try {
      const status = await chrome.tabs.sendMessage(tab.id, { type: "GET_STATUS" });
      if (status) updateMicButton(status.isListening);
    } catch (e) {}
  }

  function saveSettings() {
    const lofiSettings = {
      rewindSeconds: Number(rewindSelect.value),
      requireWakeWord: wakeToggle.checked
    };
    chrome.storage.local.set({ lofiSettings });
  }

  rewindSelect.addEventListener("change", saveSettings);
  wakeToggle.addEventListener("change", saveSettings);

  document.getElementById("toggle-mic-btn").addEventListener("click", async () => {
    const res = await sendAction("toggle-mic");
    if (res) updateMicButton(res.isListening);
  });

  document.getElementById("btn-replay").addEventListener("click", () => sendAction("replay-section"));
  document.getElementById("btn-loop").addEventListener("click", () => sendAction("toggle-loop"));
  document.getElementById("btn-bookmark").addEventListener("click", () => sendAction("save-bookmark"));

  document.getElementById("clear-bookmarks").addEventListener("click", () => {
    chrome.storage.local.set({ lofiBookmarks: [] }, () => renderBookmarks([]));
  });
});
