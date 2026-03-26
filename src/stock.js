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

const KEYWORD_SYNONYMS = {
  success: ["achievement", "winning", "business", "money"],
  failure: ["struggle", "loss", "sad", "setback"],
  discipline: ["training", "routine", "habit", "grind"],
  focus: ["study", "deep work", "concentration"],
  confidence: ["leader", "speaker", "stage"],
  fear: ["anxiety", "dark", "alone"],
  dream: ["goal", "vision", "future"],
  hustle: ["city", "night work", "office"],
  grind: ["gym", "training", "workout"],
  growth: ["progress", "improvement", "evolution"],
  mindset: ["mental", "psychology", "brain"],
  power: ["strength", "energy", "force"],
};

const EMOTION_QUERIES = {
  success: ["winning", "rich lifestyle", "business success"],
  failure: ["sad", "lonely", "struggle"],
  focus: ["focused work", "study", "productivity"],
  money: ["money cash", "luxury", "wealth"],
  fear: ["anxiety", "dark", "pressure"],
};

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

function shuffleArray(items) {
  const array = [...items];
  for (let i = array.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

function expandKeywords(keywords) {
  const expanded = new Set();
  keywords.forEach((keyword) => {
    const norm = normalizeWord(keyword);
    expanded.add(norm);
    const synonyms = KEYWORD_SYNONYMS[norm];
    if (synonyms) {
      synonyms.forEach((syn) => expanded.add(syn));
    }
  });
  return Array.from(expanded).filter(Boolean);
}

function detectEmotion(text) {
  const lower = (text || "").toLowerCase();
  if (/(fail|failure|lost|regret|sad|lonely|broke|struggle)/.test(lower)) return "failure";
  if (/(money|wealth|rich|cash|income|salary)/.test(lower)) return "money";
  if (/(focus|study|discipline|consistent|productivity|work)/.test(lower)) return "focus";
  if (/(fear|anxiety|doubt|worry)/.test(lower)) return "fear";
  if (/(success|win|achieve|goal|dream)/.test(lower)) return "success";
  return "";
}

function buildQueryVariants(text) {
  const keywords = extractKeywords(text, 5);
  const emotion = detectEmotion(text);
  if (!keywords.length && !emotion) return ["motivation success"];
  const expanded = expandKeywords(keywords);
  const primary = keywords.slice(0, 3).join(" ");
  const secondary = expanded.slice(0, 4).join(" ");
  const variants = new Set([primary, secondary]);
  if (emotion && EMOTION_QUERIES[emotion]) {
    EMOTION_QUERIES[emotion].forEach((query) => variants.add(query));
  }
  keywords.forEach((word) => variants.add(word));
  return Array.from(variants).filter(Boolean);
}

export function splitScriptIntoParts(script) {
  if (!script) return [];
  const sentences = script
    .split(/(?<=[.?!])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const wordCount = script.split(/\s+/).filter(Boolean).length;
  let parts = 5;
  if (wordCount > 160) parts = 8;
  else if (wordCount > 140) parts = 7;
  else if (wordCount > 120) parts = 6;

  if (sentences.length >= parts) {
    const chunkSize = Math.ceil(sentences.length / parts);
    const output = [];
    for (let i = 0; i < sentences.length; i += chunkSize) {
      output.push({ text: sentences.slice(i, i + chunkSize).join(" ") });
    }
    return output.slice(0, parts);
  }

  const words = script.split(/\s+/).filter(Boolean);
  const chunkSize = Math.ceil(words.length / parts);
  const output = [];
  for (let i = 0; i < words.length; i += chunkSize) {
    output.push({ text: words.slice(i, i + chunkSize).join(" ") });
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

export async function fetchPexelsVideos(query, apiKey, limit = 3) {
  const url = `https://api.pexels.com/videos/search?query=${encodeURIComponent(
    query
  )}&per_page=6&orientation=portrait`;
  const data = await fetchJson(url, { Authorization: apiKey });
  const videos = Array.isArray(data?.videos) ? data.videos : [];
  if (!videos.length) return [];
  const shuffled = shuffleArray(videos);
  const links = [];
  shuffled.forEach((video) => {
    if (links.length >= limit) return;
    const file = pickBestVideoFile(video);
    if (file?.link) links.push(file.link);
  });
  return links;
}

export async function fetchPexelsVideo(query, apiKey) {
  const links = await fetchPexelsVideos(query, apiKey, 1);
  return links[0] || null;
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

export async function fetchPixabayVideos(query, apiKey, limit = 3) {
  const url = `https://pixabay.com/api/videos/?key=${encodeURIComponent(apiKey)}&q=${encodeURIComponent(
    query
  )}&orientation=vertical&per_page=5`;
  const data = await fetchPixabayJson(url);
  const hits = Array.isArray(data?.hits) ? data.hits : [];
  if (!hits.length) return [];
  const shuffled = shuffleArray(hits);
  const urls = [];
  shuffled.forEach((hit) => {
    if (urls.length >= limit) return;
    const video = hit?.videos?.large || hit?.videos?.medium || hit?.videos?.small;
    if (video?.url) urls.push(video.url);
  });
  return urls;
}

export async function fetchPixabayVideo(query, apiKey) {
  const urls = await fetchPixabayVideos(query, apiKey, 1);
  return urls[0] || null;
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
  const assetCount = Math.max(1, Number(process.env.SCENE_ASSET_COUNT || "3"));
  const imageFallbackCount = Math.max(3, Number(process.env.IMAGE_FALLBACK_COUNT || "4"));

  for (let i = 0; i < parts.length; i += 1) {
    const text = parts[i]?.text || "";
    const keywords = extractKeywords(text, 5);
    const queries = buildQueryVariants(text);

    let videoUrls = [];
    for (const query of queries) {
      if (pexelsApiKey) {
        try {
          videoUrls = videoUrls.concat(await fetchPexelsVideos(query, pexelsApiKey, assetCount));
        } catch (err) {
          console.warn(`[stock] Pexels video search failed: ${err.message}`);
        }
      }
      if (videoUrls.length >= assetCount) break;
      if (pixabayApiKey) {
        try {
          videoUrls = videoUrls.concat(await fetchPixabayVideos(query, pixabayApiKey, assetCount));
        } catch (err) {
          console.warn(`[stock] Pixabay video search failed: ${err.message}`);
        }
      }
      if (videoUrls.length >= assetCount) break;
    }

    const uniqueVideos = Array.from(new Set(videoUrls)).slice(0, assetCount);
    if (uniqueVideos.length) {
      const paths = [];
      for (let j = 0; j < uniqueVideos.length; j += 1) {
        const filePath = await downloadAsset(uniqueVideos[j], tempDir, `stock-video-${i + 1}-${j + 1}.mp4`);
        await cacheAsset(filePath);
        paths.push(filePath);
      }
      scenes.push({ type: "video", paths, text, keywords, source: "stock" });
      continue;
    }

    if (enableImages && (pexelsApiKey || pixabayApiKey)) {
      try {
        let images = [];
        for (const query of queries) {
          if (pexelsApiKey) {
            images = images.concat(await fetchPexelsImages(query, pexelsApiKey));
          }
          if (images.length >= imageFallbackCount) break;
          if (pixabayApiKey) {
            images = images.concat(await fetchPixabayImages(query, pixabayApiKey));
          }
          if (images.length >= imageFallbackCount) break;
        }

        const selected = Array.from(new Set(images)).slice(0, imageFallbackCount);
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
