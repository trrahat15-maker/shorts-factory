const STORAGE_CONFIG = "sfd_config";
const STORAGE_AUTOMATION = "sfd_automation_enabled";
const STORAGE_LAST_RUN = "sfd_last_run";

const state = {
  config: {},
  selectedBaseVideo: null,
  lastVoiceFile: null,
  lastVideoFile: null,
  musicTracks: [],
  automationEnabled: false,
  automationUpload: false,
};

let schedulerId = null;

function $(selector) {
  return document.querySelector(selector);
}

function setStatus(selector, message) {
  const el = $(selector);
  if (!el) return;
  el.textContent = message;
}

function showTab(name) {
  document.querySelectorAll(".panel").forEach((panel) => panel.classList.add("hidden"));
  document.getElementById(name).classList.remove("hidden");
  document.querySelectorAll(".tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.tab === name));
}

async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (state.config.appAccessToken) {
    headers.set("x-app-token", state.config.appAccessToken);
  }
  const res = await fetch(path, { ...options, headers });
  if (!res.ok) {
    if (res.status === 401) {
      setStatus("#home-status", "App locked. Enter your App Access Token in Settings.");
    }
    const body = await res.text();
    throw new Error(body || res.statusText);
  }
  return res.json();
}

function getLocalConfig() {
  const raw = localStorage.getItem(STORAGE_CONFIG);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function saveLocalConfig(config) {
  localStorage.setItem(STORAGE_CONFIG, JSON.stringify(config));
}

async function deriveKey(password, salt) {
  const enc = new TextEncoder();
  const keyMaterial = await window.crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return window.crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: salt,
      iterations: 250000,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

async function encryptConfig(obj, password) {
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const salt = window.crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveKey(password, salt);
  const data = new TextEncoder().encode(JSON.stringify(obj));
  const encrypted = await window.crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, data);
  const payload = {
    iv: arrayBufferToBase64(iv),
    salt: arrayBufferToBase64(salt),
    data: arrayBufferToBase64(encrypted),
  };
  return JSON.stringify(payload);
}

async function decryptConfig(encrypted, password) {
  const payload = JSON.parse(encrypted);
  const iv = base64ToArrayBuffer(payload.iv);
  const salt = base64ToArrayBuffer(payload.salt);
  const data = base64ToArrayBuffer(payload.data);
  const key = await deriveKey(password, salt);
  const decrypted = await window.crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, data);
  return JSON.parse(new TextDecoder().decode(decrypted));
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
}

