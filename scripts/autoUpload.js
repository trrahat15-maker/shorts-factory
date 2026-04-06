import fs from "fs/promises";
import path from "path";
import os from "os";
import { google } from "googleapis";

import { generateHooks, generateMetadata, generateScript } from "../src/openai.js";
import { generateVoice } from "../src/voice.js";
import {
  generateProceduralBaseVideo,
  generateStockBaseVideo,
  generateThumbnail,
  generateVideo,
  getMediaDuration,
} from "../src/video.js";
import { postTopLevelComment, replyToTopComment, uploadThumbnail, uploadToYoutube } from "../src/youtube.js";
import { extractKeywords, fetchStockScenes, splitScriptIntoParts, loadCachedMedia } from "../src/stock.js";
import { buildRankedTopics, fetchGoogleTrends, fetchTrendingShorts, fetchYoutubeTrends } from "../src/trends.js";
import { fetchCompetitorInsights } from "../src/competitors.js";

const logLines = [];
const log = (message) => {
  const line = `[auto] ${message}`;
  console.log(line);
  logLines.push(line);
};

const REQUIRED_ENV = [
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
  const backupOnly = (process.env.BACKUP_ONLY || "false").toLowerCase() === "true";
  if (!backupOnly && !process.env.OPENAI_API_KEY) {
    missing.push("OPENAI_API_KEY");
  }
  const hasEleven =
    Boolean((process.env.ELEVENLABS_API_KEY || "").trim()) ||
    Boolean((process.env.ELEVENLABS_API_KEYS || "").trim());
  const freeTtsEnabled = (process.env.FREE_TTS || "true").toLowerCase() !== "false";
  if (!hasEleven && !freeTtsEnabled) {
    missing.push("ELEVENLABS_API_KEY (or ELEVENLABS_API_KEYS or FREE_TTS=true)");
  }
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

async function pickNewestFile(dir, files) {
  if (!files.length) return "";
  const stats = await Promise.all(
    files.map(async (file) => {
      try {
        const fullPath = path.join(dir, file);
        const stat = await fs.stat(fullPath);
        return { file, time: stat.mtimeMs };
      } catch {
        return { file, time: 0 };
      }
    })
  );
  stats.sort((a, b) => b.time - a.time);
  return stats[0]?.file || files[0];
}

async function sortByNewest(entries) {
  const withStats = await Promise.all(
    entries.map(async (entry) => {
      try {
        const stat = await fs.stat(entry.path);
        return { ...entry, time: stat.mtimeMs || 0 };
      } catch {
        return { ...entry, time: 0 };
      }
    })
  );
  return withStats.sort((a, b) => b.time - a.time);
}

function filenameToText(fileName) {
  if (!fileName) return "";
  const base = path.basename(fileName, path.extname(fileName));
  return base.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}

function sanitizeFileName(input, maxLength = 70) {
  if (!input) return `backup-${Date.now()}`;
  const firstLine = String(input).split("\n")[0] || input;
  const safe = firstLine
    .replace(/[^a-zA-Z0-9-_ ]/g, "")
    .trim()
    .replace(/\s+/g, "-");
  const cropped = safe.length > maxLength ? safe.slice(0, maxLength) : safe;
  return cropped || `backup-${Date.now()}`;
}

function normalizeDropboxPath(input) {
  if (!input) return "";
  let pathValue = input.trim();
  if (!pathValue.startsWith("/")) pathValue = `/${pathValue}`;
  pathValue = pathValue.replace(/\/+/g, "/");
  if (pathValue.length > 1 && pathValue.endsWith("/")) {
    pathValue = pathValue.slice(0, -1);
  }
  return pathValue;
}

async function dropboxFetch(url, token, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body || {}),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Dropbox API error ${res.status}: ${text}`);
  }
  return res.json();
}

async function ensureDropboxFolder({ token, path: folderPath }) {
  if (!token || !folderPath) return null;
  const normalized = normalizeDropboxPath(folderPath);
  try {
    return await dropboxFetch("https://api.dropboxapi.com/2/files/create_folder_v2", token, {
      path: normalized,
      autorename: false,
    });
  } catch (err) {
    if (String(err.message || "").includes("path/conflict/folder")) {
      return null;
    }
    throw err;
  }
}

async function moveDropboxFile({ token, fromPath, toPath }) {
  if (!token || !fromPath || !toPath) return null;
  return dropboxFetch("https://api.dropboxapi.com/2/files/move_v2", token, {
    from_path: fromPath,
    to_path: toPath,
    autorename: true,
  });
}

function getDropboxFolders() {
  const root = normalizeDropboxPath(getEnv("DROPBOX_SYSTEM_ROOT", "").trim());
  const useSystem = getEnv("DROPBOX_USE_SYSTEM_FOLDERS", "false").toLowerCase() === "true" || Boolean(root);
  if (useSystem) {
    const base = root || "/youtube_ai_system";
    return {
      backup: `${base}/backup_videos`,
      generated: `${base}/generated_videos`,
      used: `${base}/used_videos`,
      logs: `${base}/logs`,
    };
  }
  return {
    backup: normalizeDropboxPath(getEnv("DROPBOX_FOLDER_PATH", "").trim()),
    generated: "",
    used: normalizeDropboxPath(getEnv("DROPBOX_USED_FOLDER_PATH", "").trim()),
    logs: "",
  };
}

async function listDropboxVideos({ token, folderPath }) {
  if (!token || !folderPath) return [];
  const files = [];
  let hasMore = true;
  let cursor = null;
  while (hasMore) {
    const endpoint = cursor
      ? "https://api.dropboxapi.com/2/files/list_folder/continue"
      : "https://api.dropboxapi.com/2/files/list_folder";
    const payload = cursor ? { cursor } : { path: folderPath };
    const data = await dropboxFetch(endpoint, token, payload);
    const entries = data?.entries || [];
    entries.forEach((entry) => {
      if (entry?.[".tag"] !== "file") return;
      const name = entry?.name || "";
      const lower = name.toLowerCase();
      if (![".mp4", ".mov", ".mkv", ".webm"].some((ext) => lower.endsWith(ext))) return;
      files.push({
        name,
        pathLower: entry.path_lower || "",
        pathDisplay: entry.path_display || "",
        time: new Date(entry.server_modified || 0).getTime(),
      });
    });
    hasMore = Boolean(data?.has_more);
    cursor = data?.cursor;
  }
  return files.sort((a, b) => b.time - a.time);
}

async function getDropboxTempLink({ token, filePath }) {
  const data = await dropboxFetch("https://api.dropboxapi.com/2/files/get_temporary_link", token, {
    path: filePath,
  });
  return data?.link || "";
}

async function downloadDropboxFile({ token, filePath, destDir, fallbackName }) {
  await fs.mkdir(destDir, { recursive: true });
  const link = await getDropboxTempLink({ token, filePath });
  if (!link) throw new Error("Dropbox temporary link is empty.");
  const response = await fetch(link);
  if (!response.ok) {
    throw new Error(`Failed to download Dropbox file: ${response.status}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  const fileName = fallbackName || path.basename(filePath);
  const destPath = path.join(destDir, fileName);
  await fs.writeFile(destPath, buffer);
  return destPath;
}

async function uploadFileToDropbox({ token, folderPath, filePath, nameBase, extension }) {
  if (!token || !folderPath || !filePath) return null;
  const ext = extension || path.extname(filePath) || ".mp4";
  const fileName = `${sanitizeFileName(nameBase)}-${Date.now()}${ext}`;
  const dropboxPath = `${folderPath}/${fileName}`.replace(/\/+/g, "/");
  return uploadFileToDropboxPath({ token, dropboxPath, filePath });
}

