import fs from "fs/promises";
import path from "path";
import os from "os";
import { google } from "googleapis";

import { generateMetadata, generateScript } from "../src/openai.js";
import { generateVoice } from "../src/voice.js";
import { generateStockBaseVideo, generateVideo, getMediaDuration } from "../src/video.js";
import { uploadToYoutube } from "../src/youtube.js";
import { extractKeywords, fetchStockScenes, splitScriptIntoParts, loadCachedMedia } from "../src/stock.js";

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

function shouldSkipRun() {
  const chance = Number(getEnv("UPLOAD_CHANCE", "1"));
  if (!Number.isFinite(chance)) return false;
  if (chance >= 1) return false;
  if (chance <= 0) return true;
  const roll = Math.random();
  return roll > chance;
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

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

function pickRandom(list, fallback = "") {
  if (!Array.isArray(list) || list.length === 0) return fallback;
  return list[Math.floor(Math.random() * list.length)];
}

function needsCta(text) {
  return !/(subscribe|follow|share|save|comment|like)/i.test(text || "");
}

function pickDailyTopic(topics) {
  if (!topics.length) return "";
  const today = new Date();
  const seed = Number(
    `${today.getUTCFullYear()}${String(today.getUTCMonth() + 1).padStart(2, "0")}${String(
      today.getUTCDate()
    ).padStart(2, "0")}`
  );
  return topics[seed % topics.length];
}

function withHashtags(description, hashtags) {
  if (!description) return hashtags.join(" ");
  const missing = hashtags.filter((tag) => !description.includes(tag));
  if (!missing.length) return description;
  return `${description.trim()}\n\n${missing.join(" ")}`;
}

function scoreTitle(title) {
  const len = title.length;
  let score = 0;
  if (len >= 30 && len <= 70) score += 2;
  if (/\d/.test(title)) score += 1;
  if (/(how|why|stop|start|secret|simple|power|discipline|success|win|focus)/i.test(title)) {
    score += 1;
  }
  if (/[!?]/.test(title)) score += 1;
  return score;
}

function pickBestTitle(titles) {
  if (!Array.isArray(titles) || titles.length === 0) return "";
  return titles
    .map((t) => String(t || "").trim())
    .filter(Boolean)
    .sort((a, b) => scoreTitle(b) - scoreTitle(a))[0];
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

  if (shouldSkipRun()) {
    log("Skipping upload this run based on UPLOAD_CHANCE.");
    return;
  }

  const tempDir = path.join(os.tmpdir(), "shorts-factory-daily");
  await fs.mkdir(tempDir, { recursive: true });

  const baseDir = path.join(process.cwd(), "base-videos");
  const userImagesDir = path.join(process.cwd(), "user-images");
  const musicDir = path.join(process.cwd(), "music");
  const tempBaseDir = path.join(tempDir, "base-videos");
  const tempMusicDir = path.join(tempDir, "music");
  const tempStockDir = path.join(tempDir, "stock");

  const baseVideoUrls = parseUrlList(getEnv("BASE_VIDEO_URLS"));
  const musicUrls = parseUrlList(getEnv("MUSIC_URLS"));

  const downloadedBase = await downloadMediaList(baseVideoUrls, tempBaseDir, "base-video");
  const downloadedMusic = await downloadMediaList(musicUrls, tempMusicDir, "music");

  const musicTracks = downloadedMusic.length
    ? downloadedMusic.map((file) => path.basename(file))
    : await listMediaFiles(musicDir, [".mp3", ".wav", ".m4a"]);
  const musicFile = musicTracks.length ? musicTracks[Math.floor(Math.random() * musicTracks.length)] : "";

  const maxDurationEnv = Number(getEnv("MAX_DURATION", ""));
  const maxDuration = Number.isFinite(maxDurationEnv) && maxDurationEnv > 0 ? maxDurationEnv : 0;
  const targetSeconds =
    Number(getEnv("SCRIPT_DURATION_SECONDS", maxDuration ? String(maxDuration) : "30")) || 30;
  const prompt = getEnv(
    "PROMPT",
    `Write a ${targetSeconds} second motivational speech for YouTube Shorts. Hook the viewer in the first sentence. Use simple powerful language.`
  );
  const language = getEnv("SCRIPT_LANGUAGE", "English").trim();
  const topics = parseCsv(getEnv("TOPIC_LIST", ""));
  const dailyTopic = pickDailyTopic(topics);
  const topicLine = dailyTopic ? `Topic: ${dailyTopic}` : "";

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
  const maxDurationFinal = maxDuration || 0;
  const subtitleMode = getEnv("SUBTITLE_MODE", "word").trim().toLowerCase();
  const highlightEnabled = getEnv("SUBTITLE_HIGHLIGHT", "true").toLowerCase() !== "false";
  const enableStockVideo = getEnv("ENABLE_STOCK_VIDEO", "true").toLowerCase() !== "false";
  const enableImageMode = getEnv("ENABLE_IMAGE_MODE", "true").toLowerCase() !== "false";
  const pexelsApiKey = getEnv("PEXELS_API_KEY", "").trim();
  const pixabayApiKey = getEnv("PIXABAY_API_KEY", "").trim();
  const enforceMix = getEnv("MIX_USER_MEDIA", "true").toLowerCase() !== "false";

  const titleOverride = getEnv("VIDEO_TITLE", "").trim();
  const descriptionOverride = getEnv("VIDEO_DESCRIPTION", "").trim();
  const tagsOverride = parseCsv(getEnv("VIDEO_TAGS", ""));
  const defaultDescription =
    "Daily motivational shorts.\n\nSubscribe for more success mindset content.\n\n#motivation #success #discipline";
  const defaultTags = ["motivation", "success", "discipline", "shorts"];
  let title = titleOverride;
  let description = descriptionOverride;
  let tags = tagsOverride;
  const channelContext = getEnv("CHANNEL_CONTEXT", "").trim();
  const useAiMetadata = getEnv("AUTO_METADATA", "true").toLowerCase() !== "false";
  const titleVariants = Number(getEnv("TITLE_VARIANTS", "3")) || 3;
  const extraHashtags = parseCsv(getEnv("HASHTAGS", "#shorts,#motivation,#success"));

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
    let usedModel = openaiModel;

    for (const model of modelsToTry) {
      for (let attempt = 1; attempt <= maxAttemptsPerModel; attempt += 1) {
        try {
          log(`Script attempt ${attempt} using model: ${model}`);
          const finalPrompt = [
            `${prompt}\n\nLanguage: ${language}.`,
            "Include a clear call-to-action in the last sentence.",
            topicLine,
          ]
            .filter(Boolean)
            .join("\n");

          script = await generateScript({
            prompt: finalPrompt,
            apiKey: getEnv("OPENAI_API_KEY").trim(),
            baseUrl: openaiBaseUrl,
            model,
          });
          if (script) {
            usedModel = model;
            break;
          }
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

    const ctaList = parseCsv(
      getEnv(
        "CTA_LIST",
        "Save this. Share it.,Follow for more daily motivation.,Subscribe for more success mindset tips."
      )
    );
    const appendCta = getEnv("APPEND_CTA", "true").toLowerCase() !== "false";
    if (appendCta && needsCta(script)) {
      const cta = pickRandom(ctaList, "Save this and share it.");
      script = `${script.trim()} ${cta}`.replace(/\s+/g, " ").trim();
    }

    if (useAiMetadata) {
      try {
        log("Generating metadata");
        const metadata = await generateMetadata({
          script,
          channelContext,
          apiKey: getEnv("OPENAI_API_KEY").trim(),
          baseUrl: openaiBaseUrl,
          model: usedModel,
          variants: titleVariants,
        });
        if (!titleOverride) {
          title = metadata.title || pickBestTitle(metadata.titles || []);
        }
        if (!descriptionOverride && metadata.description) description = metadata.description;
        if (!tagsOverride.length && metadata.tags?.length) tags = metadata.tags;
      } catch (err) {
        log(`Metadata generation failed: ${err.message}`);
      }
    }

    if (!title) {
      title = buildTitleFromScript(script);
    }
    if (!description) {
      description = defaultDescription;
    }
    if (!tags.length) {
      tags = defaultTags;
    }
    if (extraHashtags.length) {
      description = withHashtags(description, extraHashtags);
    }
    if (!tags.includes("shorts")) {
      tags = [...tags, "shorts"];
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

    const voicePath = path.join(tempDir, voiceFile);
    const audioDuration = await getMediaDuration(voicePath);
    let basePath = "";

    const userVideos = downloadedBase.length
      ? downloadedBase.map((file) => path.basename(file))
      : await listMediaFiles(baseDir, [".mp4", ".mov", ".mkv", ".webm"]);
    const userImages = await listMediaFiles(userImagesDir, [".jpg", ".jpeg", ".png", ".webp"]);

    if (enableStockVideo) {
      if (!pexelsApiKey && !pixabayApiKey) {
        throw new Error("ENABLE_STOCK_VIDEO is true but no stock API key is set (PEXELS_API_KEY or PIXABAY_API_KEY).");
      }
      let parts = splitScriptIntoParts(script);
      const surpriseEnabled = getEnv("SURPRISE_BROLL", "true").toLowerCase() !== "false";
      if (surpriseEnabled) {
        const surpriseTopics = parseCsv(
          getEnv(
            "SURPRISE_TOPICS",
            "city night, ocean waves, sunrise, mountain peak, neon skyline, athlete training"
          )
        );
        if (surpriseTopics.length && parts.length < 5) {
          parts = [...parts, { text: pickRandom(surpriseTopics) }];
        }
      }
      log(`Fetching stock visuals for ${parts.length} scenes`);
      const scenes = await fetchStockScenes({
        parts,
        pexelsApiKey,
        pixabayApiKey,
        enableImages: enableImageMode,
        tempDir: tempStockDir,
      });

      const cached = await loadCachedMedia();
      const usableScenes = scenes.filter((scene) => scene.type !== "empty");
      const stockAvailable = usableScenes.length > 0 || cached.videos.length || cached.images.length;
      const userAvailable = userVideos.length || userImages.length;

      const pickUserScene = (text) => {
        if (userVideos.length) {
          const file = userVideos[Math.floor(Math.random() * userVideos.length)];
          const filePath = downloadedBase.length ? path.join(tempBaseDir, file) : path.join(baseDir, file);
          return { type: "video", path: filePath, text, source: "user" };
        }
        if (userImages.length) {
          const shuffled = [...userImages].sort(() => Math.random() - 0.5);
          const count = Math.min(5, Math.max(3, shuffled.length));
          const paths = shuffled.slice(0, count).map((file) => path.join(userImagesDir, file));
          return { type: "images", paths, text, source: "user" };
        }
        return null;
      };

      const pickStockScene = (index, text) => {
        if (usableScenes[index]) {
          return { ...usableScenes[index], text };
        }
        if (usableScenes.length) {
          const scene = usableScenes[Math.floor(Math.random() * usableScenes.length)];
          return { ...scene, text };
        }
        if (cached.videos.length) {
          const file = cached.videos[Math.floor(Math.random() * cached.videos.length)];
          return { type: "video", path: file, text, source: "cache" };
        }
        if (cached.images.length) {
          const shuffled = [...cached.images].sort(() => Math.random() - 0.5);
          const count = Math.min(5, Math.max(3, shuffled.length));
          return { type: "images", paths: shuffled.slice(0, count), text, source: "cache" };
        }
        return null;
      };

      const mixedScenes = parts.map((part, index) => {
        const preferUser = enforceMix && userAvailable && stockAvailable ? index % 2 === 1 : userAvailable && !stockAvailable;
        const scene = preferUser ? pickUserScene(part.text) || pickStockScene(index, part.text) : pickStockScene(index, part.text) || pickUserScene(part.text);
        return scene || { type: "empty", text: part.text };
      });

      // Ensure at least one user and one stock scene when both are available.
      if (enforceMix && userAvailable && stockAvailable) {
        const usedUser = mixedScenes.some((scene) => scene?.source === "user");
        const usedStock = mixedScenes.some((scene) => scene?.source === "stock" || scene?.source === "cache");
        if (!usedUser) {
          const idx = Math.floor(Math.random() * mixedScenes.length);
          const replacement = pickUserScene(mixedScenes[idx]?.text || script);
          if (replacement) mixedScenes[idx] = replacement;
        }
        if (!usedStock) {
          const idx = Math.floor(Math.random() * mixedScenes.length);
          const replacement = pickStockScene(idx, mixedScenes[idx]?.text || script);
          if (replacement) mixedScenes[idx] = replacement;
        }
      }

      const usableMixed = mixedScenes.filter((scene) => scene?.type !== "empty");
      if (usableMixed.length) {
        basePath = await generateStockBaseVideo({
          scenes: usableMixed,
          outDir: tempDir,
          totalDuration: audioDuration || 30,
        });
      } else {
        log("No stock visuals found. Falling back to base-videos if available.");
      }
    }

    if (!basePath) {
      if (!userVideos.length) {
        throw new Error("No base videos found. Add files to /base-videos or enable stock visuals.");
      }
      const baseVideo = userVideos[Math.floor(Math.random() * userVideos.length)];
      basePath = downloadedBase.length ? path.join(tempBaseDir, baseVideo) : path.join(baseDir, baseVideo);
    }

    log("Creating video");
    const musicPath = musicFile
      ? downloadedMusic.length
        ? path.join(tempMusicDir, musicFile)
        : path.join(musicDir, musicFile)
      : null;
    const highlightWords = highlightEnabled ? extractKeywords(script, 6) : [];
    const popupEnabled = getEnv("KEYWORD_POPUPS", "true").toLowerCase() !== "false";
    const keywordPopups = popupEnabled ? extractKeywords(script, 8).slice(0, 3) : [];
    const hookMaxWords = Number(getEnv("HOOK_MAX_WORDS", "10")) || 10;
    const hookUpper = getEnv("HOOK_UPPERCASE", "true").toLowerCase() !== "false";
    const subtitleStyle = {
      fontSize: Math.round(randomBetween(58, 72)),
      outline: Math.round(randomBetween(3, 6)),
      yOffset: Math.round(randomBetween(180, 320)),
      fontColor: "white",
      highlightColor: pickRandom(["yellow", "cyan", "lime"], "yellow"),
    };
    const hookTextRaw = (script.split(/(?<=[.?!])\s+/)[0] || script)
      .split(" ")
      .slice(0, hookMaxWords)
      .join(" ")
      .trim();
    const hookText = hookUpper ? hookTextRaw.toUpperCase() : hookTextRaw;
    const hookBoost = getEnv("HOOK_BOOST", "true").toLowerCase() !== "false";
    subtitleStyle.hookSize = hookBoost ? Math.round(subtitleStyle.fontSize * 1.55) : Math.round(subtitleStyle.fontSize * 1.25);
    subtitleStyle.hookOutline = hookBoost ? Math.round(subtitleStyle.outline * 2.2) : Math.round(subtitleStyle.outline * 1.6);
    subtitleStyle.hookY = Math.round(randomBetween(110, 180));

    const musicVolume = Number(getEnv("MUSIC_VOLUME", "0.18"));
    const watermarkText = getEnv("WATERMARK_TEXT", "").trim();

    videoPath = await generateVideo({
      baseVideoPath: basePath,
      voicePath,
      script,
      outDir: tempDir,
      title,
      musicPath,
      maxDuration: maxDurationFinal,
      musicVolume: Number.isFinite(musicVolume) ? musicVolume : 0.18,
      subtitleMode,
      highlightWords,
      subtitleStyle,
      hookText,
      keywordPopups,
      watermarkText,
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