function base64ToArrayBuffer(base64) {
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

function normalizeConfig(config = {}) {
  return {
    defaultPrompt: config.defaultPrompt || "Write a 30 second motivational speech for YouTube Shorts. Hook the viewer in the first sentence. Use simple powerful language.",
    defaultVoice: config.defaultVoice || "alloy",
    defaultTitle: config.defaultTitle || "Daily Motivation",
    defaultDescription: config.defaultDescription || "Daily motivational shorts.\n\nSubscribe for more success mindset content.\n\n#motivation #success #discipline",
    defaultTags: Array.isArray(config.defaultTags) ? config.defaultTags : ["motivation", "success", "discipline"],
    videosPerDay: Number(config.videosPerDay) || 1,
    uploadTime: config.uploadTime || "09:00",
    openaiModel: config.openaiModel || "gpt-4o-mini",
    openaiBaseUrl: config.openaiBaseUrl || "",
    autoMetadata: config.autoMetadata !== false,
    channelContext: config.channelContext || "motivational shorts",
    analysisVideoCount: Number(config.analysisVideoCount) || 30,
    appAccessToken: config.appAccessToken || "",
    maxDuration: Number(config.maxDuration) || 0,
    subtitleStyle: {
      fontSize: Number(config.subtitleStyle?.fontSize) || 64,
      outline: Number(config.subtitleStyle?.outline) || 4,
    },
    defaultMusic: config.defaultMusic || "",
  };
}

function applyConfigToUI(config) {
  $("#script-prompt").value = config.defaultPrompt;
  $("#default-prompt").value = config.defaultPrompt;
  $("#default-voice").value = config.defaultVoice;
  $("#voice-voice").value = config.defaultVoice;
  $("#default-title").value = config.defaultTitle;
  $("#video-title").value = config.defaultTitle;
  const descriptionField = $("#video-description");
  if (descriptionField) descriptionField.value = config.defaultDescription;
  const tagsField = $("#video-tags");
  if (tagsField) tagsField.value = (config.defaultTags || []).join(", ");
  $("#default-description").value = config.defaultDescription;
  $("#default-tags").value = (config.defaultTags || []).join(", ");
  $("#videos-per-day").value = config.videosPerDay;
  $("#upload-time").value = config.uploadTime;
  $("#openai-model").value = config.openaiModel;
  $("#openai-base").value = config.openaiBaseUrl;
  const appToken = $("#app-token");
  if (appToken) appToken.value = config.appAccessToken || "";
  $("#default-max-duration").value = config.maxDuration || 0;
  $("#max-duration").value = config.maxDuration || 0;
  $("#subtitle-size").value = config.subtitleStyle?.fontSize || 64;
  $("#subtitle-outline").value = config.subtitleStyle?.outline || 4;
  const autoMetadata = $("#auto-metadata");
  if (autoMetadata) autoMetadata.checked = config.autoMetadata !== false;
  const channelContext = $("#channel-context");
  if (channelContext) channelContext.value = config.channelContext || "";
  const analysisCount = $("#analysis-video-count");
  if (analysisCount) analysisCount.value = config.analysisVideoCount || 30;
  const analysisContext = $("#analysis-channel-context");
  if (analysisContext) analysisContext.value = config.channelContext || "";
}

async function loadSettings() {
  let config = getLocalConfig();
  if (!config) {
    config = await api("/api/config");
    saveLocalConfig(config);
  }
  state.config = normalizeConfig(config);
  applyConfigToUI(state.config);
  setStatus("#save-status", "Settings loaded.");
}

async function saveConfig() {
  const defaultTags = $("#default-tags").value
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

  const config = normalizeConfig({
    defaultPrompt: $("#default-prompt").value.trim(),
    defaultVoice: $("#default-voice").value.trim(),
    defaultTitle: $("#default-title").value.trim(),
    defaultDescription: $("#default-description").value.trim(),
    defaultTags,
    videosPerDay: Number($("#videos-per-day").value) || 1,
    uploadTime: $("#upload-time").value || "09:00",
    openaiModel: $("#openai-model").value.trim() || "gpt-4o-mini",
    openaiBaseUrl: $("#openai-base").value.trim(),
    autoMetadata: $("#auto-metadata")?.checked ?? true,
    channelContext: $("#channel-context")?.value?.trim() || "motivational shorts",
    analysisVideoCount: Number($("#analysis-video-count")?.value) || 30,
    appAccessToken: $("#app-token")?.value?.trim() || state.config.appAccessToken || "",
    maxDuration: Number($("#default-max-duration").value) || 0,
    subtitleStyle: {
      fontSize: Number($("#subtitle-size").value) || 64,
      outline: Number($("#subtitle-outline").value) || 4,
    },
    defaultMusic: $("#default-music").value,
  });

  state.config = config;
  saveLocalConfig(config);

  try {
    await api("/api/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config),
    });
  } catch (err) {
    console.error(err);
  }

  setStatus("#save-status", "Settings saved.");
  startScheduler();
}

function updateVaultStatus() {
  const status = document.querySelector("#vault-status");
  if (status) {
    status.textContent = "API keys are managed server-side via GitHub Secrets.";
  }
}

function getLocalDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

async function refreshBaseList() {
  try {
    const data = await api("/api/base/list");
    const list = $("#base-list");
    list.innerHTML = "";
    const select = $("#base-video");
    select.innerHTML = "";

    if (Array.isArray(data.videos) && data.videos.length) {
      data.videos.forEach((filename) => {
        const li = document.createElement("li");
        li.textContent = filename;
        list.appendChild(li);

        const option = document.createElement("option");
        option.value = filename;
        option.textContent = filename;
        select.appendChild(option);
      });
      state.selectedBaseVideo = select.value;
    } else {
      list.innerHTML = "<li>No base videos uploaded yet.</li>";
      select.innerHTML = "<option value=\"\">(Upload a base video)</option>";
    }
  } catch (err) {
    console.error(err);
  }
}