async function uploadFileToDropboxPath({ token, dropboxPath, filePath }) {
  if (!token || !dropboxPath || !filePath) return null;
  const contents = await fs.readFile(filePath);
  const res = await fetch("https://content.dropboxapi.com/2/files/upload", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/octet-stream",
      "Dropbox-API-Arg": JSON.stringify({
        path: dropboxPath,
        mode: "add",
        autorename: true,
        mute: true,
      }),
    },
    body: contents,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Dropbox upload failed ${res.status}: ${text}`);
  }
  return dropboxPath;
}

function buildBackupMeta({ title, description, tags, hook, topic }) {
  return {
    title: title || "",
    description: description || "",
    tags: Array.isArray(tags) ? tags : [],
    hook: hook || "",
    topic: topic || "",
    createdAt: new Date().toISOString(),
  };
}

async function uploadBackupToDropbox({
  token,
  folderPath,
  videoPath,
  meta,
  nameBase,
}) {
  if (!token || !folderPath || !videoPath) return null;
  const ext = path.extname(videoPath) || ".mp4";
  const stamp = Date.now();
  const base = sanitizeFileName(nameBase || meta?.title || "backup");
  const videoName = `${base}-${stamp}${ext}`;
  const metaName = `${base}-${stamp}.json`;
  const videoDropboxPath = `${folderPath}/${videoName}`.replace(/\/+/g, "/");
  const metaDropboxPath = `${folderPath}/${metaName}`.replace(/\/+/g, "/");

  await uploadFileToDropboxPath({ token, dropboxPath: videoDropboxPath, filePath: videoPath });

  const tempMetaPath = path.join(os.tmpdir(), metaName);
  await fs.writeFile(tempMetaPath, JSON.stringify(meta || {}, null, 2), "utf8");
  await uploadFileToDropboxPath({ token, dropboxPath: metaDropboxPath, filePath: tempMetaPath });
  try {
    await fs.rm(tempMetaPath, { force: true });
  } catch {
    // ignore
  }
  return { videoDropboxPath, metaDropboxPath };
}

async function downloadDropboxMetadata({ token, metaPath }) {
  if (!token || !metaPath) return null;
  const link = await getDropboxTempLink({ token, filePath: metaPath });
  if (!link) return null;
  const response = await fetch(link);
  if (!response.ok) return null;
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function saveLogFile({ logsDir, dropboxToken, dropboxFolder, label }) {
  if (!logLines.length) return null;
  await fs.mkdir(logsDir, { recursive: true });
  const stamp = label || new Date().toISOString().replace(/[:.]/g, "-");
  const logPath = path.join(logsDir, `auto-${stamp}.log`);
  await fs.writeFile(logPath, logLines.join("\n"), "utf8");
  if (dropboxToken && dropboxFolder) {
    try {
      await uploadFileToDropbox({
        token: dropboxToken,
        folderPath: dropboxFolder,
        filePath: logPath,
        nameBase: `auto-${stamp}`,
        extension: ".log",
      });
    } catch (err) {
      log(`Dropbox log upload failed: ${err.message}`);
    }
  }
  return logPath;
}

async function saveGeneratedCopy({ videoPath, title, dropboxToken, dropboxFolder }) {
  if (!videoPath) return null;
  const generatedDir = path.join(process.cwd(), "generated_videos");
  await fs.mkdir(generatedDir, { recursive: true });
  const localPath = path.join(generatedDir, path.basename(videoPath));
  try {
    await fs.copyFile(videoPath, localPath);
  } catch (err) {
    log(`Generated copy failed: ${err.message}`);
  }
  if (dropboxToken && dropboxFolder) {
    try {
      await uploadFileToDropbox({
        token: dropboxToken,
        folderPath: dropboxFolder,
        filePath: videoPath,
        nameBase: title || "generated",
        extension: ".mp4",
      });
    } catch (err) {
      log(`Dropbox generated upload failed: ${err.message}`);
    }
  }
  return localPath;
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

function scoreHook(text) {
  const lower = String(text || "").toLowerCase();
  let score = 0;
  if (/\d/.test(lower)) score += 2;
  if (/[!?]/.test(lower)) score += 1;
  if (/(secret|wrong|nobody|stop|start|why|how)/.test(lower)) score += 2;
  if (/(money|success|fail|fear|discipline|focus)/.test(lower)) score += 2;
  if (/(you|your)/.test(lower)) score += 1;
  if (/(this|these)/.test(lower)) score += 1;
  const words = lower.split(/\s+/).filter(Boolean).length;
  if (words >= 4 && words <= 10) score += 2;
  return score;
}

function pickTopHooks(hooks, count = 2) {
  const scored = hooks
    .map((hook) => ({ hook, score: scoreHook(hook) }))
    .sort((a, b) => b.score - a.score);
  return scored.map((item) => item.hook).slice(0, count);
}

function replaceFirstSentence(script, hook) {
  if (!hook) return script;
  const sentences = script
    .split(/(?<=[.?!])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (!sentences.length) return hook;
  sentences[0] = hook.endsWith(".") || hook.endsWith("!") || hook.endsWith("?") ? hook : `${hook}.`;
  return sentences.join(" ");
}

function trimFirstSentence(script, maxWords = 14) {
  const sentences = script
    .split(/(?<=[.?!])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (!sentences.length) return script;
  const words = sentences[0].split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return script;
  sentences[0] = `${words.slice(0, maxWords).join(" ")}.`;
  return sentences.join(" ");
}

function stripWeakIntro(script) {
  const patterns = [
    /^today[,:\s]+/i,
    /^in this video[,:\s]+/i,
    /^i want to[,:\s]+/i,
    /^let me[,:\s]+/i,
    /^here's the thing[,:\s]+/i,
  ];
  const sentences = script
    .split(/(?<=[.?!])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (!sentences.length) return script;
  let first = sentences[0];
  patterns.forEach((pattern) => {
    first = first.replace(pattern, "");
  });
  sentences[0] = first.trim() || sentences[0];
  return sentences.join(" ");
}

function needsCta(text) {
  return !/(subscribe|follow|share|save|comment|like)/i.test(text || "");
}

function estimateWordsPerSecond() {
  const wps = Number(getEnv("WORDS_PER_SECOND", "2.6"));
  return Number.isFinite(wps) && wps > 0 ? wps : 2.6;
}

function trimScriptToDuration(script, maxSeconds) {
  if (!maxSeconds || !script) return script;
  const wps = estimateWordsPerSecond();
  const maxWords = Math.max(1, Math.floor(maxSeconds * wps));
  const words = script.split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return script;

  const sentences = script.split(/(?<=[.?!])\s+/).map((s) => s.trim()).filter(Boolean);
  if (sentences.length > 1) {
    let trimmed = "";
    for (let i = 0; i < sentences.length; i += 1) {
      const candidate = trimmed ? `${trimmed} ${sentences[i]}` : sentences[i];
      if (candidate.split(/\s+/).filter(Boolean).length > maxWords) break;
      trimmed = candidate;
    }
    if (trimmed) return trimmed;
  }

  return words.slice(0, maxWords).join(" ");
}

function ensureMinScriptLength(script, minSeconds) {
  if (!minSeconds) return script;
  const wps = estimateWordsPerSecond();
  const minWords = Math.ceil(minSeconds * wps);
  const words = script.split(/\s+/).filter(Boolean);
  if (words.length >= minWords) return script;
  const fillers = [
    "Keep showing up, even when it feels slow.",
    "Small wins stack into massive results.",
    "Your future self is built by today’s choices.",
    "Discipline beats motivation on the hard days.",
    "One more rep. One more page. One more try.",
    "Stay focused. Stay consistent. Stay unstoppable.",
    "Progress is quiet, but it’s always moving.",
  ];
  const extra = [];
  let idx = 0;
  while (words.length + extra.join(" ").split(/\s+/).filter(Boolean).length < minWords) {
    extra.push(fillers[idx % fillers.length]);
    idx += 1;
  }
  return `${script.trim()} ${extra.join(" ")}`.replace(/\s+/g, " ").trim();
}

async function loadLearningData(filePath) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return { topics: {}, hooks: {} };
  }
}

async function saveLearningData(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(data, null, 2));
}

function updateLearning(data, { topic, hook, stats }) {
  if (!data.topics) data.topics = {};
  if (!data.hooks) data.hooks = {};
  const score = (stats?.views || 0) + (stats?.likes || 0) * 2 + (stats?.comments || 0) * 3;
  if (topic) {
    data.topics[topic] = (data.topics[topic] || 0) + score;
  }
  if (hook) {
    data.hooks[hook] = (data.hooks[hook] || 0) + score;
  }
}

function enforceLoopEnding(script) {
  if (!script) return script;
  const sentences = script
    .split(/(?<=[.?!])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (sentences.length < 2) return script;
  const first = sentences[0].replace(/[.!?]+$/g, "").trim();
  const firstWords = first.split(/\s+/).slice(0, 6).join(" ");
  const lastIdx = sentences.length - 1;
  const last = sentences[lastIdx].replace(/[.!?]+$/g, "").trim();
  const lowerLast = last.toLowerCase();
  if (firstWords && lowerLast.includes(firstWords.toLowerCase())) {
    return sentences.join(" ");
  }
  const loopLine = firstWords
    ? `And that's exactly how ${firstWords.toLowerCase()}.`
    : "And that's exactly why it keeps happening.";
  sentences[lastIdx] = `${last}. ${loopLine}`;
  return sentences.join(" ");
}

