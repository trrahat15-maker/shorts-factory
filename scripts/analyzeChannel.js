import fs from "fs/promises";
import OpenAI from "openai";
import { google } from "googleapis";

const log = (message) => console.log(`[analyze] ${message}`);

const REQUIRED_ENV = [
  "OPENAI_API_KEY",
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

function sanitizeKey(raw) {
  const trimmed = String(raw || "").replace(/\s+/g, "");
  const match = trimmed.match(/sk-[A-Za-z0-9_-]{20,}/);
  return match ? match[0] : trimmed;
}

function sanitizeBaseUrl(raw) {
  const trimmed = String(raw || "").replace(/\s+/g, "");
  const match = trimmed.match(/https?:\/\/[^\s]+/);
  return match ? match[0] : trimmed;
}

function parseDuration(iso) {
  if (!iso) return 0;
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return 0;
  const hours = Number(match[1] || 0);
  const minutes = Number(match[2] || 0);
  const seconds = Number(match[3] || 0);
  return hours * 3600 + minutes * 60 + seconds;
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

async function fetchChannel(youtube, channelId) {
  const params = channelId
    ? { part: ["snippet", "statistics", "contentDetails"], id: [channelId] }
    : { part: ["snippet", "statistics", "contentDetails"], mine: true };
  const res = await youtube.channels.list(params);
  const channel = res.data?.items?.[0];
  if (!channel) {
    throw new Error("Channel not found for the provided credentials.");
  }
  return channel;
}

async function fetchUploads(youtube, uploadsPlaylistId, maxResults) {
  const items = [];
  let pageToken = "";
  while (items.length < maxResults) {
    const res = await youtube.playlistItems.list({
      part: ["snippet", "contentDetails"],
      playlistId: uploadsPlaylistId,
      maxResults: Math.min(50, maxResults - items.length),
      pageToken: pageToken || undefined,
    });
    const batch = res.data?.items || [];
    items.push(...batch);
    pageToken = res.data?.nextPageToken || "";
    if (!pageToken) break;
  }
  return items;
}

async function fetchVideos(youtube, videoIds) {
  const results = [];
  const ids = [...videoIds];
  while (ids.length) {
    const chunk = ids.splice(0, 50);
    const res = await youtube.videos.list({
      part: ["snippet", "statistics", "contentDetails"],
      id: chunk,
    });
    results.push(...(res.data?.items || []));
  }
  return results;
}

function summarizeVideos(videos) {
  const normalized = videos
    .map((video) => {
      const stats = video.statistics || {};
      const duration = parseDuration(video.contentDetails?.duration);
      return {
        id: video.id,
        title: video.snippet?.title || "",
        publishedAt: video.snippet?.publishedAt || "",
        views: Number(stats.viewCount || 0),
        likes: Number(stats.likeCount || 0),
        comments: Number(stats.commentCount || 0),
        duration,
        isShort: duration > 0 && duration <= 60,
      };
    })
    .filter((video) => video.id);

  const byViews = [...normalized].sort((a, b) => b.views - a.views);
  const byDate = [...normalized].sort(
    (a, b) => new Date(b.publishedAt) - new Date(a.publishedAt)
  );
  const shorts = normalized.filter((video) => video.isShort);
  const longForm = normalized.filter((video) => !video.isShort);

  const avg = (list, key) =>
    list.length ? list.reduce((acc, item) => acc + item[key], 0) / list.length : 0;

  return {
    totalVideosAnalyzed: normalized.length,
    shortsCount: shorts.length,
    longCount: longForm.length,
    averageViews: Math.round(avg(normalized, "views")),
    averageShortViews: Math.round(avg(shorts, "views")),
    averageLongViews: Math.round(avg(longForm, "views")),
    topVideos: byViews.slice(0, 5),
    recentVideos: byDate.slice(0, 10),
  };
}

async function run() {
  requireEnv();

  const apiKey = sanitizeKey(getEnv("OPENAI_API_KEY"));
  const baseUrl = sanitizeBaseUrl(getEnv("OPENAI_BASE_URL"));
  const model = getEnv("OPENAI_MODEL", "gpt-4o-mini").trim();
  const channelId = getEnv("CHANNEL_ID", "").trim();
  const channelContext = getEnv("CHANNEL_CONTEXT", "motivational shorts").trim();
  const maxVideos = Number(getEnv("ANALYSIS_VIDEO_COUNT", "30")) || 30;
  const outputPath = getEnv("ANALYSIS_OUTPUT", "analysis.md");

  const accessToken = await getAccessToken();
  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials({ access_token: accessToken });
  const youtube = google.youtube({ version: "v3", auth: oauth2Client });

  log("Fetching channel data");
  const channel = await fetchChannel(youtube, channelId || undefined);
  const uploadsPlaylistId = channel.contentDetails?.relatedPlaylists?.uploads;
  if (!uploadsPlaylistId) {
    throw new Error("Uploads playlist not found.");
  }

  log("Fetching recent uploads");
  const uploads = await fetchUploads(youtube, uploadsPlaylistId, maxVideos);
  const videoIds = uploads.map((item) => item.contentDetails?.videoId).filter(Boolean);
  const videos = await fetchVideos(youtube, videoIds);

  const summary = summarizeVideos(videos);
  const channelSummary = {
    id: channel.id,
    title: channel.snippet?.title || "",
    description: channel.snippet?.description || "",
    createdAt: channel.snippet?.publishedAt || "",
    subscriberCount: Number(channel.statistics?.subscriberCount || 0),
    viewCount: Number(channel.statistics?.viewCount || 0),
    videoCount: Number(channel.statistics?.videoCount || 0),
  };

  const payload = {
    channel: channelSummary,
    summary,
    recentVideos: summary.recentVideos,
    topVideos: summary.topVideos,
    channelContext,
  };

  log("Generating AI analysis");
  const client = new OpenAI({
    apiKey,
    baseURL: baseUrl || undefined,
  });

  const prompt = `Analyze this YouTube channel and produce a concise growth plan.
Return a clear report with sections:
1) Channel positioning
2) What is working
3) What to fix immediately
4) 10 specific Shorts ideas (titles)
5) Hook templates (5)
6) SEO improvements (titles, tags, description patterns)
7) Upload cadence recommendation

Channel data:
${JSON.stringify(payload, null, 2)}`;

  const response = await client.chat.completions.create({
    model,
    messages: [
      { role: "system", content: "You are a YouTube growth strategist focused on Shorts." },
      { role: "user", content: prompt },
    ],
    max_tokens: 900,
  });

  const output = response.choices?.[0]?.message?.content?.trim();
  if (!output) {
    throw new Error("OpenAI returned no analysis text.");
  }

  const report = `# Channel Analysis\n\n${output}\n`;
  await fs.writeFile(outputPath, report, "utf8");
  log(`Analysis saved to ${outputPath}`);
  console.log("\n" + report);
}

run().catch((err) => {
  console.error("[analyze] Fatal error:", err);
  process.exit(1);
});
