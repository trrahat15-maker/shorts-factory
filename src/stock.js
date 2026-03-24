import fs from "fs/promises";
import { existsSync } from "fs";
import path from "path";

const STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "you",
  "your",
  "with",
  "that",
  "this",
  "from",
  "will",
  "are",
  "was",
  "were",
  "have",
  "has",
  "had",
  "not",
  "but",
  "all",
  "any",
  "can",
  "cant",
  "cannot",
  "just",
  "into",
  "out",
  "about",
  "more",
  "most",
  "when",
  "then",
  "than",
  "them",
  "they",
  "their",
  "our",
  "ours",
  "his",
  "her",
  "she",
  "him",
  "who",
  "what",
  "why",
  "how",
  "like",
  "dont",
  "did",
  "does",
  "doing",
  "over",
  "under",
  "again",
  "because",
  "while",
  "every",
  "each",
  "make",
  "made",
  "keep",
  "keeps",
  "yourself",
  "yourself",
  "we",
  "us",
  "our",
  "i",
  "me",
  "my",
  "mine",
  "it",
  "its",
  "is",
  "be",
  "as",
  "on",
  "in",
  "at",
  "of",
  "to",
  "a",
  "an",
  "or",
]);

function normalizeWord(word) {
  return word.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function extractKeywords(text, maxKeywords = 5) {
  if (!text) return [];
  const counts = new Map();
  text
    .split(/\s+/)
    .map((word) => normalizeWord(word))
    .filter((word) => word && !STOPWORDS.has(word) && word.length > 3)
    .forEach((word) => {
      counts.set(word, (counts.get(word) || 0) + 1);
    });

  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
    .slice(0, maxKeywords)
    .map(([word]) => word);
}

export function splitScriptIntoParts(script) {
  if (!script) return [];
  const sentences = script
    .split(/(?<=[.?!])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const wordCount = script.split(/\s+/).filter(Boolean).length;
  let parts = 2;
  if (wordCount > 80) parts = 4;
  else if (wordCount > 50) parts = 3;

  if (sentences.length <= parts) {
    return sentences.map((text) => ({ text }));
  }

  const chunkSize = Math.ceil(sentences.length / parts);
  const output = [];
  for (let i = 0; i < sentences.length; i += chunkSize) {
    output.push({ text: sentences.slice(i, i + chunkSize).join(" ") });
  }
  return output.slice(0, parts);
}

async function fetchJson(url, headers) {
  const response = await fetch(url, { headers });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Stock API error ${response.status}: ${body}`);
  }
  return response.json();
}

async function downloadAsset(url, destDir, nameHint) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download ${url}: ${response.status}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  const fileName = path.basename(new URL(url).pathname) || nameHint;
  const destPath = path.join(destDir, fileName);
  await fs.writeFile(destPath, buffer);
  return destPath;
}

function pickBestVideoFile(video) {
  const files = Array.isArray(video?.video_files) ? video.video_files : [];
  if (!files.length) return null;
  const sorted = files
    .filter((file) => file?.link)
    .sort((a, b) => (b.height || 0) - (a.height || 0));
  return sorted[0];
}

export async function fetchPexelsVideo(query, apiKey) {
  const url = `https://api.pexels.com/videos/search?query=${encodeURIComponent(
    query
  )}&per_page=6&orientation=portrait`;
  const data = await fetchJson(url, { Authorization: apiKey });
  const videos = Array.isArray(data?.videos) ? data.videos : [];
  if (!videos.length) return null;
  const chosen = videos[Math.floor(Math.random() * videos.length)];
  const file = pickBestVideoFile(chosen);
  return file?.link || null;
}

export async function fetchPexelsImages(query, apiKey) {
  const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(
    query
  )}&per_page=6&orientation=portrait`;
  const data = await fetchJson(url, { Authorization: apiKey });
  const photos = Array.isArray(data?.photos) ? data.photos : [];
  return photos
    .map((photo) => photo?.src?.large2x || photo?.src?.large || "")
    .filter(Boolean);
}

