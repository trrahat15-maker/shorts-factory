import OpenAI from "openai";
import { google } from "googleapis";

function parseDuration(iso) {
  if (!iso) return 0;
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return 0;
  const hours = Number(match[1] || 0);
  const minutes = Number(match[2] || 0);
  const seconds = Number(match[3] || 0);
  return hours * 3600 + minutes * 60 + seconds;
}

async function fetchChannel(youtube, channelId) {
  const params = channelId
    ? { part: ["snippet", "statistics", "contentDetails"], id: [channelId] }
    : { part: ["snippet", "statistics", "contentDetails"], mine: true };
  const res = await youtube.channels.list(params);
  const channel = res.data?.items?.[0];
  if (!channel) {
    throw new Error("Channel not found. Check channel ID or YouTube connection.");
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

export async function analyzeChannel({
  accessToken,
  channelId,
  maxVideos = 30,
  openaiKey,
  baseUrl,
  model,
  channelContext,
}) {
  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials({ access_token: accessToken });
  const youtube = google.youtube({ version: "v3", auth: oauth2Client });

  const channel = await fetchChannel(youtube, channelId || undefined);
  const uploadsPlaylistId = channel.contentDetails?.relatedPlaylists?.uploads;
  if (!uploadsPlaylistId) {
    throw new Error("Uploads playlist not found for this channel.");
  }

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
    channelContext: channelContext || "motivational shorts",
  };

  const client = new OpenAI({
    apiKey: sanitizeKey(openaiKey),
    baseURL: sanitizeBaseUrl(baseUrl) || undefined,
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
    model: model || "gpt-4o-mini",
    messages: [
      { role: "system", content: "You are a YouTube growth strategist focused on Shorts." },
      { role: "user", content: prompt },
    ],
    max_tokens: 900,
  });

  const report = response.choices?.[0]?.message?.content?.trim();
  if (!report) {
    throw new Error("OpenAI returned no analysis text.");
  }

  return { report, channel: channelSummary, summary };
}