async function refreshMusicList() {
  try {
    const data = await api("/api/music/list");
    const tracks = Array.isArray(data.tracks) ? data.tracks : [];
    state.musicTracks = tracks;

    const select = $("#music-select");
    const defaultSelect = $("#default-music");
    select.innerHTML = "<option value=\"\">None</option>";
    defaultSelect.innerHTML = "<option value=\"\">None</option>";

    tracks.forEach((track) => {
      const option = document.createElement("option");
      option.value = track;
      option.textContent = track;
      select.appendChild(option);

      const option2 = document.createElement("option");
      option2.value = track;
      option2.textContent = track;
      defaultSelect.appendChild(option2);
    });

    if (state.config.defaultMusic) {
      select.value = state.config.defaultMusic;
      defaultSelect.value = state.config.defaultMusic;
    }
  } catch (err) {
    console.error(err);
  }
}

async function refreshHistory() {
  try {
    const data = await api("/api/history");
    const list = $("#history");
    list.innerHTML = "";
    (data.history || []).slice(0, 25).forEach((item) => {
      const li = document.createElement("li");
      const when = new Date(item.createdAt).toLocaleString();
      li.innerHTML = `<strong>${item.title}</strong> <small>${when}</small> <span>${item.status}</span> `;
      if (item.file) {
        const download = document.createElement("a");
        download.textContent = "Download";
        download.href = `/api/files/generated/${item.file}`;
        download.setAttribute("download", "");
        download.className = "button";
        li.appendChild(download);
      }
      list.appendChild(li);
    });
  } catch (err) {
    console.error(err);
  }
}

async function handleUploadBase(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  setStatus("#upload-status", "Uploading...");
  const form = new FormData();
  form.append("file", file);
  try {
    const response = await fetch("/api/base/upload", { method: "POST", body: form });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || "Upload failed");
    }
    setStatus("#upload-status", "Uploaded successfully.");
    await refreshBaseList();
  } catch (err) {
    console.error(err);
    setStatus("#upload-status", err.message || "Upload failed.");
  }
}

async function handleUploadMusic(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  setStatus("#save-status", "Uploading music...");
  const form = new FormData();
  form.append("file", file);
  try {
    await fetch("/api/music/upload", { method: "POST", body: form });
    await refreshMusicList();
    setStatus("#save-status", "Music uploaded.");
  } catch (err) {
    console.error(err);
    setStatus("#save-status", "Music upload failed.");
  }
}

async function handleGenerateScript() {
  const prompt = $("#script-prompt").value || state.config.defaultPrompt;
  setStatus("#home-status", "Generating script...");
  try {
    const { script } = await api("/api/script", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt,
        baseUrl: state.config.openaiBaseUrl,
        model: state.config.openaiModel,
      }),
    });
    $("#script-output").value = script;
    setStatus("#metadata-status", "");
    setStatus("#home-status", "Script generated.");
  } catch (err) {
    console.error(err);
    setStatus("#home-status", "Script generation failed.");
  }
}

async function handleGenerateMetadata() {
  const script = $("#script-output").value.trim();
  if (!script) {
    setStatus("#metadata-status", "Generate a script first.");
    return;
  }
  setStatus("#metadata-status", "Generating metadata...");
  try {
    const result = await api("/api/metadata", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        script,
        baseUrl: state.config.openaiBaseUrl,
        model: state.config.openaiModel,
        channelContext: state.config.channelContext,
      }),
    });
    if (result.title) $("#video-title").value = result.title;
    if (result.description) $("#video-description").value = result.description;
    if (result.tags?.length) $("#video-tags").value = result.tags.join(", ");
    setStatus("#metadata-status", "Metadata generated.");
  } catch (err) {
    console.error(err);
    setStatus("#metadata-status", "Metadata generation failed.");
  }
}

async function handleGenerateVoice() {
  const text = $("#script-output").value.trim();
  if (!text) {
    setStatus("#voice-status", "Generate a script first.");
    return;
  }
  const voice = $("#voice-voice").value.trim() || state.config.defaultVoice || "alloy";
  setStatus("#voice-status", "Generating voice...");

  try {
    const result = await api("/api/voice", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, voice }),
    });
    state.lastVoiceFile = result.file;
    setStatus("#voice-status", "Voice generated.");
  } catch (err) {
    console.error(err);
    setStatus("#voice-status", "Voice generation failed. Check server keys.");
  }
}

