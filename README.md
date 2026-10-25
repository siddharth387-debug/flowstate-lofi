# 🎧 Lofi Loop & Voice Replay (Chrome Extension)

**Stay in your coding flow state.** Control YouTube Lo-Fi mixes, tutorials, and long audio sets completely hands-free using voice commands or quick hotkeys—without ever leaving your IDE or dragging a tiny 3-hour timeline scrubber.

---

## ✨ Why I Built This
When coding or studying to a 2-hour YouTube Lo-Fi mix, a specific 30-second beat subsection often hits that you want to hear again. Normally, you have to `Alt+Tab` out of your code, hunt down the YouTube tab, and carefully drag the timeline slider back (usually overshooting by 10 minutes).

**Lofi Loop & Voice Replay** lets you simply say **"Replay"**, **"Loop"**, **"Save"**, or **"Stop"** out loud to control the exact subsection hands-free.

---

## 🚀 Key Features
- **⚡ Zero-Latency Phonetic & Fuzzy Voice Engine:** Uses a custom **Phonetic Skeleton + Levenshtein Edit-Distance Classifier** on live interim Web Speech streams (`maxAlternatives = 10`) so even casual, mumbled, or accented commands trigger in sub-second time.
- **🔉 Smart Audio Auto-Ducking:** Automatically dips the YouTube video volume briefly when speech is detected so background music doesn't drown out your microphone.
- **🔁 Instant A–B Section Looping:** Say `"Loop"` to continuously loop the current beat section (`currentTime - rewindSeconds` to `currentTime`).
- **🔖 Beat Drop Bookmarks (On-Page Drawer + Popup):** Say `"Save"` or `"Bookmark"` to save the exact timestamp and chapter name, accessible directly from the floating YouTube widget or extension popup.
- **⌨️ Hotkey Fallbacks:** Works with `Shift+R` (Replay), `Shift+L` (Loop), `Shift+S` (Save Beat), and `Shift+M` (Toggle Mic), plus global Chrome shortcuts (`Alt+Shift+R`, `Alt+Shift+L`, `Alt+Shift+B`).

---

## 🗣️ Voice Commands

| Voice Command | Action | Shortcut |
| :--- | :--- | :--- |
| **"Replay"** / **"Back"** / **"Rewind"** | Jumps back by configured duration (default `30s`) | `Shift+R` / `Alt+Shift+R` |
| **"Replay 45"** | Jumps back by custom seconds (`1s`–`600s`) | — |
| **"Loop"** / **"Loop this"** | Loops the current beat subsection continuously | `Shift+L` / `Alt+Shift+L` |
| **"Stop loop"** / **"Unloop"** | Clears the active loop while keeping music playing | `Shift+L` |
| **"Save"** / **"Save beat"** / **"Bookmark"** | Saves the current timestamp & chapter to your Beat Drops | `Shift+S` / `Alt+Shift+B` |
| **"Stop"** / **"Pause"** | Pauses the YouTube music immediately | — |
| **"Play"** / **"Resume"** | Resumes playback | — |

---

## 🛠️ Installation (Developer Mode)
1. Clone this repository:
   ```bash
   git clone https://github.com/siddharth387-debug/flowstate-lofi.git
   ```
2. Open **Google Chrome** or **Microsoft Edge** and navigate to `chrome://extensions/`.
3. Enable **Developer mode** in the top-right corner.
4. Click **Load unpacked** and select the `flowstate-lofi` folder.
5. Open any YouTube video, click the **🎙️** button on the floating bottom-left widget, and say **"Replay"**!

---

## 🧩 Tech Stack
- **Chrome Extension Manifest V3** (Content Scripts, Service Worker, `chrome.storage`, `chrome.commands`)
- **Web Speech API (`webkitSpeechRecognition`)** with Sliding Delta-Cursor Stream Processing
- **Phonetic Skeleton & Levenshtein Fuzzy Matching** for noise-resilient voice intent classification
- **Trusted-Types Compliant DOM Architecture** (`createElement` UI engine for strict `www.youtube.com` CSP compatibility)
