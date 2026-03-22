import fs from "fs/promises";
import path from "path";
import os from "os";
import { google } from "googleapis";

import { generateScript } from "../src/openai.js";
import { generateVoice } from "../src/voice.js";
import { generateVideo } from "../src/video.js";
import { uploadToYoutube } from "../src/youtube.js";

const log = (message) => console.log(`[auto] ${message}`);

const REQUIRED_ENV = [
  "OPENAI_API_KEY",
  "ELEVENLABS_API_KEY",
  "YOUTUBE_CLIENT_ID",
  "YOUTUBE_CLIENT_SECRET",
  "YOUTUBE_REFRESH_TOKEN",
];

function getEnv(name, fallback = "") {
  const value = process.env[name];
  if (value === undefined || value === null || value === "") return fallback;
  return value;
}

function requireEnv() {
  const missing = REQUIRED_ENV.filter((key) => !process.env[key]);
  if (missing.length) {
    throw new Error(`Missing required secrets: ${missing.join(", ")}`);
  }
}

async function listMediaFiles(dir, exts) {
  try {
    const files = await fs.readdir(dir);
    return files.filter((file) => exts.some((ext) => file.toLowerCase().endsWith(ext)));
  } catch {
    return [];
  }
}

function parseUrlList(raw) {
  return (raw || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseCsv(raw) {
  return (raw || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function buildTitleFromScript(script) {
  if (!script) return "Daily Motivation";
  const firstSentence = script.split(/(?<=[.?!])\s+/)[0] || script;
  let title = firstSentence.replace(/["']/g, "").trim();
  if (!title) return "Daily Motivation";
  if (title.length > 90) {
    title = `${title.slice(0, 87).trim()}...`;
  }
  return title;
}

function isRateLimitError(err) {
  return err?.status === 429 || err?.code === 429 || err?.error?.code === 429;
}

function getErrorMessage(err) {
  return (
    err?.error?.metadata?.raw ||
    err?.error?.message ||
    err?.message ||
    ""
  );
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function downloadFile(url, destDir, fallbackName) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download ${url}: ${response.status}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  const fileName = path.basename(new URL(url).pathname) || fallbackName;
  const destPath = path.join(destDir, fileName);
  await fs.writeFile(destPath, buffer);
  return destPath;
}

async function downloadMediaList(urls, destDir, label) {
  if (!urls.length) return [];
  await fs.mkdir(destDir, { recursive: true });
  const results = [];
  for (let i = 0; i < urls.length; i += 1) {
    const url = urls[i];
    log(`Downloading ${label} ${i + 1}/${urls.length}`);
    const filePath = await downloadFile(url, destDir, `${label}-${i + 1}`);
    results.push(filePath);
  }
  return results;
}

async function retry(fn, attempts = 3, delayMs = 1500) {
  let lastError;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      log(`Retry ${i + 1}/${attempts} failed: ${err.message}`);
      if (i < attempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }
  throw lastError;
}

async function getAccessToken() {
  const clientId = getEnv("YOUTUBE_CLIENT_ID");
  const clientSecret = getEnv("YOUTUBE_CLIENT_SECRET");
  const redirectUri = getEnv("YOUTUBE_REDIRECT_URI", "http://localhost:3000/api/youtube/callback");
  const refreshToken = getEnv("YOUTUBE_REFRESH_TOKEN");

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  oauth2Client.setCredentials({ refresh_token: refreshToken });
  const tokenResponse = await oauth2Client.getAccessToken();
  const accessToken = tokenResponse?.token || tokenResponse;
  if (!accessToken) {
    throw new Error("Failed to refresh YouTube access token.");
  }
  return accessToken;
}

async function cleanupTemp(tempDir) {
  try {
    await fs.rm(tempDir, { recursive: true, force: true });
  } catch (err) {
    console.error("[auto] Cleanup failed:", err.message);
  }
}

async function run() {
  requireEnv();

  const tempDir = path.join(os.tmpdir(), "shorts-factory-daily");
  await fs.mkdir(tempDir, { recursive: true });

  const baseDir = path.join(process.cwd(), "base-videos");
  const musicDir = path.join(process.cwd(), "music");
  const tempBaseDir = path.join(tempDir, "base-videos");
  const tempMusicDir = path.join(tempDir, "music");

  const baseVideoUrls = parseUrlList(getEnv("BASE_VIDEO_URLS"));
  const musicUrls = parseUrlList(getEnv("MUSIC_URLS"));

  const downloadedBase = await downloadMediaList(baseVideoUrls, tempBaseDir, "base-video");
  const downloadedMusic = await downloadMediaList(musicUrls, tempMusicDir, "music");

  const baseVideos = downloadedBase.length
    ? downloadedBase.map((file) => path.basename(file))
    : await listMediaFiles(baseDir, [".mp4", ".mov", ".mkv", ".webm"]);
  if (!baseVideos.length) {
    throw new Error("No base videos found. Add files to /base-videos in the repo.");
  }

  const musicTracks = downloadedMusic.length
    ? downloadedMusic.map((file) => path.basename(file))
    : await listMediaFiles(musicDir, [".mp3", ".wav", ".m4a"]);
  const baseVideo = baseVideos[Math.floor(Math.random() * baseVideos.length)];
  const musicFile = musicTracks.length ? musicTracks[Math.floor(Math.random() * musicTracks.length)] : "";

  const prompt = getEnv(
    "PROMPT",
    "Write a 30 second motivational speech for YouTube Shorts. Hook the viewer in the first sentence. Use simple powerful language."
  );

  let openaiModel = getEnv("OPENAI_MODEL", "").trim();
  let openaiBaseUrl = getEnv("OPENAI_BASE_URL", "").trim();
  let openaiFallbackModel = getEnv("OPENAI_MODEL_FALLBACK", "").trim();
  let modelList = parseCsv(getEnv("OPENAI_MODEL_LIST", ""));
  const retryDelays = parseCsv(getEnv("OPENAI_RETRY_DELAYS", "30,60,90"))
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0);
  if (!openaiBaseUrl) {
    openaiBaseUrl = "https://openrouter.ai/api/v1";
  }
  if (!openaiFallbackModel && openaiBaseUrl.includes("openrouter.ai")) {
    openaiFallbackModel = "meta-llama/llama-3.2-3b-instruct:free";
  }
  if (!modelList.length && openaiBaseUrl.includes("openrouter.ai")) {
    modelList = [
      "meta-llama/llama-3.2-3b-instruct:free",
      "stepfun/step-3.5-flash:free",
      "openrouter/free",
      "google/gemini-3.1-flash-lite-preview",
    ];
  }
  if (!openaiModel && openaiFallbackModel) {
    openaiModel = openaiFallbackModel;
  }
  if (!openaiModel) {
    openaiModel = "gpt-4o-mini";
  }
  const voice = getEnv("ELEVENLABS_VOICE", "alloy").trim();
  const maxDuration = Number(getEnv("MAX_DURATION", "0")) || 0;

  let title = getEnv("VIDEO_TITLE", "").trim();
  const description = getEnv(
    "VIDEO_DESCRIPTION",
    "Daily motivational shorts.\n\nSubscribe for more success mindset content.\n\n#motivation #success #discipline"
  );
  const tags = getEnv("VIDEO_TAGS", "motivation,success,discipline,shorts")
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);

  let voiceFile = "";
  let videoPath = "";

  try {
    log("Generating script");
    const modelsToTry = Array.from(
      new Set([openaiModel, ...modelList, openaiFallbackModel].filter(Boolean))
    );
    let script = "";
    let lastError = null;
    const maxAttemptsPerModel = Number(getEnv("OPENAI_MODEL_ATTEMPTS", "2")) || 2;

    for (const model of modelsToTry) {
      for (let attempt = 1; attempt <= maxAttemptsPerModel; attempt += 1) {
        try {
          log(`Script attempt ${attempt} using model: ${model}`);
          script = await generateScript({
            prompt,
            apiKey: getEnv("OPENAI_API_KEY").trim(),
            baseUrl: openaiBaseUrl,
            model,
          });
          if (script) break;
        } catch (err) {
          lastError = err;
          const message = getErrorMessage(err);
          log(`Script attempt failed: ${message}`);
          if (isRateLimitError(err)) {
            const delaySeconds = retryDelays[Math.min(attempt - 1, retryDelays.length - 1)] || 30;
            const jitterMs = Math.floor(Math.random() * 5000);
            log(`Rate limit hit. Waiting ${delaySeconds}s before retry...`);
            await sleep(delaySeconds * 1000 + jitterMs);
            if (modelsToTry.length > 1 && message.toLowerCase().includes("rate-limited")) {
              log("Rate limit persists. Rotating to next model.");
              break;
            }
          }
        }
      }
      if (script) break;
    }

    if (!script && lastError) {
      throw lastError;
    }

    if (!title) {
      title = buildTitleFromScript(script);
    }
    log(`Using title: ${title}`);
    log(`Using tags: ${tags.join(", ") || "none"}`);

    log("Generating voice");
    const voiceResult = await generateVoice({
      text: script,
      voice,
      elevenLabsApiKey: getEnv("ELEVENLABS_API_KEY").replace(/\s+/g, ""),
      outDir: tempDir,
    });
    voiceFile = voiceResult.file;

    log("Creating video");
    const basePath = downloadedBase.length ? path.join(tempBaseDir, baseVideo) : path.join(baseDir, baseVideo);
    const musicPath = musicFile
      ? downloadedMusic.length
        ? path.join(tempMusicDir, musicFile)
        : path.join(musicDir, musicFile)
      : null;

    videoPath = await generateVideo({
      baseVideoPath: basePath,
      voicePath: path.join(tempDir, voiceFile),
      script,
      outDir: tempDir,
      title,
      musicPath,
      maxDuration,
    });
  } catch (err) {
    log(`Video generation failed: ${err.message}`);
    throw err;
  }

  log("Uploading to YouTube");
  const accessToken = await getAccessToken();
  const uploadResult = await retry(() =>
    uploadToYoutube({
      accessToken,
      refreshToken: getEnv("YOUTUBE_REFRESH_TOKEN"),
      videoPath,
      title,
      description,
      tags,
    })
  );

  log(`Upload complete: ${uploadResult?.id || "unknown id"}`);

  await cleanupTemp(tempDir);
}

run().catch(async (err) => {
  console.error("[auto] Fatal error:", err);
  await cleanupTemp(path.join(os.tmpdir(), "shorts-factory-daily"));
  process.exit(1);
});