async function generateBrowserVoice(text) {
  if (!("speechSynthesis" in window)) {
    setStatus("#voice-status", "Browser TTS not supported.");
    return;
  }
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 1;
  utterance.pitch = 1;
  const voices = speechSynthesis.getVoices();
  const voice = voices.find((v) => v.name.includes("English")) || voices[0];
  if (voice) utterance.voice = voice;
  utterance.onend = () => setStatus("#voice-status", "Browser voice previewed. ElevenLabs is required for export.");
  utterance.onerror = () => setStatus("#voice-status", "Browser TTS failed.");
  speechSynthesis.speak(utterance);
}

async function handleGenerateVideo() {
  const baseVideo = $("#base-video").value;
  if (!baseVideo) {
    setStatus("#video-status", "Select a base video first.");
    return;
  }
  if (!state.lastVoiceFile) {
    setStatus("#video-status", "Generate voice first.");
    return;
  }

  const script = $("#script-output").value.trim();
  if (!script) {
    setStatus("#video-status", "Generate a script first.");
    return;
  }

  const title = $("#video-title").value.trim() || state.config.defaultTitle || "Daily Short";
  const maxDuration = Number($("#max-duration").value) || state.config.maxDuration || 0;
  const musicFile = $("#music-select").value || state.config.defaultMusic || "";

  setStatus("#video-status", "Generating video (this may take a minute)...");
  try {
    const result = await api("/api/video", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        baseVideo,
        voiceFile: state.lastVoiceFile,
        script,
        title,
        musicFile,
        maxDuration: maxDuration || 0,
        subtitleStyle: state.config.subtitleStyle,
      }),
    });
    state.lastVideoFile = result.file;
    $("#upload-youtube").disabled = false;
    const preview = $("#preview");
    preview.src = result.url;
    const download = $("#download-link");
    download.href = result.url;
    download.classList.remove("hidden");
    setStatus("#video-status", "Video generated.");
    await refreshHistory();
  } catch (err) {
    console.error(err);
    setStatus("#video-status", "Video generation failed.");
  }
}

async function handleAutomation(isScheduled = false) {
  setStatus("#automation-status", "Running automation...");
  try {
    const result = await api("/api/automation/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        openaiBaseUrl: state.config.openaiBaseUrl,
        openaiModel: state.config.openaiModel,
        voice: state.config.defaultVoice,
        upload: state.automationUpload,
        maxDuration: state.config.maxDuration,
        musicFile: state.config.defaultMusic,
      }),
    });
    setStatus("#automation-status", `Automation complete. Generated ${result.results.length} videos.`);
    if (isScheduled) {
      localStorage.setItem(STORAGE_LAST_RUN, getLocalDateKey());
    }
    await refreshHistory();
  } catch (err) {
    console.error(err);
    setStatus("#automation-status", "Automation failed.");
  }
}

async function handleUploadYoutube() {
  if (!state.lastVideoFile) {
    setStatus("#video-status", "Generate a video first.");
    return;
  }
  setStatus("#video-status", "Uploading to YouTube...");
  try {
    const tokens = await api("/api/youtube/tokens");
    if (!tokens.connected) {
      setStatus("#video-status", "Connect YouTube in Settings first.");
      return;
    }
    const title = $("#video-title").value.trim() || state.config.defaultTitle;
    const description = $("#video-description")?.value.trim() || state.config.defaultDescription;
    const tagsInput = $("#video-tags")?.value || "";
    const tags = tagsInput
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);
    await api("/api/youtube/upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        videoFile: state.lastVideoFile,
        title,
        description,
        tags: tags.length ? tags : state.config.defaultTags,
      }),
    });
    setStatus("#video-status", "Uploaded to YouTube.");
  } catch (err) {
    console.error(err);
    setStatus("#video-status", "Upload failed.");
  }
}

async function handleConnectYoutube() {
  try {
    const { url } = await api("/api/youtube/auth-url");
    window.location = url;
  } catch (err) {
    console.error(err);
    setStatus("#youtube-status", "Failed to connect YouTube.");
  }
}

async function checkYoutubeStatus() {
  try {
    const tokens = await api("/api/youtube/tokens");
    if (tokens.connected) {
      setStatus("#youtube-status", "YouTube connected.");
    } else {
      setStatus("#youtube-status", "Not connected.");
    }
  } catch (err) {
    console.error(err);
  }
}

