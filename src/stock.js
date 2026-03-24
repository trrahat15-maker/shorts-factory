import fs from "fs/promises";
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

export async function fetchStockScenes({ parts, pexelsApiKey, enableImages, tempDir }) {
  if (!parts.length) return [];
  await fs.mkdir(tempDir, { recursive: true });

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

    if (videoUrl) {
      const filePath = await downloadAsset(videoUrl, tempDir, `stock-video-${i + 1}.mp4`);
      scenes.push({ type: "video", path: filePath, text, keywords });
      continue;
    }

    if (enableImages && pexelsApiKey) {
      try {
        const images = await fetchPexelsImages(query, pexelsApiKey);
        const selected = images.slice(0, 5);
        if (selected.length) {
          const paths = [];
          for (let j = 0; j < selected.length; j += 1) {
            const imagePath = await downloadAsset(
              selected[j],
              tempDir,
              `stock-image-${i + 1}-${j + 1}.jpg`
            );
            paths.push(imagePath);
          }
          scenes.push({ type: "images", paths, text, keywords });
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