async function fetchPixabayJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Pixabay API error ${response.status}: ${body}`);
  }
  return response.json();
}

export async function fetchPixabayVideo(query, apiKey) {
  const url = `https://pixabay.com/api/videos/?key=${encodeURIComponent(apiKey)}&q=${encodeURIComponent(
    query
  )}&orientation=vertical&per_page=5`;
  const data = await fetchPixabayJson(url);
  const hits = Array.isArray(data?.hits) ? data.hits : [];
  if (!hits.length) return null;
  const chosen = hits[Math.floor(Math.random() * hits.length)];
  const video = chosen?.videos?.large || chosen?.videos?.medium || chosen?.videos?.small;
  return video?.url || null;
}

export async function fetchPixabayImages(query, apiKey) {
  const url = `https://pixabay.com/api/?key=${encodeURIComponent(apiKey)}&q=${encodeURIComponent(
    query
  )}&orientation=vertical&per_page=6`;
  const data = await fetchPixabayJson(url);
  const hits = Array.isArray(data?.hits) ? data.hits : [];
  return hits.map((hit) => hit?.largeImageURL || hit?.webformatURL || "").filter(Boolean);
}

const CACHE_DIR = path.join(process.cwd(), "data", "stock-cache");

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function cacheAsset(filePath) {
  try {
    await ensureDir(CACHE_DIR);
    const target = path.join(CACHE_DIR, path.basename(filePath));
    if (filePath !== target) {
      await fs.copyFile(filePath, target);
    }
  } catch (err) {
    console.warn(`[stock] Cache copy failed: ${err.message}`);
  }
}

export async function loadCachedMedia() {
  const videos = [];
  const images = [];
  if (!existsSync(CACHE_DIR)) return { videos, images };
  try {
    const files = await fs.readdir(CACHE_DIR);
    files.forEach((file) => {
      const lower = file.toLowerCase();
      if (lower.endsWith(".mp4") || lower.endsWith(".mov") || lower.endsWith(".webm")) {
        videos.push(path.join(CACHE_DIR, file));
      } else if (lower.endsWith(".jpg") || lower.endsWith(".jpeg") || lower.endsWith(".png") || lower.endsWith(".webp")) {
        images.push(path.join(CACHE_DIR, file));
      }
    });
  } catch (err) {
    console.warn(`[stock] Cache read failed: ${err.message}`);
  }
  return { videos, images };
}

export async function fetchStockScenes({ parts, pexelsApiKey, pixabayApiKey, enableImages, tempDir }) {
  if (!parts.length) return [];
  await ensureDir(tempDir);

  const scenes = [];
  for (let i = 0; i < parts.length; i += 1) {
    const text = parts[i]?.text || "";
    const keywords = extractKeywords(text, 4);
    const query = keywords.join(" ") || "motivation success";

    let videoUrl = null;
    if (pexelsApiKey) {
      try {
        videoUrl = await fetchPexelsVideo(query, pexelsApiKey);
      } catch (err) {
        console.warn(`[stock] Pexels video search failed: ${err.message}`);
      }
    }
    if (!videoUrl && pixabayApiKey) {
      try {
        videoUrl = await fetchPixabayVideo(query, pixabayApiKey);
      } catch (err) {
        console.warn(`[stock] Pixabay video search failed: ${err.message}`);
      }
    }

    if (videoUrl) {
      const filePath = await downloadAsset(videoUrl, tempDir, `stock-video-${i + 1}.mp4`);
      await cacheAsset(filePath);
      scenes.push({ type: "video", path: filePath, text, keywords, source: "stock" });
      continue;
    }

    if (enableImages && (pexelsApiKey || pixabayApiKey)) {
      try {
        let images = [];
        if (pexelsApiKey) {
          images = await fetchPexelsImages(query, pexelsApiKey);
        }
        if (!images.length && pixabayApiKey) {
          images = await fetchPixabayImages(query, pixabayApiKey);
        }
        const selected = images.slice(0, 5);
        if (selected.length) {
          const paths = [];
          for (let j = 0; j < selected.length; j += 1) {
            const imagePath = await downloadAsset(
              selected[j],
              tempDir,
              `stock-image-${i + 1}-${j + 1}.jpg`
            );
            await cacheAsset(imagePath);
            paths.push(imagePath);
          }
          scenes.push({ type: "images", paths, text, keywords, source: "stock" });
          continue;
        }
      } catch (err) {
        console.warn(`[stock] Pexels image search failed: ${err.message}`);
      }
    }

    scenes.push({ type: "empty", text, keywords });
  }

  return scenes;
}