async function handleAnalyzeChannel() {
  setStatus("#analysis-status", "Analyzing channel...");
  try {
    const channelId = $("#analysis-channel-id")?.value.trim();
    const channelContext = $("#analysis-channel-context")?.value.trim() || state.config.channelContext;
    const maxVideos = Number($("#analysis-video-count")?.value) || state.config.analysisVideoCount || 30;
    const result = await api("/api/channel/analysis", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        baseUrl: state.config.openaiBaseUrl,
        model: state.config.openaiModel,
        channelId,
        channelContext,
        maxVideos,
      }),
    });
    const report = result.report || "No report returned.";
    const output = $("#analysis-output");
    if (output) output.textContent = report;
    setStatus("#analysis-status", "Analysis complete.");
  } catch (err) {
    console.error(err);
    setStatus("#analysis-status", "Channel analysis failed.");
  }
}

// ====== DASHBOARD & TRENDS FUNCTIONS ======

async function refreshDashboard() {
  try {
    // Best Time
    try {
      const bestTime = await api("/api/optimizer/best-time");
      const btEl = $("#home-best-time");
      if (bestTime) {
        btEl.innerHTML = `
          <div class="stat-card">
            <div class="stat-value">${bestTime.recommendedTime || bestTime.bestHourLabel || "N/A"}</div>
            <div class="stat-label">${bestTime.label || "Best Upload Time"}</div>
            <div class="stat-detail">${bestTime.reasoning || ""}</div>
          </div>
        `;
      } else {
        btEl.innerHTML = `<p>Connect YouTube to analyze your best upload time.</p>`;
      }
    } catch (err) {
      $("#home-best-time").innerHTML = `<p>Connect YouTube for personalized analytics.</p>`;
    }

    // Trending Topics from Reddit
    try {
      const redditData = await api("/api/trends/reddit?limit=5");
      const trEl = $("#home-trending");
      if (redditData.topics?.length) {
        const list = redditData.topics.slice(0, 5).map((topic) =>
          `<li class="trend-item">🔥 ${topic}</li>`
        ).join("");
        trEl.innerHTML = `<ul class="trend-list">${list}</ul>`;
      } else {
        trEl.innerHTML = `<p>No trends available right now.</p>`;
      }
    } catch (err) {
      $("#home-trending").innerHTML = `<p>Trend feed unavailable.</p>`;
    }

    // Trending Hashtags
    try {
      const niche = state.config.channelContext?.split(" ")[0] || "motivation";
      const hashData = await api(`/api/trends/hashtags?niche=${encodeURIComponent(niche)}&limit=10`);
      const hsEl = $("#home-hashtags");
      if (hashData.hashtags?.length) {
        const tags = hashData.hashtags.slice(0, 10).map((tag) =>
          `<span class="hashtag-badge">${tag}</span>`
        ).join(" ");
        hsEl.innerHTML = `<div class="hashtag-cloud">${tags}</div>`;
      } else {
        hsEl.innerHTML = `<p>Generate script first to see hashtags.</p>`;
      }
    } catch (err) {
      $("#home-hashtags").innerHTML = `<p>Hashtag feed unavailable.</p>`;
    }
  } catch (err) {
    console.error("Dashboard refresh error:", err);
  }
}

async function refreshBestTime() {
  const display = $("#best-time-display");
  display.innerHTML = `<p class="loading">Analyzing your channel...</p>`;
  try {
    const data = await api("/api/optimizer/best-time");
    if (data && data.bestHourLabel) {
      const hourBuckets = data.hourRanking || [];
      const hoursHtml = hourBuckets.slice(0, 8).map((h) => {
        const pct = Math.round((h.score / (hourBuckets[0]?.score || 1)) * 100);
        return `
          <div class="bar-row">
            <span class="bar-label">${h.hour}:00</span>
            <div class="bar-track">
              <div class="bar-fill" style="width:${pct}%"></div>
            </div>
            <span class="bar-value">${h.avgViews || 0} views</span>
          </div>
        `;
      }).join("");

      display.innerHTML = `
        <div class="best-time-result">
          <div class="stat-card highlight">
            <div class="stat-value">${data.recommendedTime || data.bestHourLabel}</div>
            <div class="stat-label">${data.label || "Best Upload Time"}</div>
            <div class="stat-detail">${data.reasoning || ""}</div>
          </div>
          <div class="best-day">
            Best day: <strong>${data.bestDayName || "Monday"}</strong>
          </div>
          <div class="hour-ranking">
            <h4>Hour Performance Ranking</h4>
            <div class="bar-chart">${hoursHtml}</div>
          </div>
          <div class="data-note">
            Based on ${data.sampleSize || 0} videos analyzed
          </div>
        </div>
      `;
    } else {
      display.innerHTML = `<p>Not enough data yet. Keep uploading videos!</p>`;
    }
  } catch (err) {
    display.innerHTML = `<p>Connect YouTube to analyze your best upload time.</p>`;
  }
}

