const STORAGE_CONFIG = "sfd_config";
const STORAGE_VAULT = "sfd_vault";
const STORAGE_AUTOMATION = "sfd_automation_enabled";
const STORAGE_LAST_RUN = "sfd_last_run";

const state = {
  config: {},
  secrets: { openaiKey: "", elevenLabsKey: "" },
  vaultUnlocked: false,
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

  await saveVaultIfNeeded();
  setStatus("#save-status", "Settings saved.");
  startScheduler();
}

async function saveVaultIfNeeded() {
  const openaiKey = $("#openai-key").value.trim();
  const elevenLabsKey = $("#elevenlabs-key").value.trim();
  const hasSecrets = openaiKey || elevenLabsKey;

  if (!hasSecrets) {
    return;
  }

  const password = $("#vault-password").value.trim();
  if (!password) {
    setStatus("#vault-status", "Add a vault password to encrypt your keys.");
    return;
  }

  const encrypted = await encryptConfig({ openaiKey, elevenLabsKey }, password);
  localStorage.setItem(STORAGE_VAULT, encrypted);
  state.secrets = { openaiKey, elevenLabsKey };
  state.vaultUnlocked = true;
  setStatus("#vault-status", "Vault saved and unlocked.");
}

async function unlockVault() {
  const encrypted = localStorage.getItem(STORAGE_VAULT);
  if (!encrypted) {
    setStatus("#vault-status", "No vault found. Save settings to create one.");
    return;
  }
  const password = $("#vault-password").value.trim();
  if (!password) {
    setStatus("#vault-status", "Enter your vault password.");
    return;
  }

  try {
    const secrets = await decryptConfig(encrypted, password);
    state.secrets = secrets;
    state.vaultUnlocked = true;
    $("#openai-key").value = secrets.openaiKey || "";
    $("#elevenlabs-key").value = secrets.elevenLabsKey || "";
    setStatus("#vault-status", "Vault unlocked.");
  } catch (err) {
    console.error(err);
    setStatus("#vault-status", "Vault unlock failed. Check password.");
  }
}

function updateVaultStatus() {
  const encrypted = localStorage.getItem(STORAGE_VAULT);
  if (encrypted) {
    setStatus("#vault-status", state.vaultUnlocked ? "Vault unlocked." : "Vault locked.");
  } else {
    setStatus("#vault-status", "No vault saved yet.");
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
      const download = document.createElement("a");
      download.textContent = "Download";
      download.href = `/uploads/generated/${item.file}`;
      download.setAttribute("download", "");
      download.className = "button";
      li.innerHTML = `<strong>${item.title}</strong> <small>${when}</small> <span>${item.status}</span> `;
      li.appendChild(download);
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
  const key = state.secrets.openaiKey;
  if (!key) {
    setStatus("#home-status", "Unlock the vault and add your OpenAI key in Settings.");
    return;
  }
  setStatus("#home-status", "Generating script...");
  try {
    const { script } = await api("/api/script", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt,
        apiKey: key,
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
  const key = state.secrets.openaiKey;
  if (!script) {
    setStatus("#metadata-status", "Generate a script first.");
    return;
  }
  if (!key) {
    setStatus("#metadata-status", "Unlock the vault and add your OpenAI key in Settings.");
    return;
  }
  setStatus("#metadata-status", "Generating metadata...");
  try {
    const result = await api("/api/metadata", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        script,
        apiKey: key,
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
  const elevenKey = state.secrets.elevenLabsKey;
  const voice = $("#voice-voice").value.trim() || state.config.defaultVoice || "alloy";
  setStatus("#voice-status", "Generating voice...");

  if (elevenKey) {
    try {
      const result = await api("/api/voice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, voice, elevenLabsApiKey: elevenKey }),
      });
      state.lastVoiceFile = result.file;
      setStatus("#voice-status", "Voice generated.");
    } catch (err) {
      console.error(err);
      setStatus("#voice-status", "ElevenLabs failed. Try again.");
    }
  } else {
    await generateBrowserVoice(text);
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
  if (!state.secrets.openaiKey || !state.secrets.elevenLabsKey) {
    setStatus("#automation-status", "Unlock vault and add OpenAI + ElevenLabs keys.");
    return;
  }

  setStatus("#automation-status", "Running automation...");
  try {
    const result = await api("/api/automation/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        openaiKey: state.secrets.openaiKey,
        openaiBaseUrl: state.config.openaiBaseUrl,
        openaiModel: state.config.openaiModel,
        elevenLabsKey: state.secrets.elevenLabsKey,
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
    if (!tokens.access_token) {
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
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
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
    if (tokens.access_token) {
      setStatus("#youtube-status", "YouTube connected.");
    } else {
      setStatus("#youtube-status", "Not connected.");
    }
  } catch (err) {
    console.error(err);
  }
}

async function handleAnalyzeChannel() {
  const key = state.secrets.openaiKey;
  if (!key) {
    setStatus("#analysis-status", "Unlock the vault and add your OpenAI key in Settings.");
    return;
  }
  setStatus("#analysis-status", "Analyzing channel...");
  try {
    const channelId = $("#analysis-channel-id")?.value.trim();
    const channelContext = $("#analysis-channel-context")?.value.trim() || state.config.channelContext;
    const maxVideos = Number($("#analysis-video-count")?.value) || state.config.analysisVideoCount || 30;
    const result = await api("/api/channel/analysis", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        apiKey: key,
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
  $("#unlock-vault").addEventListener("click", unlockVault);
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
}

init().catch((err) => console.error(err));