function polishTitle(input) {
  if (!input) return input;
  let title = String(input).trim();
  title = title.replace(/[.]+$/, "").trim();
  if (title.length > 1) {
    title = title[0].toUpperCase() + title.slice(1);
  }
  const prefixes = parseCsv(getEnv("TITLE_PREFIXES", "Stop,Start,How to,Why,The Secret,One Rule"));
  if (title.length < 24 && prefixes.length) {
    const prefix = pickRandom(prefixes);
    if (!title.toLowerCase().startsWith(prefix.toLowerCase())) {
      title = `${prefix} ${title}`;
    }
  }
  if (title.length > 90) {
    title = `${title.slice(0, 87).trim()}...`;
  }
  return title;
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

function buildTitleHashtags(title, maxCount = 5) {
  const stop = new Set([
    "the",
    "a",
    "an",
    "and",
    "or",
    "but",
    "to",
    "of",
    "in",
    "on",
    "for",
    "with",
    "from",
    "your",
    "you",
    "we",
    "our",
    "is",
    "are",
    "this",
    "that",
    "it",
    "be",
    "as",
    "at",
    "by",
    "not",
    "no",
    "now",
    "then",
    "so",
  ]);
  const words = String(title || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length > 2 && !stop.has(w));
  const unique = Array.from(new Set(words));
  return unique.slice(0, maxCount).map((w) => `#${w}`);
}

async function deleteDropboxFile({ token, filePath }) {
  if (!token || !filePath) return null;
  return dropboxFetch("https://api.dropboxapi.com/2/files/delete_v2", token, {
    path: filePath,
  });
}

async function uploadManualBaseVideo({
  baseDir,
  tempDir,
  accessToken,
  titleOverride,
  descriptionOverride,
  tagsOverride,
  extraHashtags,
  defaultDescription,
  defaultTags,
}) {
  const userVideos = await listMediaFiles(baseDir, [".mp4", ".mov", ".mkv", ".webm"]);
  if (!userVideos.length) return null;

  const newest = await pickNewestFile(baseDir, userVideos);
  const basePath = path.join(baseDir, newest);
  const fileLabel = filenameToText(newest) || "Manual Upload";

  const useTitleFromName = getEnv("MANUAL_TITLE_FROM_FILENAME", "true").toLowerCase() !== "false";
  const useDescFromName = getEnv("MANUAL_DESCRIPTION_FROM_FILENAME", "true").toLowerCase() !== "false";
  const deleteAfterUpload = getEnv("DELETE_BASE_VIDEO_AFTER_UPLOAD", "true").toLowerCase() !== "false";
  const autoHashtags = getEnv("AUTO_HASHTAGS_FROM_TITLE", "true").toLowerCase() !== "false";
  const titleHashtags = autoHashtags ? buildTitleHashtags(fileLabel) : [];

  let title = titleOverride || (useTitleFromName ? fileLabel : "");
  let description = descriptionOverride || (useDescFromName ? fileLabel : defaultDescription);
  let tags = tagsOverride?.length ? tagsOverride : defaultTags;
  const combinedHashtags = [
    ...(extraHashtags || []),
    ...titleHashtags,
  ];
  if (combinedHashtags.length) {
    description = withHashtags(description, combinedHashtags);
  }
  if (!tags.includes("shorts")) {
    tags = [...tags, "shorts"];
  }

  log(`Manual fallback upload using base video: ${newest}`);
  const result = await uploadToYoutube({
    accessToken,
    refreshToken: getEnv("YOUTUBE_REFRESH_TOKEN"),
    videoPath: basePath,
    title,
    description,
    tags,
  });

  if (deleteAfterUpload) {
    try {
      await fs.rm(basePath, { force: true });
      log(`Deleted uploaded base video: ${newest}`);
    } catch (err) {
      log(`Failed to delete base video ${newest}: ${err.message}`);
    }
  }

  return result;
}

async function uploadManualBaseVideoPath({
  filePath,
  fileName,
  deleteAfter,
  accessToken,
  titleOverride,
  descriptionOverride,
  tagsOverride,
  metaTitle,
  metaDescription,
  metaTags,
  extraHashtags,
  defaultDescription,
  defaultTags,
}) {
  const fileLabel = filenameToText(fileName || path.basename(filePath)) || "Manual Upload";
  const useTitleFromName = getEnv("MANUAL_TITLE_FROM_FILENAME", "true").toLowerCase() !== "false";
  const useDescFromName = getEnv("MANUAL_DESCRIPTION_FROM_FILENAME", "true").toLowerCase() !== "false";
  const autoHashtags = getEnv("AUTO_HASHTAGS_FROM_TITLE", "true").toLowerCase() !== "false";
  const titleHashtags = autoHashtags ? buildTitleHashtags(fileLabel) : [];

  let title = metaTitle || titleOverride || (useTitleFromName ? fileLabel : "");
  let description = metaDescription || descriptionOverride || (useDescFromName ? fileLabel : defaultDescription);
  let tags = metaTags?.length ? metaTags : tagsOverride?.length ? tagsOverride : defaultTags;
  const combinedHashtags = [
    ...(extraHashtags || []),
    ...titleHashtags,
  ];
  if (combinedHashtags.length) {
    description = withHashtags(description, combinedHashtags);
  }
  if (!tags.includes("shorts")) {
    tags = [...tags, "shorts"];
  }

  log(`Manual upload using backup video: ${fileName || path.basename(filePath)}`);
  const result = await uploadToYoutube({
    accessToken,
    refreshToken: getEnv("YOUTUBE_REFRESH_TOKEN"),
    videoPath: filePath,
    title,
    description,
    tags,
  });

  if (deleteAfter) {
    try {
      await fs.rm(filePath, { force: true });
      log(`Deleted backup video after upload: ${fileName || path.basename(filePath)}`);
    } catch (err) {
      log(`Failed to delete backup video: ${err.message}`);
    }
  }
  return result;
}

async function uploadGeneratedFallback({
  tempDir,
  accessToken,
  script,
  voicePath,
  voice,
  titleOverride,
  descriptionOverride,
  tagsOverride,
  extraHashtags,
  defaultDescription,
  defaultTags,
  minDuration,
  maxDuration,
}) {
  const fallbackScript =
    script ||
    "You're closer than you think. Keep moving, keep building, and let today prove what you can become.";
  let finalVoicePath = voicePath;
  if (!finalVoicePath) {
    const voiceResult = await generateVoice({
      text: fallbackScript,
      voice,
      elevenLabsApiKey: getEnv("ELEVENLABS_API_KEY").replace(/\s+/g, ""),
      outDir: tempDir,
    });
    finalVoicePath = path.join(tempDir, voiceResult.file);
  }

  const audioDuration = await getMediaDuration(finalVoicePath);
  const targetDuration = Math.max(
    minDuration || 20,
    Math.min(maxDuration || 40, audioDuration || minDuration || 20)
  );
  const basePath = await generateProceduralBaseVideo({ outDir: tempDir, duration: targetDuration });
  const title = titleOverride || "Daily Motivation";
  let description = descriptionOverride || defaultDescription;
  let tags = tagsOverride?.length ? tagsOverride : defaultTags;
  if (extraHashtags?.length) {
    description = withHashtags(description, extraHashtags);
  }
  if (!tags.includes("shorts")) {
    tags = [...tags, "shorts"];
  }

  const videoPath = await generateVideo({
    baseVideoPath: basePath,
    voicePath: finalVoicePath,
    script: fallbackScript,
    outDir: tempDir,
    title,
    musicPath: null,
    maxDuration,
    minDuration,
    subtitleMode: getEnv("SUBTITLE_MODE", "word").trim().toLowerCase(),
    highlightWords: extractKeywords(fallbackScript, 6),
    subtitleStyle: {
      fontSize: 68,
      outline: 5,
      yOffset: 230,
      fontColor: "white",
      highlightColor: "yellow",
      popEnabled: true,
      popScale: 1.18,
      popDuration: 0.14,
      box: true,
      boxColor: "black@0.5",
      boxBorder: 10,
      glow: true,
    },
    hookText: fallbackScript.split(/\s+/).slice(0, 8).join(" ").toUpperCase(),
    keywordPopups: extractKeywords(fallbackScript, 8).slice(0, 2),
    watermarkText: "",
  });

  const result = await uploadToYoutube({
    accessToken,
    refreshToken: getEnv("YOUTUBE_REFRESH_TOKEN"),
    videoPath,
    title,
    description,
    tags,
  });

  return result;
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
    try {
      const filePath = await downloadFile(url, destDir, `${label}-${i + 1}`);
      results.push(filePath);
    } catch (err) {
      log(`Download failed for ${url}: ${err.message}`);
    }
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

async function fetchVideoStats(accessToken, videoId) {
  if (!accessToken || !videoId) return null;
  try {
    const youtube = google.youtube("v3");
    const res = await youtube.videos.list({
      part: ["statistics"],
      id: [videoId],
      access_token: accessToken,
    });
    const stats = res?.data?.items?.[0]?.statistics || {};
    return {
      views: Number(stats.viewCount || 0),
      likes: Number(stats.likeCount || 0),
      comments: Number(stats.commentCount || 0),
    };
  } catch (err) {
    log(`Stats fetch failed: ${err.message}`);
    return null;
  }
}

function getHourInTimezone(date, timeZone) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    hour12: false,
  });
  return Number(formatter.format(date));
}

