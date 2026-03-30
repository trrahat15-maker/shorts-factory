import { google } from "googleapis";

const STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "but", "for", "with", "without", "to", "of", "in", "on", "at",
  "how", "why", "what", "this", "that", "these", "those", "your", "you", "they", "we", "are",
  "is", "was", "be", "been", "from", "by", "about", "into", "over", "under", "top", "best",
  "shorts", "video", "videos", "short", "tips", "new", "2024", "2025", "2026"
]);

function normalizeKeyword(word) {
  return String(word || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

function extractKeywordsFromTitles(titles, limit = 25) {
  const counts = new Map();
  titles.forEach((title) => {
    String(title || "")
      .split(/\s+/)
      .map(normalizeKeyword)
      .filter((word) => word.length > 3 && !STOP_WORDS.has(word))
      .forEach((word) => {
        counts.set(word, (counts.get(word) || 0) + 1);
      });
  });
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([word]) => word);
}

export async function fetchCompetitorInsights({ accessToken, query, maxChannels = 5, maxVideosPerChannel = 5 }) {
  if (!accessToken || !query) return { channels: [], topics: [] };
  const youtube = google.youtube("v3");

  const searchRes = await youtube.search.list({
    part: ["snippet"],
    q: query,
    type: ["channel"],
    maxResults: Math.min(25, maxChannels),
    access_token: accessToken,
  });

  const channels = (searchRes?.data?.items || [])
    .map((item) => ({
      id: item?.id?.channelId,
      title: item?.snippet?.channelTitle || item?.snippet?.title || "",
    }))
    .filter((item) => item.id);

  const titles = [];
  for (const channel of channels.slice(0, maxChannels)) {
    const videosRes = await youtube.search.list({
      part: ["snippet"],
      channelId: channel.id,
      type: ["video"],
      order: "viewCount",
      maxResults: Math.min(25, maxVideosPerChannel),
      access_token: accessToken,
    });
    const items = videosRes?.data?.items || [];
    items.forEach((item) => {
      const title = item?.snippet?.title;
      if (title) titles.push(title);
    });
  }

  const topics = extractKeywordsFromTitles(titles, 30);
  return { channels, topics, titles };
}
