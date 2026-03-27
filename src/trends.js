import { google } from "googleapis";

function stripTrendsPrefix(text) {
  const prefix = ")]}',";
  if (text.startsWith(prefix)) {
    return text.slice(prefix.length);
  }
  return text;
}

function normalizeTopic(text) {
  return String(text || "").trim().replace(/\s+/g, " ");
}

function rankTopics(topics, preferred = []) {
  const scores = new Map();
  topics.forEach((topic) => {
    const key = normalizeTopic(topic);
    if (!key) return;
    scores.set(key, (scores.get(key) || 0) + 1);
  });
  preferred.forEach((topic) => {
    const key = normalizeTopic(topic);
    if (!key) return;
    scores.set(key, (scores.get(key) || 0) + 2);
  });
  return Array.from(scores.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([topic]) => topic);
}

export async function fetchGoogleTrends({ region = "US", hl = "en-US", maxTopics = 15 } = {}) {
  const url = `https://trends.google.com/trends/api/dailytrends?hl=${encodeURIComponent(
    hl
  )}&geo=${encodeURIComponent(region)}&ns=15`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Google Trends ${response.status}`);
  }
  const text = await response.text();
  const data = JSON.parse(stripTrendsPrefix(text));
  const days = data?.default?.trendingSearchesDays || [];
  const topics = [];
  days.forEach((day) => {
    const searches = day?.trendingSearches || [];
    searches.forEach((item) => {
      const title = item?.title?.query;
      if (title) topics.push(title);
    });
  });
  const unique = Array.from(new Set(topics.map(normalizeTopic))).filter(Boolean);
  return unique.slice(0, maxTopics);
}

function parseIsoDuration(iso) {
  if (!iso) return null;
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return null;
  const hours = Number(match[1] || 0);
  const minutes = Number(match[2] || 0);
  const seconds = Number(match[3] || 0);
  return hours * 3600 + minutes * 60 + seconds;
}

export async function fetchYoutubeTrends({ region = "US", accessToken, maxTopics = 15 } = {}) {
  if (!accessToken) return [];
  const youtube = google.youtube("v3");
  const response = await youtube.videos.list({
    part: ["snippet", "contentDetails"],
    chart: "mostPopular",
    regionCode: region,
    maxResults: 25,
    access_token: accessToken,
  });
  const items = response?.data?.items || [];
  const topics = [];
  items.forEach((item) => {
    const duration = parseIsoDuration(item?.contentDetails?.duration);
    if (duration && duration > 90) return;
    const title = item?.snippet?.title;
    if (title) topics.push(title);
  });
  const unique = Array.from(new Set(topics.map(normalizeTopic))).filter(Boolean);
  return unique.slice(0, maxTopics);
}

export function buildRankedTopics({ trends = [], preferred = [] } = {}) {
  return rankTopics(trends, preferred);
}