function getMinutesInTimezone(date, timeZone) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const hour = Number(parts.find((p) => p.type === "hour")?.value || 0);
  const minute = Number(parts.find((p) => p.type === "minute")?.value || 0);
  return hour * 60 + minute;
}

function isWithinWindow(nowMinutes, startMinutes, endMinutes) {
  const day = 24 * 60;
  const start = ((startMinutes % day) + day) % day;
  const end = ((endMinutes % day) + day) % day;
  if (start <= end) {
    return nowMinutes >= start && nowMinutes <= end;
  }
  return nowMinutes >= start || nowMinutes <= end;
}

async function getBestPublishHour({
  accessToken,
  channelId,
  maxVideos = 30,
  minAgeHours = 6,
  timeZone = "UTC",
}) {
  const youtube = google.youtube("v3");
  const channelParams = {
    part: ["contentDetails"],
    access_token: accessToken,
  };
  if (channelId) {
    channelParams.id = [channelId];
  } else {
    channelParams.mine = true;
  }
  const channelRes = await youtube.channels.list(channelParams);
  const uploadsId = channelRes?.data?.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
  if (!uploadsId) return null;

  const playlistRes = await youtube.playlistItems.list({
    part: ["contentDetails"],
    playlistId: uploadsId,
    maxResults: Math.min(50, maxVideos),
    access_token: accessToken,
  });
  const videoIds = (playlistRes?.data?.items || [])
    .map((item) => item?.contentDetails?.videoId)
    .filter(Boolean);
  if (!videoIds.length) return null;

  const videosRes = await youtube.videos.list({
    part: ["snippet", "statistics"],
    id: videoIds,
    maxResults: videoIds.length,
    access_token: accessToken,
  });

  const now = Date.now();
  const buckets = new Map();
  (videosRes?.data?.items || []).forEach((video) => {
    const publishedAt = video?.snippet?.publishedAt;
    if (!publishedAt) return;
    const ageHours = Math.max(1, (now - new Date(publishedAt).getTime()) / 3600000);
    if (ageHours < minAgeHours) return;
    const views = Number(video?.statistics?.viewCount || 0);
    const likes = Number(video?.statistics?.likeCount || 0);
    const comments = Number(video?.statistics?.commentCount || 0);
    const score = (views + likes * 2 + comments * 3) / ageHours;
    const hour = getHourInTimezone(new Date(publishedAt), timeZone);
    const bucket = buckets.get(hour) || { sum: 0, count: 0 };
    bucket.sum += score;
    bucket.count += 1;
    buckets.set(hour, bucket);
  });

  let bestHour = null;
  let bestScore = -1;
  for (const [hour, data] of buckets.entries()) {
    const avg = data.sum / Math.max(1, data.count);
    if (avg > bestScore) {
      bestScore = avg;
      bestHour = hour;
    }
  }
  return bestHour;
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

  const command = getEnv("COMMAND", "RUN_AUTO").trim().toUpperCase();
  const forceUpload = getEnv("FORCE_UPLOAD", "false").toLowerCase() === "true";
  const logsDir = path.join(process.cwd(), "logs");
  const logLabel = new Date().toISOString().replace(/[:.]/g, "-");

  if (command === "CHECK_LOGS") {
    try {
      const files = await fs.readdir(logsDir);
      const logs = files.filter((f) => f.endsWith(".log")).sort();
      if (logs.length) {
        const last = logs[logs.length - 1];
        const content = await fs.readFile(path.join(logsDir, last), "utf8");
        console.log(content);
      } else {
        log("No local logs found.");
      }
    } catch (err) {
      log(`Log check failed: ${err.message}`);
    }
    return;
  }

  if (!forceUpload && command !== "UPLOAD_NOW" && shouldSkipRun()) {
    log("Skipping upload this run based on UPLOAD_CHANCE.");
    await saveLogFile({
      logsDir,
      dropboxToken: getEnv("DROPBOX_ACCESS_TOKEN", "").trim(),
      dropboxFolder: getDropboxFolders().logs,
      label: logLabel,
    });
    return;
  }

  const smartSchedule = getEnv("SMART_SCHEDULE", "false").toLowerCase() === "true";
  if (smartSchedule && !forceUpload && command !== "UPLOAD_NOW") {
    const timeZone = getEnv("SCHEDULE_TZ", "UTC");
    const leadMinutes = Number(getEnv("SCHEDULE_LEAD_MINUTES", "15")) || 15;
    const windowMinutes = Number(getEnv("SCHEDULE_WINDOW_MINUTES", "10")) || 10;
    const minAgeHours = Number(getEnv("SCHEDULE_MIN_AGE_HOURS", "6")) || 6;
    const maxVideos = Number(getEnv("SCHEDULE_LOOKBACK_VIDEOS", "30")) || 30;
    const channelId = getEnv("CHANNEL_ID", "").trim();
    try {
      const accessToken = await getAccessToken();
      const bestHour = await getBestPublishHour({
        accessToken,
        channelId: channelId || undefined,
        maxVideos,
        minAgeHours,
        timeZone,
      });
      if (bestHour === null || Number.isNaN(bestHour)) {
        log("Smart schedule could not determine a best hour. Proceeding normally.");
      } else {
        const nowMinutes = getMinutesInTimezone(new Date(), timeZone);
        const runStart = bestHour * 60 - leadMinutes;
        const runEnd = runStart + windowMinutes;
        log(`Best publish hour (local ${timeZone}): ${bestHour}:00`);
        if (!isWithinWindow(nowMinutes, runStart, runEnd)) {
          log("Not within the scheduled upload window. Exiting.");
          await saveLogFile({
            logsDir,
            dropboxToken: getEnv("DROPBOX_ACCESS_TOKEN", "").trim(),
            dropboxFolder: getDropboxFolders().logs,
            label: logLabel,
          });
          return;
        }
      }
    } catch (err) {
      log(`Smart schedule failed: ${err.message}`);
    }
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
  const dropboxToken = getEnv("DROPBOX_ACCESS_TOKEN", "").trim();
  const dropboxFolders = getDropboxFolders();
  const dropboxFolder = dropboxFolders.backup;

  const downloadedBase = await downloadMediaList(baseVideoUrls, tempBaseDir, "base-video");
  const downloadedMusic = await downloadMediaList(musicUrls, tempMusicDir, "music");

  if (dropboxToken && dropboxFolders.backup) {
    try {
      await ensureDropboxFolder({ token: dropboxToken, path: dropboxFolders.backup });
      if (dropboxFolders.generated) await ensureDropboxFolder({ token: dropboxToken, path: dropboxFolders.generated });
      if (dropboxFolders.used) await ensureDropboxFolder({ token: dropboxToken, path: dropboxFolders.used });
      if (dropboxFolders.logs) await ensureDropboxFolder({ token: dropboxToken, path: dropboxFolders.logs });
    } catch (err) {
      log(`Dropbox folder setup failed: ${err.message}`);
    }
  }

  const backupOnly = getEnv("BACKUP_ONLY", "false").toLowerCase() === "true";
  if (backupOnly) {
    const dropboxOnly = getEnv("DROPBOX_ONLY", "false").toLowerCase() === "true";
    const accessToken = await getAccessToken();
    const backupCount = Number(getEnv("BACKUP_UPLOAD_COUNT", "1")) || 1;
    const dropboxDeleteAfter = getEnv("DROPBOX_DELETE_AFTER_UPLOAD", "true").toLowerCase() !== "false";
    const localVideos = dropboxOnly
      ? []
      : await listMediaFiles(baseDir, [".mp4", ".mov", ".mkv", ".webm"]);
    const downloadedVideos = dropboxOnly ? [] : downloadedBase.map((file) => path.basename(file));
    let dropboxVideos = [];
    if (dropboxToken && dropboxFolder) {
      try {
        dropboxVideos = await listDropboxVideos({ token: dropboxToken, folderPath: dropboxFolder });
      } catch (err) {
        log(`Dropbox list failed: ${err.message}`);
      }
    }
    const dropboxDownloads = [];
    if (dropboxVideos.length) {
      const needed = Math.min(backupCount, dropboxVideos.length);
      for (let i = 0; i < needed; i += 1) {
        const item = dropboxVideos[i];
        try {
          const primaryPath = item.pathLower || item.pathDisplay;
          const altPath = item.pathDisplay && item.pathDisplay !== primaryPath ? item.pathDisplay : "";
          if (!primaryPath) throw new Error("Dropbox item path is empty.");
          let pathDownloaded = "";
          let originPath = primaryPath;
          try {
            // eslint-disable-next-line no-await-in-loop
            pathDownloaded = await downloadDropboxFile({
              token: dropboxToken,
              filePath: primaryPath,
              destDir: tempBaseDir,
              fallbackName: item.name,
            });
          } catch (primaryErr) {
            if (!altPath) throw primaryErr;
            // eslint-disable-next-line no-await-in-loop
            pathDownloaded = await downloadDropboxFile({
              token: dropboxToken,
              filePath: altPath,
              destDir: tempBaseDir,
              fallbackName: item.name,
            });
            originPath = altPath;
          }
          const metaPath = (originPath || primaryPath).replace(/\.[^.]+$/, ".json");
          const meta = await downloadDropboxMetadata({ token: dropboxToken, metaPath });
          dropboxDownloads.push({
            path: pathDownloaded,
            name: item.name,
            time: item.time,
            originPath,
            metaPath,
            meta,
          });
        } catch (err) {
          log(`Dropbox download failed for ${item.name}: ${err.message}`);
        }
      }
    }
    const candidates = [
      ...downloadedVideos.map((file) => ({
        path: path.join(tempBaseDir, file),
        name: file,
        deletable: false,
      })),
      ...dropboxDownloads.map((file) => ({
        path: file.path,
        name: file.name,
        deletable: false,
        time: file.time,
        originPath: file.originPath,
        metaPath: file.metaPath,
        meta: file.meta,
      })),
      ...localVideos.map((file) => ({
        path: path.join(baseDir, file),
        name: file,
        deletable: getEnv("DELETE_BASE_VIDEO_AFTER_UPLOAD", "true").toLowerCase() !== "false",
      })),
    ];

    if (!candidates.length) {
      throw new Error("BACKUP_ONLY is true but no backup videos are available.");
    }

    const ordered = await sortByNewest(candidates);
    const count = Math.min(backupCount, ordered.length);
    log(`Backup-only mode: uploading ${count} backup video(s).`);
    for (let i = 0; i < count; i += 1) {
      const item = ordered[i];
      // eslint-disable-next-line no-await-in-loop
      const result = await uploadManualBaseVideoPath({
        filePath: item.path,
        fileName: item.name,
        deleteAfter: item.deletable,
        accessToken,
        titleOverride: getEnv("VIDEO_TITLE", "").trim(),
        descriptionOverride: getEnv("VIDEO_DESCRIPTION", "").trim(),
        tagsOverride: parseCsv(getEnv("VIDEO_TAGS", "")),
        metaTitle: item.meta?.title,
        metaDescription: item.meta?.description,
        metaTags: item.meta?.tags,
        extraHashtags: parseCsv(getEnv("HASHTAGS", "#shorts,#motivation,#success")),
        defaultDescription:
          "Daily motivational shorts.\n\nSubscribe for more success mindset content.\n\n#motivation #success #discipline",
        defaultTags: ["motivation", "success", "discipline", "shorts"],
      });
      if (result?.id && item.originPath && dropboxToken && (dropboxFolders.used || dropboxFolders.backup)) {
        const usedFolder = dropboxFolders.used || `${dropboxFolders.backup}/used_videos`;
        const targetPath = `${usedFolder}/${path.basename(item.originPath)}`;
        try {
          if (dropboxDeleteAfter) {
            // eslint-disable-next-line no-await-in-loop
            await deleteDropboxFile({ token: dropboxToken, filePath: item.originPath });
            log(`Deleted Dropbox backup after upload: ${item.originPath}`);
            if (item.metaPath) {
              // eslint-disable-next-line no-await-in-loop
              await deleteDropboxFile({ token: dropboxToken, filePath: item.metaPath });
              log(`Deleted Dropbox metadata after upload: ${item.metaPath}`);
            }
          } else {
            // eslint-disable-next-line no-await-in-loop
            await ensureDropboxFolder({ token: dropboxToken, path: usedFolder });
            // eslint-disable-next-line no-await-in-loop
            await moveDropboxFile({ token: dropboxToken, fromPath: item.originPath, toPath: targetPath });
            log(`Moved Dropbox backup to used folder: ${targetPath}`);
            if (item.metaPath) {
              const metaTarget = `${usedFolder}/${path.basename(item.metaPath)}`;
              // eslint-disable-next-line no-await-in-loop
              await moveDropboxFile({ token: dropboxToken, fromPath: item.metaPath, toPath: metaTarget });
              log(`Moved Dropbox metadata to used folder: ${metaTarget}`);
            }
          }
        } catch (err) {
          log(`Dropbox move failed: ${err.message}`);
        }
      }
    }
    await saveLogFile({
      logsDir,
      dropboxToken,
      dropboxFolder: dropboxFolders.logs,
      label: logLabel,
    });
    await cleanupTemp(tempDir);
    return;
  }

  const musicTracks = downloadedMusic.length
    ? downloadedMusic.map((file) => path.basename(file))
    : await listMediaFiles(musicDir, [".mp3", ".wav", ".m4a"]);
  const musicFile = musicTracks.length ? musicTracks[Math.floor(Math.random() * musicTracks.length)] : "";

  const minDurationEnv = Number(getEnv("MIN_DURATION", ""));
  let minDuration = Number.isFinite(minDurationEnv) && minDurationEnv > 0 ? minDurationEnv : 0;
  const maxDurationEnv = Number(getEnv("MAX_DURATION", ""));
  let maxDuration = Number.isFinite(maxDurationEnv) && maxDurationEnv > 0 ? maxDurationEnv : 0;
  const viralMode = getEnv("VIRAL_MODE", "true").toLowerCase() !== "false";
  const scriptDurationEnvRaw = getEnv("SCRIPT_DURATION_SECONDS", "").trim();
  const hasScriptDuration = scriptDurationEnvRaw !== "";

  if (viralMode) {
    if (!minDuration) minDuration = 20;
    if (!maxDuration) maxDuration = 40;
  }
  if (minDuration && maxDuration && minDuration > maxDuration) {
    maxDuration = minDuration;
  }
  let targetSecondsRaw = hasScriptDuration ? Number(scriptDurationEnvRaw) : 0;
  if (!targetSecondsRaw) {
    targetSecondsRaw = maxDuration || (viralMode ? 30 : 30);
  }
  const targetSeconds = Math.max(minDuration || 0, targetSecondsRaw || 30);
  const islamicContent = getEnv("ISLAMIC_CONTENT", "false").toLowerCase() === "true";
  const prompt = getEnv(
    "PROMPT",
    [
      `Write a ${targetSeconds} second viral YouTube Shorts script.`,
      "Structure:",
      "0-2 sec: scroll-stopping hook.",
      "2-10 sec: curiosity + tension.",
      "10-30 sec: fast value or story.",
      "Last 3 sec: loop ending that connects back to the first line.",
      "Use triggers: curiosity, fear, success, money, secrets.",
      "Hook examples: \"You're doing this wrong...\", \"This is why you're not successful...\", \"Nobody tells you this...\"",
      "Keep sentences short and punchy (5-12 words per phrase).",
      "Add natural micro-pauses using commas, dashes, or ellipses.",
      islamicContent
        ? "Include authentic Islamic values and themes (sabr, tawakkul, gratitude, prayer, self-discipline). Do not invent quotes or hadith; keep it respectful and general."
        : "",
    ].filter(Boolean).join(" ")
  );
  const language = getEnv("SCRIPT_LANGUAGE", "English").trim();
  const topics = parseCsv(getEnv("TOPIC_LIST", "success,mindset,money,productivity"));
  const blockedTopics = parseCsv(getEnv("TOPIC_BLOCKLIST", ""));
  const enableTrends = getEnv("ENABLE_TRENDS", "true").toLowerCase() !== "false";
  const trendRegion = getEnv("TRENDS_REGION", "US");
  const trendLanguage = getEnv("TRENDS_LANGUAGE", "en-US");
  const trendMax = Number(getEnv("TREND_MAX_TOPICS", "15")) || 15;
  const enableCompetitors = getEnv("ENABLE_COMPETITOR_ANALYSIS", "true").toLowerCase() !== "false";
  const competitorQuery = getEnv("COMPETITOR_QUERY", "").trim();
  const competitorChannels = Number(getEnv("COMPETITOR_CHANNELS", "5")) || 5;
  const competitorVideos = Number(getEnv("COMPETITOR_VIDEOS_PER_CHANNEL", "5")) || 5;
  const enableShortsTrends = getEnv("ENABLE_TREND_SHORTS", "true").toLowerCase() !== "false";
  const shortsQuery = getEnv("TREND_SHORTS_QUERY", "").trim();
  const shortsDays = Number(getEnv("TREND_SHORTS_DAYS", "7")) || 7;
  const learningPath = path.join(process.cwd(), "data", "learning.json");
  const learning = await loadLearningData(learningPath);
  let trendTopics = [];
  let shortsTopics = [];
  let competitorTopics = [];
  if (enableTrends) {
    try {
      const accessToken = await getAccessToken();
      const youtubeTrends = await fetchYoutubeTrends({ region: trendRegion, accessToken, maxTopics: trendMax });
      const googleTrends = await fetchGoogleTrends({ region: trendRegion, hl: trendLanguage, maxTopics: trendMax });
      trendTopics = buildRankedTopics({ trends: [...youtubeTrends, ...googleTrends], preferred: topics });
      if (enableShortsTrends) {
        const query = shortsQuery || topics[0] || "motivation";
        shortsTopics = await fetchTrendingShorts({
          accessToken,
          region: trendRegion,
          query,
          maxTopics: trendMax,
          publishedWithinDays: shortsDays,
        });
      }
      if (enableCompetitors) {
        const query = competitorQuery || topics[0] || "motivation";
        const competitor = await fetchCompetitorInsights({
          accessToken,
          query,
          maxChannels: competitorChannels,
          maxVideosPerChannel: competitorVideos,
        });
        competitorTopics = competitor?.topics || [];
      }
    } catch (err) {
      log(`Trend fetch failed: ${err.message}`);
    }
  }
  const learnedTopics = Object.entries(learning?.topics || {})
    .sort((a, b) => b[1] - a[1])
    .map(([topic]) => topic);
  const mergedTopics = Array.from(
    new Set([...(trendTopics || []), ...shortsTopics, ...competitorTopics, ...learnedTopics, ...topics])
  )
    .filter((topic) => {
      if (!blockedTopics.length) return true;
      const lower = String(topic).toLowerCase();
      return !blockedTopics.some((blocked) => lower.includes(blocked.toLowerCase()));
    });
  const dailyTopic = pickDailyTopic(mergedTopics.length ? mergedTopics : topics);
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
  const minDurationFinal = minDuration || 0;
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

  const isGenerateBackup = command === "GENERATE_BACKUP";
  const uploadToYoutubeEnabled = command !== "GENERATE_BACKUP";
  const backupGenerateCount = Number(getEnv("BACKUP_GENERATE_COUNT", "5")) || 5;
  const generationRuns = isGenerateBackup ? Math.min(10, Math.max(1, backupGenerateCount)) : 1;
  const saveGenerated = getEnv("SAVE_GENERATED_VIDEOS", "true").toLowerCase() !== "false";
  const dropboxSaveGenerated = getEnv("DROPBOX_SAVE_GENERATED", "true").toLowerCase() !== "false";

  let voiceFile = "";
  let videoPath = "";
  let fallbackSucceeded = false;
  let lastScript = "";
  let lastTitle = "";
  let lastDescription = "";
  let lastTags = [];
  let lastVoicePath = "";

  try {
    const hookVariants = Number(getEnv("HOOK_VARIANTS", "5")) || 5;
    const maxAttemptsPerModel = Number(getEnv("OPENAI_MODEL_ATTEMPTS", "2")) || 2;
    const modelsToTry = Array.from(
      new Set([openaiModel, ...modelList, openaiFallbackModel].filter(Boolean))
    );

    const ctaList = parseCsv(
      getEnv(
        "CTA_LIST",
        "Save this. Share it.,Follow for more daily motivation.,Subscribe for more success mindset tips."
      )
    );
    const appendCta = getEnv("APPEND_CTA", "true").toLowerCase() !== "false";
    const retentionMaxWords = Number(getEnv("RETENTION_INTRO_MAX_WORDS", "14")) || 14;
    const buildScriptVariant = (base, hook) => {
      let output = hook ? replaceFirstSentence(base, hook) : base;
      output = stripWeakIntro(output);
      output = trimFirstSentence(output, retentionMaxWords);
      if (appendCta && needsCta(output)) {
        const cta = pickRandom(ctaList, "Save this and share it.");
        output = `${output.trim()} ${cta}`.replace(/\s+/g, " ").trim();
      }
      const maxScriptSeconds = maxDurationFinal || (viralMode ? 40 : 0);
      output = trimScriptToDuration(output, maxScriptSeconds);
      output = ensureMinScriptLength(output, minDurationFinal);
      output = enforceLoopEnding(output);
      return output;
    };

    const accessToken = uploadToYoutubeEnabled ? await getAccessToken() : null;
    for (let runIndex = 0; runIndex < generationRuns; runIndex += 1) {
      const runTopic = isGenerateBackup ? pickRandom(mergedTopics, dailyTopic) : dailyTopic;
      const topicLine = runTopic ? `Topic: ${runTopic}` : "";
      const abTest = !isGenerateBackup && getEnv("AB_TEST", "false").toLowerCase() === "true";
      const variantCount = abTest ? 2 : 1;

      let hooks = [];
      if (hookVariants > 0) {
        try {
          log("Generating hooks");
          hooks = await generateHooks({
            topic: runTopic,
            apiKey: getEnv("OPENAI_API_KEY").trim(),
            baseUrl: openaiBaseUrl,
            model: openaiModel,
            count: hookVariants,
          });
        } catch (err) {
          log(`Hook generation failed: ${err.message}`);
        }
      }
      const hookChoices = pickTopHooks(hooks, variantCount);
      const primaryHook = hookChoices[0] || "";

      log("Generating script");
      let script = "";
      let lastError = null;
      let usedModel = openaiModel;

      for (const model of modelsToTry) {
        for (let attempt = 1; attempt <= maxAttemptsPerModel; attempt += 1) {
          try {
            log(`Script attempt ${attempt} using model: ${model}`);
            const finalPrompt = [
              `${prompt}\n\nLanguage: ${language}.`,
              "Include a clear call-to-action in the last sentence.",
              primaryHook ? `Start with this exact hook: "${primaryHook}".` : "",
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

      const scriptsToRender = [];
      const hookLabels = ["A", "B", "C"];
      const secondaryHook = hookChoices[1] || "";
      const baseScript = buildScriptVariant(script, primaryHook);
      scriptsToRender.push({ label: hookLabels[0], hook: primaryHook, script: baseScript });
      if (abTest) {
        const altHook = secondaryHook || primaryHook;
        const altScript = buildScriptVariant(script, altHook);
        scriptsToRender.push({ label: hookLabels[1], hook: altHook, script: altScript });
      }

      for (const variant of scriptsToRender) {
      const scriptVariant = variant.script;
      let variantTitle = titleOverride;
      let variantDescription = descriptionOverride;
      let variantTags = tagsOverride;

      if (useAiMetadata) {
        try {
          log("Generating metadata");
          const metadata = await generateMetadata({
            script: scriptVariant,
            channelContext,
            apiKey: getEnv("OPENAI_API_KEY").trim(),
            baseUrl: openaiBaseUrl,
            model: usedModel,
            variants: titleVariants,
          });
          if (!titleOverride) {
            variantTitle = metadata.title || pickBestTitle(metadata.titles || []);
          }
          if (!descriptionOverride && metadata.description) variantDescription = metadata.description;
          if (!tagsOverride.length && metadata.tags?.length) variantTags = metadata.tags;
        } catch (err) {
          log(`Metadata generation failed: ${err.message}`);
        }
      }

      if (!variantTitle) {
        variantTitle = buildTitleFromScript(scriptVariant);
      }
      const titlePolish = getEnv("TITLE_POLISH", "true").toLowerCase() !== "false";
      if (titlePolish) {
        variantTitle = polishTitle(variantTitle);
      }
      if (!variantDescription) {
        variantDescription = defaultDescription;
      }
      if (!variantTags.length) {
        variantTags = defaultTags;
      }
      if (extraHashtags.length) {
        variantDescription = withHashtags(variantDescription, extraHashtags);
      }
      if (!variantTags.includes("shorts")) {
        variantTags = [...variantTags, "shorts"];
      }
      log(`Using title: ${variantTitle}`);
      log(`Using tags: ${variantTags.join(", ") || "none"}`);
      lastScript = scriptVariant;
      lastTitle = variantTitle;
      lastDescription = variantDescription;
      lastTags = variantTags;

      log("Generating voice");
      const voiceResult = await generateVoice({
        text: scriptVariant,
        voice,
        elevenLabsApiKey: getEnv("ELEVENLABS_API_KEY").replace(/\s+/g, ""),
        outDir: tempDir,
      });
      voiceFile = voiceResult.file;

      const voicePath = path.join(tempDir, voiceFile);
      lastVoicePath = voicePath;
      const audioDuration = await getMediaDuration(voicePath);
      const desiredVisualDuration =
        maxDurationFinal || minDurationFinal || audioDuration || Number(getEnv("SCRIPT_DURATION_SECONDS", "30")) || 30;
      let basePath = "";

      const userVideos = downloadedBase.length
        ? downloadedBase.map((file) => path.basename(file))
        : await listMediaFiles(baseDir, [".mp4", ".mov", ".mkv", ".webm"]);
      const userImages = await listMediaFiles(userImagesDir, [".jpg", ".jpeg", ".png", ".webp"]);

      if (enableStockVideo) {
        if (!pexelsApiKey && !pixabayApiKey) {
          throw new Error("ENABLE_STOCK_VIDEO is true but no stock API key is set (PEXELS_API_KEY or PIXABAY_API_KEY).");
        }
        let parts = splitScriptIntoParts(scriptVariant);
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
            const replacement = pickUserScene(mixedScenes[idx]?.text || scriptVariant);
            if (replacement) mixedScenes[idx] = replacement;
          }
          if (!usedStock) {
            const idx = Math.floor(Math.random() * mixedScenes.length);
            const replacement = pickStockScene(idx, mixedScenes[idx]?.text || scriptVariant);
            if (replacement) mixedScenes[idx] = replacement;
          }
        }

        const usableMixed = mixedScenes.filter((scene) => scene?.type !== "empty");
        if (usableMixed.length) {
          basePath = await generateStockBaseVideo({
            scenes: usableMixed,
            outDir: tempDir,
            totalDuration: desiredVisualDuration,
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
      const highlightWords = highlightEnabled ? extractKeywords(scriptVariant, 6) : [];
      const popupEnabled = getEnv("KEYWORD_POPUPS", "true").toLowerCase() !== "false";
      const keywordPopups = popupEnabled ? extractKeywords(scriptVariant, 8).slice(0, 3) : [];
      const hookMaxWords = Number(getEnv("HOOK_MAX_WORDS", "10")) || 10;
      const hookUpper = getEnv("HOOK_UPPERCASE", "true").toLowerCase() !== "false";
      const subtitleStyle = {
        fontSize: Math.round(randomBetween(60, 78)),
        outline: Math.round(randomBetween(4, 7)),
        yOffset: Math.round(randomBetween(170, 300)),
        fontColor: "white",
        highlightColor: pickRandom(["yellow", "cyan", "lime"], "yellow"),
        popEnabled: true,
        popScale: randomBetween(1.15, 1.28),
        popDuration: randomBetween(0.1, 0.16),
        box: Math.random() < 0.45,
        boxColor: "black@0.45",
        boxBorder: Math.round(randomBetween(8, 12)),
      };
      subtitleStyle.glow = getEnv("TEXT_GLOW", "true").toLowerCase() !== "false";
      const hookTextRaw = (variant.hook || (scriptVariant.split(/(?<=[.?!])\s+/)[0] || scriptVariant))
        .split(" ")
        .slice(0, hookMaxWords)
        .join(" ")
        .trim();
      const hookText = hookUpper ? hookTextRaw.toUpperCase() : hookTextRaw;
      const hookBoost = getEnv("HOOK_BOOST", "true").toLowerCase() !== "false";
      subtitleStyle.hookSize = hookBoost ? Math.round(subtitleStyle.fontSize * 1.85) : Math.round(subtitleStyle.fontSize * 1.4);
      subtitleStyle.hookOutline = hookBoost ? Math.round(subtitleStyle.outline * 2.6) : Math.round(subtitleStyle.outline * 1.8);
      subtitleStyle.hookY = Math.round(randomBetween(110, 180));

      const musicVolume = Number(getEnv("MUSIC_VOLUME", "0.18"));
      const watermarkText = getEnv("WATERMARK_TEXT", "").trim();

      videoPath = await generateVideo({
        baseVideoPath: basePath,
        voicePath,
        script: scriptVariant,
        outDir: tempDir,
        title: variantTitle,
        musicPath,
        maxDuration: maxDurationFinal,
        minDuration: minDurationFinal,
        musicVolume: Number.isFinite(musicVolume) ? musicVolume : 0.18,
        subtitleMode,
        highlightWords,
        subtitleStyle,
        hookText,
        keywordPopups,
        watermarkText,
      });

      let uploadResult = null;
      if (uploadToYoutubeEnabled) {
        log("Uploading to YouTube");
        uploadResult = await retry(() =>
          uploadToYoutube({
            accessToken,
            refreshToken: getEnv("YOUTUBE_REFRESH_TOKEN"),
            videoPath,
            title: variantTitle,
            description: variantDescription,
            tags: variantTags,
          })
        );
        const uploadedId = uploadResult?.id || "unknown-id";
        const channelId =
          uploadResult?.snippet?.channelId || getEnv("CHANNEL_ID", "").trim() || "unknown-channel";
        log(`Upload complete: ${uploadedId}`);
        const privacy = uploadResult?.status?.privacyStatus;
        const channelTitle = uploadResult?.snippet?.channelTitle;
        if (privacy) log(`Privacy: ${privacy}`);
        if (channelTitle) log(`Channel: ${channelTitle}`);
        log(`Watch URL: https://www.youtube.com/watch?v=${uploadedId}`);
        log(`Studio URL: https://studio.youtube.com/video/${uploadedId}/edit`);
        log(`Channel ID: ${channelId}`);
      } else {
        log("Backup generation mode: skipping YouTube upload.");
      }

      if (saveGenerated && videoPath) {
        const dropboxGeneratedFolder = dropboxFolders.generated && dropboxSaveGenerated ? dropboxFolders.generated : "";
        await saveGeneratedCopy({
          videoPath,
          title: variantTitle,
          dropboxToken,
          dropboxFolder: dropboxGeneratedFolder,
        });
      }

      const uploadBackup = getEnv("DROPBOX_UPLOAD_BACKUPS", "false").toLowerCase() === "true";
      if ((uploadBackup || isGenerateBackup) && dropboxToken && dropboxFolders.backup && videoPath) {
        try {
          const nameBase = variantTitle || hookTextRaw || "backup";
          const meta = buildBackupMeta({
            title: variantTitle,
            description: variantDescription,
            tags: variantTags,
            hook: variant.hook,
            topic: runTopic,
          });
          const dropboxInfo = await uploadBackupToDropbox({
            token: dropboxToken,
            folderPath: dropboxFolders.backup,
            videoPath,
            meta,
            nameBase,
          });
          log(`Dropbox backup saved: ${dropboxInfo?.videoDropboxPath || "unknown"}`);
        } catch (err) {
          log(`Dropbox backup upload failed: ${err.message}`);
        }
      }

      const enableThumbnail = getEnv("ENABLE_THUMBNAIL", "true").toLowerCase() !== "false";
      if (uploadToYoutubeEnabled && enableThumbnail && uploadResult?.id) {
        try {
          const thumbStyle = variant.label === "B"
            ? { fontSize: 92, outline: 7, yPos: 240, color: "yellow" }
            : { fontSize: 100, outline: 8, yPos: 200, color: "white" };
          const thumbPath = await generateThumbnail({
            videoPath,
            outDir: tempDir,
            hookText: hookTextRaw,
            style: thumbStyle,
          });
          await uploadThumbnail({
            accessToken,
            refreshToken: getEnv("YOUTUBE_REFRESH_TOKEN"),
            videoId: uploadResult.id,
            thumbnailPath: thumbPath,
          });
          log("Thumbnail uploaded.");
        } catch (err) {
          log(`Thumbnail upload failed: ${err.message}`);
        }
      }

      const saveArtifacts = getEnv("SAVE_ARTIFACTS", "false").toLowerCase() === "true";
      if (saveArtifacts && videoPath) {
        const artifactsDir = path.join(process.cwd(), "artifacts");
        await fs.mkdir(artifactsDir, { recursive: true });
        const target = path.join(artifactsDir, path.basename(videoPath));
        try {
          await fs.copyFile(videoPath, target);
        } catch (err) {
          log(`Artifact copy failed: ${err.message}`);
        }
      }

      const postComment = getEnv("POST_COMMENT", "false").toLowerCase() === "true";
      const pinnedComment = getEnv("PINNED_COMMENT", "").trim();
      if (uploadToYoutubeEnabled && postComment && pinnedComment && uploadResult?.id) {
        try {
          await postTopLevelComment({
            accessToken,
            refreshToken: getEnv("YOUTUBE_REFRESH_TOKEN"),
            videoId: uploadResult.id,
            text: pinnedComment,
          });
          log("Posted top-level comment. Pin manually in YouTube Studio.");
        } catch (err) {
          log(`Comment post failed: ${err.message}`);
        }
      }

      const autoReply = getEnv("AUTO_REPLY_COMMENTS", "false").toLowerCase() === "true";
      const replyText = getEnv("REPLY_COMMENT_TEXT", "").trim();
      if (uploadToYoutubeEnabled && autoReply && replyText && uploadResult?.id) {
        try {
          await replyToTopComment({
            accessToken,
            refreshToken: getEnv("YOUTUBE_REFRESH_TOKEN"),
            videoId: uploadResult.id,
            text: replyText,
          });
          log("Replied to top comment.");
        } catch (err) {
          log(`Auto-reply failed: ${err.message}`);
        }
      }

      if (uploadToYoutubeEnabled && uploadResult?.id && accessToken) {
        const stats = await fetchVideoStats(accessToken, uploadResult?.id);
        if (stats) {
          updateLearning(learning, { topic: runTopic, hook: variant.hook, stats });
          await saveLearningData(learningPath, learning);
        }
      }
    }
    }
  } catch (err) {
    log(`Video generation failed: ${err.message}`);
    const fallbackEnabled = getEnv("FALLBACK_BASE_UPLOAD", "true").toLowerCase() !== "false";
    if (fallbackEnabled) {
      try {
        log("Attempting manual base-video fallback upload.");
        const accessToken = await getAccessToken();
        const localVideos = await listMediaFiles(baseDir, [".mp4", ".mov", ".mkv", ".webm"]);
        const downloadedVideos = downloadedBase.map((file) => path.basename(file));
        let dropboxPick = null;
        if (dropboxToken && dropboxFolder) {
          try {
            const dropboxVideos = await listDropboxVideos({ token: dropboxToken, folderPath: dropboxFolder });
            const first = dropboxVideos[0];
            if (first) {
              const primaryPath = first.pathLower || first.pathDisplay;
              const altPath = first.pathDisplay && first.pathDisplay !== primaryPath ? first.pathDisplay : "";
              if (!primaryPath) throw new Error("Dropbox item path is empty.");
              let downloaded = "";
              let originPath = primaryPath;
              try {
                downloaded = await downloadDropboxFile({
                  token: dropboxToken,
                  filePath: primaryPath,
                  destDir: tempBaseDir,
                  fallbackName: first.name,
                });
              } catch (primaryErr) {
                if (!altPath) throw primaryErr;
                downloaded = await downloadDropboxFile({
                  token: dropboxToken,
                  filePath: altPath,
                  destDir: tempBaseDir,
                  fallbackName: first.name,
                });
                originPath = altPath;
              }
              const metaPath = (originPath || primaryPath).replace(/\.[^.]+$/, ".json");
              const meta = await downloadDropboxMetadata({ token: dropboxToken, metaPath });
              dropboxPick = {
                path: downloaded,
                name: first.name,
                time: first.time,
                originPath,
                metaPath,
                meta,
              };
            }
          } catch (err) {
            log(`Dropbox fallback failed: ${err.message}`);
          }
        }
        const candidates = [
          ...downloadedVideos.map((file) => ({
            path: path.join(tempBaseDir, file),
            name: file,
            deletable: false,
          })),
          ...(dropboxPick
            ? [
                {
                  path: dropboxPick.path,
                  name: dropboxPick.name,
                  deletable: false,
                  time: dropboxPick.time,
                  originPath: dropboxPick.originPath,
                  metaPath: dropboxPick.metaPath,
                  meta: dropboxPick.meta,
                },
              ]
            : []),
          ...localVideos.map((file) => ({
            path: path.join(baseDir, file),
            name: file,
            deletable: getEnv("DELETE_BASE_VIDEO_AFTER_UPLOAD", "true").toLowerCase() !== "false",
          })),
        ];
        const ordered = await sortByNewest(candidates);
        const pick = ordered[0];
        const fallbackResult = pick
          ? await uploadManualBaseVideoPath({
              filePath: pick.path,
              fileName: pick.name,
              deleteAfter: pick.deletable,
              accessToken,
              titleOverride,
              descriptionOverride,
              tagsOverride,
              metaTitle: pick.meta?.title,
              metaDescription: pick.meta?.description,
              metaTags: pick.meta?.tags,
              extraHashtags,
              defaultDescription,
              defaultTags,
            })
          : null;
        if (fallbackResult?.id) {
          log(`Fallback upload complete: ${fallbackResult.id}`);
          fallbackSucceeded = true;
          if (pick?.originPath && dropboxToken && (dropboxFolders.used || dropboxFolders.backup)) {
            const usedFolder = dropboxFolders.used || `${dropboxFolders.backup}/used_videos`;
            const targetPath = `${usedFolder}/${path.basename(pick.originPath)}`;
            try {
              await ensureDropboxFolder({ token: dropboxToken, path: usedFolder });
              await moveDropboxFile({ token: dropboxToken, fromPath: pick.originPath, toPath: targetPath });
              log(`Moved Dropbox backup to used folder: ${targetPath}`);
              if (pick.metaPath) {
                const metaTarget = `${usedFolder}/${path.basename(pick.metaPath)}`;
                await moveDropboxFile({ token: dropboxToken, fromPath: pick.metaPath, toPath: metaTarget });
                log(`Moved Dropbox metadata to used folder: ${metaTarget}`);
              }
            } catch (err) {
              log(`Dropbox move failed: ${err.message}`);
            }
          }
        } else {
          log("Fallback upload skipped (no base videos available).");
        }
      } catch (fallbackErr) {
        log(`Fallback upload failed: ${fallbackErr.message}`);
      }
    }
    const generatedFallbackEnabled = getEnv("FALLBACK_GENERATED_VIDEO", "true").toLowerCase() !== "false";
    if (!fallbackSucceeded && generatedFallbackEnabled) {
      try {
        log("Attempting generated fallback upload.");
        const accessToken = await getAccessToken();
        const fallbackResult = await uploadGeneratedFallback({
          tempDir,
          accessToken,
          script: lastScript,
          voicePath: lastVoicePath,
          voice,
          titleOverride: lastTitle || titleOverride,
          descriptionOverride: lastDescription || descriptionOverride,
          tagsOverride: lastTags.length ? lastTags : tagsOverride,
          extraHashtags,
          defaultDescription,
          defaultTags,
          minDuration: minDurationFinal,
          maxDuration: maxDurationFinal,
        });
        if (fallbackResult?.id) {
          log(`Generated fallback upload complete: ${fallbackResult.id}`);
          fallbackSucceeded = true;
        }
      } catch (fallbackErr) {
        log(`Generated fallback failed: ${fallbackErr.message}`);
      }
    }
    if (!fallbackSucceeded) {
      await saveLogFile({
        logsDir,
        dropboxToken,
        dropboxFolder: dropboxFolders.logs,
        label: logLabel,
      });
      throw err;
    }
  }

  await saveLogFile({
    logsDir,
    dropboxToken,
    dropboxFolder: dropboxFolders.logs,
    label: logLabel,
  });
  await cleanupTemp(tempDir);
  if (fallbackSucceeded) return;
}

run().catch(async (err) => {
  console.error("[auto] Fatal error:", err);
  await cleanupTemp(path.join(os.tmpdir(), "shorts-factory-daily"));
  process.exit(1);
});