async function refreshRedditTrends() {
  const display = $("#reddit-trends");
  display.innerHTML = `<p class="loading">Fetching trends...</p>`;
  try {
    const data = await api("/api/trends/reddit?limit=10");
    if (data.topics?.length) {
      const list = data.topics.map((topic, i) =>
        `<li class="trend-item" onclick="copyToClipboard('${topic.replace(/'/g, "\\'")}')">
          <span class="trend-rank">#${i + 1}</span>
          <span class="trend-text">${topic}</span>
        </li>`
      ).join("");
      display.innerHTML = `
        <p class="trend-hint">Click a topic to copy it (use in script prompt)</p>
        <ol class="trend-list">${list}</ol>
      `;
    } else {
      display.innerHTML = `<p>No Reddit trends available right now.</p>`;
    }
  } catch (err) {
    display.innerHTML = `<p>Failed to fetch trends.</p>`;
  }
}

async function refreshHackerNewsTrends() {
  const display = $("#hackernews-trends");
  display.innerHTML = `<p class="loading">Fetching trends...</p>`;
  try {
    const data = await api("/api/trends/hackernews?limit=10");
    if (data.topics?.length) {
      const list = data.topics.map((topic, i) =>
        `<li class="trend-item" onclick="copyToClipboard('${topic.replace(/'/g, "\\'")}')">
          <span class="trend-rank">#${i + 1}</span>
          <span class="trend-text">${topic}</span>
        </li>`
      ).join("");
      display.innerHTML = `
        <p class="trend-hint">Click a topic to copy it</p>
        <ol class="trend-list">${list}</ol>
      `;
    } else {
      display.innerHTML = `<p>No HackerNews trends available right now.</p>`;
    }
  } catch (err) {
    display.innerHTML = `<p>Failed to fetch trends.</p>`;
  }
}

async function refreshHashtags() {
  const topic = $("#hashtag-topic").value.trim() || state.config.channelContext || "motivation";
  const display = $("#hashtag-display");
  display.innerHTML = `<p class="loading">Generating hashtags...</p>`;
  try {
    const data = await api(`/api/trends/hashtags?topic=${encodeURIComponent(topic)}&limit=20`);
    if (data.hashtags?.length) {
      const tags = data.hashtags.map((tag) =>
        `<span class="hashtag-badge clickable" onclick="copyToClipboard('${tag}')">${tag}</span>`
      ).join(" ");
      display.innerHTML = `
        <p class="trend-hint">Click to copy, then paste into your video tags</p>
        <div class="hashtag-cloud">${tags}</div>
        <button class="secondary copy-all" onclick="copyAllHashtags()">Copy All Hashtags</button>
      `;
    } else {
      display.innerHTML = `<p>No hashtags generated.</p>`;
    }
  } catch (err) {
    display.innerHTML = `<p>Failed to generate hashtags.</p>`;
  }
}

async function refreshTagPerformance() {
  const display = $("#tag-performance-display");
  try {
    const data = await api("/api/optimizer/tag-performance?minViews=10");
    if (data.tags?.length) {
      const tags = data.tags.slice(0, 15).map((tag) => `
        <div class="tag-perf-row">
          <span class="tag-name">#${tag.tag}</span>
          <span class="tag-stats">
            ${tag.avgViews} avg views · ${tag.uses} uses · score: ${tag.score}
          </span>
          <div class="tag-bar">
            <div class="tag-bar-fill" style="width:${Math.min(100, (tag.score / (data.tags[0]?.score || 1)) * 100)}%"></div>
          </div>
        </div>
      `).join("");
      display.innerHTML = `<div class="tag-perf-list">${tags}</div>`;
    } else {
      display.innerHTML = `<p>Upload videos first to see tag performance data.</p>`;
    }
  } catch (err) {
    display.innerHTML = `<p>Tag performance unavailable.</p>`;
  }
}

// Copy helper functions
window.copyToClipboard = function(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).catch(() => {});
  } else {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    document.body.removeChild(textarea);
  }
};

