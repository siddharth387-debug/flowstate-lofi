// Content Script for YouTube (100% Trusted-Types Safe + God-Mode Phonetic/Fuzzy Voice Engine)

(function () {
  // Remove any leftover UI from previous extension reloads so fresh listeners always attach
  ["lofi-voice-container", "lofi-voice-widget", "lofi-voice-toast"].forEach((id) => {
    const old = document.getElementById(id);
    if (old) old.remove();
  });

  let recognition = null;
  let isListening = false;
  let loopInterval = null;
  let loopStart = null;
  let loopEnd = null;
  let lastCommandTime = 0;
  let watchdogTimer = null;

  // Delta-cursor state so continuous recognition never re-triggers old words
  let currentResultIndex = -1;
  let consumedWordCount = 0;

  // Smart volume ducking state (lowers YouTube volume briefly while you speak)
  let savedVolume = null;
  let duckRestoreTimer = null;

  let settings = {
    rewindSeconds: 30,
    requireWakeWord: false,
    wakeWord: "lofi",
    autoDuck: true
  };

  // ================= SAFE DOM BUILDER (NO innerHTML — YOUTUBE TRUSTED-TYPES SAFE) =================
  function createEl(tag, props = {}, children = []) {
    const node = document.createElement(tag);
    Object.entries(props).forEach(([k, v]) => {
      if (k === "className") node.className = v;
      else if (k === "textContent") node.textContent = v;
      else if (k === "style" && typeof v === "object") Object.assign(node.style, v);
      else if (k.startsWith("on") && typeof v === "function") {
        node.addEventListener(k.slice(2).toLowerCase(), v);
      } else {
        node.setAttribute(k, v);
      }
    });
    children.forEach((child) => {
      if (typeof child === "string") {
        node.appendChild(document.createTextNode(child));
      } else if (child instanceof Node) {
        node.appendChild(child);
      }
    });
    return node;
  }

  function clearChildren(node) {
    while (node && node.firstChild) {
      node.removeChild(node.firstChild);
    }
  }

  // ================= SAFE STORAGE (FALLBACK TO LOCALSTORAGE) =================
  function getStorage(key, fallback, callback) {
    try {
      if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.id && chrome.storage) {
        chrome.storage.local.get([key], (res) => {
          if (chrome.runtime.lastError) {
            const raw = localStorage.getItem(key);
            callback(raw ? JSON.parse(raw) : fallback);
            return;
          }
          callback(res && res[key] !== undefined ? res[key] : fallback);
        });
        return;
      }
    } catch (e) {}
    try {
      const raw = localStorage.getItem(key);
      callback(raw ? JSON.parse(raw) : fallback);
    } catch (e) {
      callback(fallback);
    }
  }

  function setStorage(key, value, callback) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {}
    try {
      if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.id && chrome.storage) {
        chrome.storage.local.set({ [key]: value }, () => {
          if (callback) callback();
        });
        return;
      }
    } catch (e) {}
    if (callback) callback();
  }

  getStorage("lofiSettings", settings, (val) => {
    if (val) settings = { ...settings, ...val };
  });

  try {
    if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.id && chrome.storage) {
      chrome.storage.onChanged.addListener((changes) => {
        if (changes.lofiSettings && changes.lofiSettings.newValue) {
          settings = { ...settings, ...changes.lofiSettings.newValue };
        }
        if (changes.lofiBookmarks) {
          renderDrawerBookmarks();
        }
      });
    }
  } catch (e) {}

  // ================= YOUTUBE PLAYER HELPERS =================
  function formatTime(sec) {
    const s = Math.max(0, Math.floor(sec || 0));
    const hrs = Math.floor(s / 3600);
    const mins = Math.floor((s % 3600) / 60);
    const rem = s % 60;
    if (hrs > 0) {
      return `${hrs}:${String(mins).padStart(2, "0")}:${String(rem).padStart(2, "0")}`;
    }
    return `${mins}:${String(rem).padStart(2, "0")}`;
  }

  function getVideo() {
    const mainVideo = document.querySelector("video.html5-main-video");
    if (mainVideo) return mainVideo;
    const videos = Array.from(document.querySelectorAll("video"));
    return videos.find((v) => v.readyState > 0 && v.duration > 0) || videos[0] || null;
  }

  function seekVideoTo(targetSeconds) {
    const video = getVideo();
    if (!video) return false;
    const maxDur = Number.isFinite(video.duration) ? video.duration : targetSeconds + 10;
    const clamped = Math.max(0, Math.min(targetSeconds, maxDur));
    video.currentTime = clamped;
    if (video.paused) {
      video.play().catch(() => {});
    }
    return true;
  }

  function getCurrentChapterName() {
    const chapterEl = document.querySelector(".ytp-chapter-title-content");
    if (chapterEl && chapterEl.textContent && chapterEl.textContent.trim()) {
      return chapterEl.textContent.trim();
    }
    return null;
  }

  // Tracks user's explicit volume choice (0.05 to 1.0) so auto-ducking never overwrites it
  let userVolume = null;
  let lastVolumeChangeTime = 0;

  // Briefly lowers music volume when user starts speaking so mic hears voice clearly
  function duckMusicBriefly() {
    if (!settings.autoDuck) return;
    // Don't duck for 2.5 seconds after a volume command so user hears the new volume level clearly!
    if (Date.now() - lastVolumeChangeTime < 2500) return;

    const video = getVideo();
    if (!video || video.paused || video.muted) return;

    if (savedVolume === null) {
      savedVolume = userVolume !== null ? userVolume : video.volume;
      video.volume = Math.max(0.08, savedVolume * 0.25);
    }

    clearTimeout(duckRestoreTimer);
    duckRestoreTimer = setTimeout(() => {
      restoreMusicVolume();
    }, 1200);
  }

  function restoreMusicVolume() {
    clearTimeout(duckRestoreTimer);
    const video = getVideo();
    if (userVolume !== null && video) {
      video.volume = userVolume;
      savedVolume = null;
      return;
    }
    if (savedVolume !== null) {
      if (video) {
        video.volume = savedVolume;
      }
      savedVolume = null;
    }
  }

  // ================= UI UPDATES & TOAST =================
  function showToast(message) {
    let toast = document.getElementById("lofi-voice-toast");
    if (!toast) {
      toast = createEl("div", { id: "lofi-voice-toast" });
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add("visible");
    clearTimeout(toast._hideTimer);
    toast._hideTimer = setTimeout(() => {
      toast.classList.remove("visible");
    }, 2800);
  }

  function updateWidgetUI(subtext) {
    const micBtn = document.getElementById("lofi-voice-mic-btn");
    const titleEl = document.getElementById("lofi-widget-title");
    const subEl = document.getElementById("lofi-widget-sub");
    const loopBtn = document.getElementById("lofi-loop-btn");

    if (!micBtn) return;

    if (isListening) {
      micBtn.classList.add("listening");
      if (titleEl) titleEl.textContent = "🟢 God-Mode Mic ON";
    } else {
      micBtn.classList.remove("listening");
      if (titleEl) titleEl.textContent = "⚪ Mic Off (Click 🎙️)";
    }

    if (subtext && subEl) {
      subEl.textContent = subtext;
    }

    if (loopBtn) {
      if (loopStart !== null && loopEnd !== null) {
        loopBtn.classList.add("active-loop");
        loopBtn.textContent = `🔁 ${formatTime(loopStart)}–${formatTime(loopEnd)}`;
      } else {
        loopBtn.classList.remove("active-loop");
        loopBtn.textContent = "🔁 Loop";
      }
    }
  }

  // ================= CORE ACTIONS (REPLAY, LOOP, SAVE) =================
  function replaySection(customSeconds) {
    restoreMusicVolume();
    const video = getVideo();
    if (!video) {
      showToast("⚠️ Open a YouTube video first!");
      return;
    }

    const jumpBack = customSeconds || Number(settings.rewindSeconds) || 30;
    const targetTime = Math.max(0, video.currentTime - jumpBack);
    seekVideoTo(targetTime);

    const chapter = getCurrentChapterName();
    const label = chapter ? ` • ${chapter}` : "";
    showToast(`⏪ Replayed ${jumpBack}s → ${formatTime(targetTime)}${label}`);
    updateWidgetUI(`⏪ Rewound to ${formatTime(targetTime)}`);
  }

  function startLoopSection() {
    restoreMusicVolume();
    const video = getVideo();
    if (!video) {
      showToast("⚠️ Open a YouTube video first!");
      return;
    }

    const duration = Number(settings.rewindSeconds) || 30;
    loopEnd = Math.max(5, video.currentTime);
    loopStart = Math.max(0, loopEnd - duration);
    seekVideoTo(loopStart);

    clearInterval(loopInterval);
    loopInterval = setInterval(() => {
      const v = getVideo();
      if (!v || loopStart === null || loopEnd === null) return;
      if (v.currentTime >= loopEnd || v.currentTime < loopStart - 2) {
        v.currentTime = loopStart;
        if (v.paused) v.play().catch(() => {});
      }
    }, 200);

    showToast(`🔁 Looping ${formatTime(loopStart)} – ${formatTime(loopEnd)}`);
    updateWidgetUI(`🔁 Looping ${formatTime(loopStart)}–${formatTime(loopEnd)}`);
  }

  function stopLoopSection() {
    restoreMusicVolume();
    clearInterval(loopInterval);
    loopInterval = null;
    loopStart = null;
    loopEnd = null;
    showToast("🔓 Loop Stopped");
    updateWidgetUI("🔓 Loop stopped");
  }

  function toggleLoopSection() {
    if (loopStart !== null && loopEnd !== null) {
      stopLoopSection();
    } else {
      startLoopSection();
    }
  }

  function saveBookmark() {
    restoreMusicVolume();
    const video = getVideo();
    if (!video) {
      showToast("⚠️ Open a YouTube video first!");
      return;
    }

    const timestamp = Math.floor(video.currentTime);
    const title = document.title.replace(" - YouTube", "").trim() || "YouTube Lofi Mix";
    const chapter = getCurrentChapterName();
    const urlObj = new URL(window.location.href);
    const videoId = urlObj.searchParams.get("v") || "live";

    const bookmark = {
      id: `${videoId}_${timestamp}_${Date.now()}`,
      videoId,
      title,
      chapter: chapter || title,
      timestamp,
      formattedTime: formatTime(timestamp),
      createdAt: Date.now()
    };

    getStorage("lofiBookmarks", [], (list) => {
      const updated = [bookmark, ...(Array.isArray(list) ? list : [])].slice(0, 30);
      setStorage("lofiBookmarks", updated, () => {
        showToast(`🔖 Beat Saved @ ${bookmark.formattedTime}!`);
        updateWidgetUI(`🔖 Saved @ ${bookmark.formattedTime}`);
        renderDrawerBookmarks(updated);
        const drawer = document.getElementById("lofi-bookmarks-drawer");
        if (drawer) drawer.classList.add("open");
      });
    });
  }

  // ================= GOD-MODE PHONETIC + FUZZY AI CLASSIFIER =================
  // Converts any word into a consonant/phonetic skeleton so mumbled or half-baked words match!
  function phoneticSkeleton(word) {
    return word
      .toLowerCase()
      .replace(/[^a-z]/g, "")
      .replace(/ph/g, "f")
      .replace(/[bpv]/g, "p")
      .replace(/[ckq]/g, "k")
      .replace(/[dt]/g, "t")
      .replace(/[sz]/g, "s")
      .replace(/[lr]/g, "r")
      .replace(/[mn]/g, "n")
      .replace(/[aeiouyhw]/g, "")
      .replace(/(.)\1+/g, "$1");
  }

  // Levenshtein edit distance for fuzzy matching half-spoken words
  function editSimilarity(a, b) {
    if (!a || !b) return 0;
    if (a === b) return 1;
    const m = a.length;
    const n = b.length;
    const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
      }
    }
    return 1 - dp[m][n] / Math.max(m, n);
  }

  const INTENT_LEXICON = {
    STOP_LOOP: {
      phrases: [
        "stop loop",
        "end loop",
        "clear loop",
        "cancel loop",
        "no loop",
        "stop the loop",
        "exit loop",
        "stop repeating",
        "unloop"
      ],
      words: ["unloop", "unlock"],
      targets: ["unloop"]
    },
    SAVE: {
      phrases: [
        "save beat",
        "save this",
        "save it",
        "safe beat",
        "say beat",
        "same beat",
        "save the beat",
        "bookmark this",
        "mark this",
        "mark beat",
        "good beat",
        "nice beat",
        "keep this",
        "save song",
        "save track",
        "save drop"
      ],
      words: [
        "save",
        "saved",
        "saving",
        "safe",
        "shave",
        "bookmark",
        "bookmarks",
        "bookmarked",
        "mark",
        "favorite",
        "favourite",
        "keep"
      ],
      targets: ["save", "bookmark", "favorite"]
    },
    LOOP: {
      phrases: [
        "loop this",
        "look this",
        "luke this",
        "love this",
        "lock this",
        "lose this",
        "move this",
        "do this",
        "loop it",
        "look it",
        "loop section",
        "loop beat",
        "repeat this",
        "repeat section",
        "hold this"
      ],
      words: [
        "loop",
        "loops",
        "looping",
        "looped",
        "luke",
        "lup",
        "loom",
        "loose",
        "loot",
        "hoop",
        "group"
      ],
      targets: ["loop", "looping"]
    },
    REPLAY: {
      phrases: [
        "run it back",
        "play again",
        "go back",
        "we play",
        "free play",
        "three play",
        "read play",
        "red play",
        "real play",
        "pre play",
        "re play",
        "he play",
        "be play",
        "play back",
        "playback",
        "way back",
        "once more",
        "one more time",
        "play that again",
        "bring it back",
        "take it back",
        "jump back"
      ],
      words: [
        "replay",
        "re-play",
        "replayed",
        "replaying",
        "reply",
        "replied",
        "replace",
        "relay",
        "delay",
        "ebay",
        "ripley",
        "reflex",
        "reflect",
        "reload",
        "retake",
        "reset",
        "rewind",
        "rewound",
        "remind",
        "back",
        "again",
        "repeat",
        "repla",
        "rewin"
      ],
      targets: ["replay", "rewind", "repeat", "back", "again"]
    },
    STOP_MUSIC: {
      phrases: [
        "stop music",
        "stop the music",
        "stop video",
        "stop playing",
        "stop it",
        "pause music",
        "pause video",
        "pause it",
        "hold on",
        "wait a second",
        "shut up",
        "be quiet"
      ],
      words: [
        "stop",
        "stopped",
        "stopping",
        "top",
        "stab",
        "stuff",
        "step",
        "pause",
        "paused",
        "pausing",
        "pass",
        "paws",
        "pos",
        "boss",
        "quiet",
        "mute",
        "halt",
        "wait"
      ],
      targets: ["stop", "pause", "quiet", "mute"]
    },
    PLAY_MUSIC: {
      phrases: [
        "start music",
        "play music",
        "play video",
        "resume music",
        "resume video",
        "keep going",
        "carry on",
        "go ahead"
      ],
      words: [
        "play",
        "playing",
        "start",
        "resume",
        "continue",
        "unpause"
      ],
      targets: ["play", "start", "resume", "continue"]
    },
    VOLUME_DOWN: {
      phrases: [
        "volume down",
        "sound down",
        "turn it down",
        "turn down",
        "go down",
        "bring it down",
        "lower volume",
        "lower sound",
        "lover volume",
        "low volume",
        "low sound",
        "reduce volume",
        "reduce sound",
        "decrease volume",
        "decrease sound",
        "make it quieter",
        "make it low",
        "too loud",
        "background mode"
      ],
      words: [
        "lower",
        "low",
        "lover",
        "lore",
        "law",
        "slower",
        "blower",
        "mower",
        "floor",
        "down",
        "town",
        "dawn",
        "done",
        "softer",
        "soft",
        "quieter",
        "decrease",
        "reduce",
        "less",
        "dim",
        "minimum",
        "whisper"
      ],
      targets: ["lower", "lover", "softer", "quieter", "decrease", "reduce"]
    },
    VOLUME_UP: {
      phrases: [
        "volume up",
        "sound up",
        "turn it up",
        "turn up",
        "go up",
        "bring it up",
        "higher volume",
        "higher sound",
        "hire volume",
        "hire sound",
        "high volume",
        "high sound",
        "increase volume",
        "increase sound",
        "raise volume",
        "raise sound",
        "max volume",
        "full volume",
        "make it louder"
      ],
      words: [
        "higher",
        "hire",
        "hired",
        "fire",
        "hair",
        "wire",
        "tire",
        "flyer",
        "prior",
        "high",
        "hi",
        "louder",
        "loud",
        "cloud",
        "load",
        "lord",
        "up",
        "increase",
        "raise",
        "boost",
        "max",
        "maximum",
        "full"
      ],
      targets: ["higher", "hire", "louder", "increase", "boost"]
    }
  };

  // WebAudio GainNode amplifier/attenuator so YouTube's internal loudness normalization never blocks volume changes
  let audioCtx = null;
  let gainNode = null;
  let hookedVideo = null;
  let currentLevelPct = 100;

  function applyHardwareVolume(targetPct) {
    clearTimeout(duckRestoreTimer);
    lastVolumeChangeTime = Date.now();
    savedVolume = null;

    const v = getVideo();
    if (!v) return 100;

    const clampedPct = Math.max(5, Math.min(150, Math.round(targetPct)));
    currentLevelPct = clampedPct;

    // 1. Set native HTML5 video volume (0.05 to 1.0)
    const html5Vol = Math.max(0.05, Math.min(1.0, clampedPct / 100));
    userVolume = html5Vol;
    v.muted = false;
    v.volume = html5Vol;

    // 2. Also apply WebAudio GainNode so even if YouTube caps video.volume (or user boosts >100%), loudness changes cleanly
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx && hookedVideo !== v) {
        if (!audioCtx) audioCtx = new AudioCtx();
        const source = audioCtx.createMediaElementSource(v);
        gainNode = audioCtx.createGain();
        source.connect(gainNode);
        gainNode.connect(audioCtx.destination);
        hookedVideo = v;
      }
      if (audioCtx && audioCtx.state === "suspended") {
        audioCtx.resume().catch(() => {});
      }
      if (gainNode) {
        gainNode.gain.value = clampedPct / 100;
        // Keep v.volume at 1.0 when GainNode is active so GainNode has full linear control from 5% to 150%
        v.volume = 1.0;
        userVolume = 1.0;
      }
    } catch (e) {
      // Fallback to standard v.volume if MediaElementSource already bound
    }

    return clampedPct;
  }

  function adjustVolume(delta) {
    const stepPct = Math.round(delta * 100);
    const nextPct = applyHardwareVolume(currentLevelPct + stepPct);
    const icon = delta < 0 ? "🔉" : "🔊";
    showToast(`${icon} Sound ${delta < 0 ? "Lowered" : "Raised"} → ${nextPct}%`);
    updateWidgetUI(`${icon} Volume: ${nextPct}%`);
  }

  function setExactVolume(percent) {
    const nextPct = applyHardwareVolume(percent);
    showToast(`🔊 Volume Set → ${nextPct}%`);
    updateWidgetUI(`🔊 Volume: ${nextPct}%`);
  }

  const SPOKEN_NUMBERS = {
    zero: 5,
    five: 5,
    ten: 10,
    fifteen: 15,
    twenty: 20,
    thirty: 30,
    forty: 40,
    fourty: 40,
    fifty: 50,
    sixty: 60,
    seventy: 70,
    eighty: 80,
    ninety: 90,
    hundred: 100,
    full: 100,
    max: 100,
    half: 50
  };

  function extractSpokenVolumePercent(fullPoolText, wordsPool) {
    // Don't treat "replay 30" or "back 30" as volume
    if (/(?:replay|re-play|reply|replace|rewind|back)\s+\d+/.test(fullPoolText)) {
      return null;
    }

    // 1. Match "volume 30", "sound 30", "valium 30", "value 30", "follow 30", "level 30", "set 30", "30%", "30 percent"
    const digitMatch = fullPoolText.match(
      /(?:volume|valium|value|column|follow|for you|sound|found|round|level|set|at)\s+(?:to\s+|at\s+)?(\d{1,3})|(\d{1,3})\s*(?:%|percent|per cent)/
    );
    if (digitMatch) {
      const n = parseInt(digitMatch[1] || digitMatch[2], 10);
      if (n >= 1 && n <= 150) return n;
    }

    // 2. Match "volume thirty", "sound fifty", etc.
    for (const [word, num] of Object.entries(SPOKEN_NUMBERS)) {
      const rx = new RegExp(
        `(?:volume|valium|value|column|follow|sound|found|level|set)\\s+(?:to\\s+|at\\s+)?${word}\\b|\\b${word}\\s+(?:percent|per cent)`
      );
      if (rx.test(fullPoolText)) {
        return num;
      }
    }

    // 3. Even if Google drops the word "volume" and only hears a standalone number like "30" or "thirty"
    for (const w of wordsPool) {
      const clean = w.replace(/%/g, "");
      if (/^\d{1,3}$/.test(clean)) {
        const n = parseInt(clean, 10);
        if (n >= 5 && n <= 150) return n;
      }
      if (SPOKEN_NUMBERS[clean] !== undefined && clean !== "full" && clean !== "max" && clean !== "half") {
        return SPOKEN_NUMBERS[clean];
      }
    }

    return null;
  }

  function pauseMusic() {
    restoreMusicVolume();
    const v = getVideo();
    if (!v) return;
    v.pause();
    showToast("⏸️ Music Stopped");
    updateWidgetUI("⏸️ Music paused");
  }

  function resumeMusic() {
    restoreMusicVolume();
    const v = getVideo();
    if (!v) return;
    v.play().catch(() => {});
    showToast("▶️ Music Playing");
    updateWidgetUI("▶️ Music playing");
  }

  function classifyHalfBakedIntent(phrasesPool, wordsPool) {
    const joined = phrasesPool.join(" | ");

    // 1. Phrase match (check multi-word phrases first so "play again" -> REPLAY, "stop loop" -> STOP_LOOP)
    for (const [intent, data] of Object.entries(INTENT_LEXICON)) {
      if (data.phrases.some((p) => joined.includes(p))) {
        return { intent, reason: "phrase" };
      }
    }

    // 2. Direct & prefix word match (catches half-spoken words like "repla", "rewi", "bookm", "loo", "sto", "pau")
    for (const w of wordsPool) {
      if (w.length < 2) continue;
      if (INTENT_LEXICON.STOP_LOOP.words.includes(w)) return { intent: "STOP_LOOP", reason: w };
      if (INTENT_LEXICON.SAVE.words.includes(w) || w.startsWith("bookm") || w.startsWith("favo")) {
        return { intent: "SAVE", reason: w };
      }
      if (INTENT_LEXICON.LOOP.words.includes(w) || w.startsWith("loop")) {
        return { intent: "LOOP", reason: w };
      }
      if (
        INTENT_LEXICON.REPLAY.words.includes(w) ||
        w.startsWith("repla") ||
        w.startsWith("rewin") ||
        w.startsWith("re-pl")
      ) {
        return { intent: "REPLAY", reason: w };
      }
      if (INTENT_LEXICON.STOP_MUSIC.words.includes(w) || w.startsWith("paus") || w.startsWith("stop")) {
        return { intent: "STOP_MUSIC", reason: w };
      }
      if (INTENT_LEXICON.PLAY_MUSIC.words.includes(w) || w.startsWith("resum")) {
        return { intent: "PLAY_MUSIC", reason: w };
      }
      if (INTENT_LEXICON.VOLUME_DOWN.words.includes(w) || w.startsWith("quieter") || w.startsWith("softer")) {
        return { intent: "VOLUME_DOWN", reason: w };
      }
      if (INTENT_LEXICON.VOLUME_UP.words.includes(w) || w.startsWith("louder") || w.startsWith("higher")) {
        return { intent: "VOLUME_UP", reason: w };
      }
    }

    // 3. Fuzzy Levenshtein + Phonetic Skeleton match (catches mumbled/half-baked words!)
    for (const w of wordsPool) {
      if (w.length < 3) continue;
      const skel = phoneticSkeleton(w);

      // Phonetic skeletons:
      // "rpl" = replay/ripley/replace/reply
      // "rwnt" / "rwnd" = rewind
      // "bkmrk" = bookmark
      // "stp" = stop
      if (skel === "rpl" || skel === "rpr" || skel === "rwnt" || skel === "rwn") {
        return { intent: "REPLAY", reason: `phonetic(${w})` };
      }
      if (skel === "bkmrk" || skel === "bknrk") {
        return { intent: "SAVE", reason: `phonetic(${w})` };
      }
      if (skel === "stp") {
        return { intent: "STOP_MUSIC", reason: `phonetic(${w})` };
      }

      // Edit similarity >= 0.72 against core targets
      for (const [intent, data] of Object.entries(INTENT_LEXICON)) {
        for (const target of data.targets) {
          if (editSimilarity(w, target) >= 0.72) {
            return { intent, reason: `fuzzy(${w}~${target})` };
          }
        }
      }
    }

    return null;
  }

  function processResultStream(resultIndex, latestResult) {
    if (resultIndex !== currentResultIndex) {
      currentResultIndex = resultIndex;
      consumedWordCount = 0;
    }

    const primaryTranscript = (latestResult[0]?.transcript || "").toLowerCase().trim();
    if (!primaryTranscript) return;

    const allWords = primaryTranscript.split(/\s+/).filter(Boolean);
    if (consumedWordCount > allWords.length) {
      consumedWordCount = Math.max(0, allWords.length - 2);
    }

    const newWords = allWords.slice(consumedWordCount);
    if (newWords.length === 0) return;

    // Collect top 10 alternative acoustic hypotheses for the newly spoken words
    const phrasesPool = [newWords.join(" ")];
    const wordsPool = [...newWords];

    for (let a = 1; a < latestResult.length; a++) {
      const altTranscript = (latestResult[a]?.transcript || "").toLowerCase().trim();
      if (!altTranscript) continue;
      const altWords = altTranscript.split(/\s+/).filter(Boolean);
      const tailSlice = altWords.slice(Math.max(0, altWords.length - (newWords.length + 1)));
      phrasesPool.push(tailSlice.join(" "));
      wordsPool.push(...tailSlice);
    }

    // Live UI feedback
    updateWidgetUI(`🎙️ "${newWords.slice(-4).join(" ")}"`);

    const now = Date.now();
    if (now - lastCommandTime < 750) return;

    const fullPoolText = phrasesPool.join(" ");

    if (settings.requireWakeWord) {
      const wake = (settings.wakeWord || "lofi").toLowerCase();
      if (!fullPoolText.includes(wake) && !fullPoolText.includes("lo-fi") && !fullPoolText.includes("low fi")) {
        return;
      }
    }

    let triggered = false;

    // Check custom volume e.g. "volume 30", "volume thirty", "30 percent", or standalone "30"
    const spokenVolPct = extractSpokenVolumePercent(fullPoolText, wordsPool);
    if (spokenVolPct !== null) {
      setExactVolume(spokenVolPct);
      triggered = true;
    }

    // Check custom seconds e.g. "replay 45" or "back 60"
    if (!triggered) {
      const numMatch = fullPoolText.match(/(?:replay|re-play|reply|replace|rewind|back)\s+(\d+)/);
      if (numMatch) {
        const secs = parseInt(numMatch[1], 10);
        if (secs > 0 && secs <= 600) {
          replaySection(secs);
          triggered = true;
        }
      }
    }

    if (!triggered) {
      const match = classifyHalfBakedIntent(phrasesPool, wordsPool);
      if (match) {
        if (match.intent === "STOP_LOOP") {
          stopLoopSection();
          triggered = true;
        } else if (match.intent === "SAVE") {
          saveBookmark();
          triggered = true;
        } else if (match.intent === "LOOP") {
          startLoopSection();
          triggered = true;
        } else if (match.intent === "REPLAY") {
          replaySection();
          triggered = true;
        } else if (match.intent === "STOP_MUSIC") {
          pauseMusic();
          triggered = true;
        } else if (match.intent === "PLAY_MUSIC") {
          resumeMusic();
          triggered = true;
        } else if (match.intent === "VOLUME_DOWN") {
          adjustVolume(-0.25);
          triggered = true;
        } else if (match.intent === "VOLUME_UP") {
          adjustVolume(0.25);
          triggered = true;
        }
      }
    }

    if (triggered) {
      lastCommandTime = now;
      consumedWordCount = allWords.length;
    }
  }

  // ================= SPEECH RECOGNITION LIFECYCLE =================
  function initSpeechRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      showToast("⚠️ Web Speech API not supported in this browser.");
      updateWidgetUI("Speech API unsupported");
      return null;
    }

    const rec = new SpeechRecognition();
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 10;
    rec.lang = navigator.language && navigator.language.startsWith("en") ? navigator.language : "en-US";

    rec.onstart = () => {
      currentResultIndex = -1;
      consumedWordCount = 0;
      updateWidgetUI("Say: Replay • Loop • Save");
    };

    rec.onspeechstart = () => {
      duckMusicBriefly();
    };

    rec.onspeechend = () => {
      restoreMusicVolume();
    };

    rec.onresult = (event) => {
      const idx = event.results.length - 1;
      if (idx < 0) return;
      processResultStream(idx, event.results[idx]);
    };

    rec.onerror = (event) => {
      if (event.error === "no-speech" || event.error === "aborted") return;
      console.warn("[Lofi Voice] Speech Error:", event.error);
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        isListening = false;
        updateWidgetUI("❌ Mic Blocked (Allow in URL bar)");
        showToast("🎙️ Microphone blocked! Click the tune/lock icon next to youtube.com in the address bar and Allow Microphone.");
      } else if (event.error === "network") {
        isListening = false;
        updateWidgetUI("❌ Browser blocks Speech API");
        showToast("⚠️ Brave blocks Google Speech API! Please test in Google Chrome or Microsoft Edge.");
      } else if (event.error === "audio-capture") {
        isListening = false;
        updateWidgetUI("❌ No Mic Found");
        showToast("⚠️ No working microphone detected.");
      }
    };

    rec.onend = () => {
      restoreMusicVolume();
      if (isListening) {
        // Synchronous restart (0ms) so background tab throttling never kills the mic when away from desk
        try {
          rec.start();
        } catch (e) {
          setTimeout(() => {
            if (isListening) {
              try {
                rec.start();
              } catch (err) {}
            }
          }, 30);
        }
      }
    };

    return rec;
  }

  // Bluetooth Headset Hardware Media Button Integration (MediaSession API)
  // Lets you double-tap / press "Previous Track" on your Bluetooth earbuds from another room to Replay!
  function bindBluetoothMediaSession() {
    if (!("mediaSession" in navigator)) return;
    try {
      navigator.mediaSession.setActionHandler("previoustrack", () => {
        replaySection();
      });
      navigator.mediaSession.setActionHandler("seekbackward", () => {
        replaySection();
      });
      navigator.mediaSession.setActionHandler("nexttrack", () => {
        toggleLoopSection();
      });
    } catch (e) {}
  }

  // Check if Chrome is accidentally listening to the Laptop Internal Mic instead of the Bluetooth Headset Mic
  async function checkBluetoothMicRouting() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = devices.filter((d) => d.kind === "audioinput");
      const defaultMic = audioInputs.find((d) => d.deviceId === "default") || audioInputs[0];
      const btMic = audioInputs.find((d) =>
        /bluetooth|hands-free|headset|airpods|buds|rockerz|sony|jbl|bose|wh-|wf-/i.test(d.label)
      );

      if (defaultMic && defaultMic.label) {
        const isDefaultInternal = /internal|realtek|array|laptop|pc/i.test(defaultMic.label);
        if (isDefaultInternal && btMic) {
          showToast(
            `🎧 Tip: Chrome is using "${defaultMic.label}". Switch Chrome/Windows Mic to "${btMic.label}" for walk-away Bluetooth range!`
          );
        }
      }
    } catch (e) {}
  }

  // Auto-rebind speech recognition when Bluetooth headset connects/disconnects
  if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
    navigator.mediaDevices.addEventListener("devicechange", () => {
      if (isListening && recognition) {
        try {
          recognition.stop();
        } catch (e) {}
      }
    });
  }

  // Synchronous user-gesture handler (NO async/await before recognition.start!)
  function toggleVoiceListening() {
    if (!recognition) {
      recognition = initSpeechRecognition();
      if (!recognition) return;
    }

    if (isListening) {
      isListening = false;
      clearInterval(watchdogTimer);
      restoreMusicVolume();
      try {
        recognition.stop();
      } catch (e) {}
      showToast("⚪ Voice Control Off");
      updateWidgetUI("Click 🎙️ to start");
    } else {
      isListening = true;
      updateWidgetUI("Starting mic...");
      bindBluetoothMediaSession();
      try {
        recognition.start();
        showToast("🟢 God-Mode Mic ON! Say 'Replay', 'Loop', 'Save', or 'Stop'");
      } catch (e) {
        // Already started
      }

      checkBluetoothMicRouting();

      // Watchdog: recycle session every 25s so Google's stream never stalls on background music
      clearInterval(watchdogTimer);
      watchdogTimer = setInterval(() => {
        bindBluetoothMediaSession();
        if (isListening && recognition && Date.now() - lastCommandTime > 4000) {
          try {
            recognition.stop();
          } catch (e) {}
        }
      }, 25000);
    }
  }

  // ================= SAVED BEATS DRAWER & WIDGET (100% CREATE-ELEMENT) =================
  function renderDrawerBookmarks(providedList) {
    const listEl = document.getElementById("lofi-drawer-list");
    const countBtn = document.getElementById("lofi-drawer-toggle-btn");
    if (!listEl) return;

    const render = (bookmarks) => {
      const items = Array.isArray(bookmarks) ? bookmarks : [];
      if (countBtn) {
        countBtn.textContent = `📂 (${items.length})`;
      }
      clearChildren(listEl);

      if (items.length === 0) {
        listEl.appendChild(
          createEl("div", {
            textContent: 'No saved beats yet. Click "🔖 Save" or say "Save"!',
            style: { fontSize: "11px", color: "#a1a1aa", padding: "4px 0" }
          })
        );
        return;
      }

      items.forEach((bm) => {
        const row = createEl(
          "div",
          {
            className: "lofi-drawer-item",
            onclick: () => {
              if (window.location.href.includes(bm.videoId) || bm.videoId === "live") {
                seekVideoTo(bm.timestamp);
                showToast(`⏩ Jumped to ${bm.formattedTime}`);
              } else {
                window.location.href = `https://www.youtube.com/watch?v=${bm.videoId}&t=${bm.timestamp}s`;
              }
            }
          },
          [
            createEl("span", {
              className: "lofi-drawer-item-title",
              title: bm.title || "",
              textContent: bm.chapter || bm.title || "Saved Beat"
            }),
            createEl("span", {
              className: "lofi-drawer-item-time",
              textContent: `▶ ${bm.formattedTime}`
            })
          ]
        );
        listEl.appendChild(row);
      });
    };

    if (providedList) {
      render(providedList);
    } else {
      getStorage("lofiBookmarks", [], render);
    }
  }

  function injectWidget() {
    if (document.getElementById("lofi-voice-container")) return;

    const drawerList = createEl("div", { id: "lofi-drawer-list" });
    const drawerHeader = createEl("div", { className: "lofi-drawer-header" }, [
      createEl("span", { textContent: "🔖 Saved Beat Drops" }),
      createEl("button", {
        className: "lofi-drawer-clear",
        id: "lofi-drawer-clear-btn",
        textContent: "Clear All",
        onclick: () => setStorage("lofiBookmarks", [], () => renderDrawerBookmarks([]))
      })
    ]);

    const drawer = createEl("div", { id: "lofi-bookmarks-drawer" }, [drawerHeader, drawerList]);

    const micBtn = createEl("button", {
      id: "lofi-voice-mic-btn",
      title: "Toggle Voice Control",
      textContent: "🎙️",
      onclick: toggleVoiceListening
    });

    const statusBox = createEl("div", { className: "lofi-widget-status" }, [
      createEl("span", {
        className: "lofi-widget-title",
        id: "lofi-widget-title",
        textContent: "⚪ Mic Off (Click 🎙️)"
      }),
      createEl("span", {
        className: "lofi-widget-sub",
        id: "lofi-widget-sub",
        textContent: "Say: Replay • Loop • Save"
      })
    ]);

    const replayBtn = createEl("button", {
      className: "lofi-quick-btn",
      id: "lofi-replay-btn",
      title: "Replay section (Alt+Shift+R)",
      textContent: "⏪ Replay",
      onclick: () => replaySection()
    });

    const loopBtn = createEl("button", {
      className: "lofi-quick-btn",
      id: "lofi-loop-btn",
      title: "Toggle Loop section (Alt+Shift+L)",
      textContent: "🔁 Loop",
      onclick: toggleLoopSection
    });

    const saveBtn = createEl("button", {
      className: "lofi-quick-btn",
      id: "lofi-save-btn",
      title: "Save current beat timestamp (Alt+Shift+B)",
      textContent: "🔖 Save",
      onclick: saveBookmark
    });

    const volDownBtn = createEl("button", {
      className: "lofi-quick-btn",
      id: "lofi-voldown-btn",
      title: "Lower volume -25% (or say 'Lower' / 'Down')",
      textContent: "🔉 -",
      onclick: () => adjustVolume(-0.25)
    });

    const volUpBtn = createEl("button", {
      className: "lofi-quick-btn",
      id: "lofi-volup-btn",
      title: "Raise volume +25% (or say 'Higher' / 'Up')",
      textContent: "🔊 +",
      onclick: () => adjustVolume(0.25)
    });

    const drawerToggleBtn = createEl("button", {
      className: "lofi-quick-btn",
      id: "lofi-drawer-toggle-btn",
      title: "View Saved Beats",
      textContent: "📂 (0)",
      onclick: () => drawer.classList.toggle("open")
    });

    const widget = createEl("div", { id: "lofi-voice-widget" }, [
      micBtn,
      statusBox,
      replayBtn,
      loopBtn,
      saveBtn,
      volDownBtn,
      volUpBtn,
      drawerToggleBtn
    ]);

    const container = createEl("div", { id: "lofi-voice-container" }, [drawer, widget]);
    document.body.appendChild(container);

    renderDrawerBookmarks();
  }

  // Also add single-key on-page shortcuts when not typing in search/comments:
  // Shift+R = Replay, Shift+L = Loop, Shift+S = Save Beat, Shift+M = Toggle Mic
  document.addEventListener("keydown", (e) => {
    const tag = (e.target && e.target.tagName) || "";
    if (tag === "INPUT" || tag === "TEXTAREA" || (e.target && e.target.isContentEditable)) {
      return;
    }
    if (e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
      if (e.key === "R" || e.key === "r") {
        e.preventDefault();
        replaySection();
      } else if (e.key === "L" || e.key === "l") {
        e.preventDefault();
        toggleLoopSection();
      } else if (e.key === "S" || e.key === "s") {
        e.preventDefault();
        saveBookmark();
      } else if (e.key === "M" || e.key === "m") {
        e.preventDefault();
        toggleVoiceListening();
      }
    }
  });

  // Handle messages from Popup or Background Hotkeys
  try {
    if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.onMessage) {
      chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
        if (msg.type === "EXECUTE_ACTION") {
          if (msg.action === "replay-section") replaySection();
          if (msg.action === "toggle-loop") toggleLoopSection();
          if (msg.action === "save-bookmark") saveBookmark();
          if (msg.action === "toggle-mic") toggleVoiceListening();
          if (msg.action === "jump-to-time" && typeof msg.timestamp === "number") {
            seekVideoTo(msg.timestamp);
            showToast(`⏩ Jumped to saved beat (${formatTime(msg.timestamp)})`);
          }
          sendResponse({ ok: true, isListening, loopActive: loopStart !== null });
        } else if (msg.type === "GET_STATUS") {
          sendResponse({
            isListening,
            loopActive: loopStart !== null,
            chapter: getCurrentChapterName()
          });
        }
        return true;
      });
    }
  } catch (e) {}

  injectWidget();
  document.addEventListener("yt-navigate-finish", injectWidget);
})();