window.copyAllHashtags = function() {
  const tags = document.querySelectorAll("#hashtag-display .hashtag-badge");
  const text = Array.from(tags).map(t => t.textContent).join(" ");
  copyToClipboard(text);
};

function scheduleAutomationIfEnabled() {
  if (!state.automationEnabled) return;
  const lastRun = localStorage.getItem(STORAGE_LAST_RUN);
  const now = new Date();
  const [hours, minutes] = (state.config.uploadTime || "09:00").split(":").map(Number);
  const scheduled = new Date(now);
  scheduled.setHours(hours, minutes, 0, 0);

  if (now >= scheduled && lastRun !== getLocalDateKey()) {
    handleAutomation(true);
  }
}

function startScheduler() {
  if (schedulerId) {
    clearInterval(schedulerId);
    schedulerId = null;
  }
  if (!state.automationEnabled) return;
  scheduleAutomationIfEnabled();
  schedulerId = setInterval(scheduleAutomationIfEnabled, 30000);
}

function applyAutomationToggles() {
  $("#enable-automation").checked = state.automationEnabled;
  $("#automation-upload").checked = state.automationUpload;
}

function readAutomationToggles() {
  state.automationEnabled = $("#enable-automation").checked;
  state.automationUpload = $("#automation-upload").checked;
  localStorage.setItem(STORAGE_AUTOMATION, JSON.stringify({
    enabled: state.automationEnabled,
    upload: state.automationUpload,
  }));
}

function loadAutomationToggles() {
  const raw = localStorage.getItem(STORAGE_AUTOMATION);
  if (!raw) return;
  try {
    const data = JSON.parse(raw);
    state.automationEnabled = Boolean(data.enabled);
    state.automationUpload = Boolean(data.upload);
  } catch {
    state.automationEnabled = false;
    state.automationUpload = false;
  }
}

function attachListeners() {
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => showTab(tab.dataset.tab));
  });

  $("#upload-base").addEventListener("change", handleUploadBase);
  $("#generate-script").addEventListener("click", handleGenerateScript);
  $("#generate-metadata").addEventListener("click", handleGenerateMetadata);
  $("#generate-voice").addEventListener("click", handleGenerateVoice);
  $("#generate-video").addEventListener("click", handleGenerateVideo);
  $("#upload-youtube").addEventListener("click", handleUploadYoutube);
  $("#save-settings").addEventListener("click", saveConfig);
  $("#run-automation").addEventListener("click", () => handleAutomation(false));
  $("#connect-youtube").addEventListener("click", handleConnectYoutube);
  const unlockBtn = $("#unlock-vault");
  if (unlockBtn) {
    unlockBtn.addEventListener("click", () => {
      setStatus("#vault-status", "API keys are managed server-side via GitHub Secrets.");
    });
  }
  $("#music-upload").addEventListener("change", handleUploadMusic);
  $("#run-analysis").addEventListener("click", handleAnalyzeChannel);

  $("#base-video").addEventListener("change", (event) => {
    state.selectedBaseVideo = event.target.value;
  });

  $("#enable-automation").addEventListener("change", () => {
    readAutomationToggles();
    startScheduler();
  });

  $("#automation-upload").addEventListener("change", readAutomationToggles);

  // Trends tab listeners
  $("#refresh-best-time").addEventListener("click", refreshBestTime);
  $("#refresh-reddit").addEventListener("click", refreshRedditTrends);
  $("#refresh-hackernews").addEventListener("click", refreshHackerNewsTrends);
  $("#refresh-hashtags").addEventListener("click", refreshHashtags);
}

async function init() {
  attachListeners();
  loadAutomationToggles();
  applyAutomationToggles();
  $("#upload-youtube").disabled = true;
  await loadSettings();
  updateVaultStatus();
  await refreshBaseList();
  await refreshMusicList();
  await refreshHistory();
  await checkYoutubeStatus();
  showTab("home");
  startScheduler();

  const params = new URLSearchParams(window.location.search);
  if (params.get("youtube") === "connected") {
    setStatus("#youtube-status", "YouTube connected.");
  }

  // Load dashboard and trends data
  refreshDashboard();
  refreshBestTime();
  refreshRedditTrends();
  refreshHackerNewsTrends();
  refreshHashtags();
  refreshTagPerformance();
}

init().catch((err) => console.error(err));