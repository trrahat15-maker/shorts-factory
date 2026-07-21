/**
 * OPTIMIZER ENGINE - Best Time, Best Title, Best Hashtags
 * Learns from your channel performance data
 */

import fs from "fs/promises";
import path from "path";

const OPTIMIZER_DATA_DIR = path.join(process.cwd(), "data", "optimizer");
const PERFORMANCE_FILE = path.join(OPTIMIZER_DATA_DIR, "performance.json");
const BEST_TIME_FILE = path.join(OPTIMIZER_DATA_DIR, "best-times.json");
const TITLE_SCORES_FILE = path.join(OPTIMIZER_DATA_DIR, "title-scores.json");
const HASHTAG_SCORES_FILE = path.join(OPTIMIZER_DATA_DIR, "hashtag-scores.json");

async function ensureDir() {
  await fs.mkdir(OPTIMIZER_DATA_DIR, { recursive: true });
}

async function loadJSON(filePath, defaultValue = {}) {
  try {
    const data = await fs.readFile(filePath, "utf8");
    return JSON.parse(data);
  } catch {
    return defaultValue;
  }
}

async function saveJSON(filePath, data) {
  await ensureDir();
  await fs.writeFile(filePath, JSON.stringify(data, null, 2));
}

/**
 * Analyze best upload times based on past video performance
 */
export async function analyzeBestUploadTimes({
  videos = [],
  timeZone = "UTC",
} = {}) {
  if (!videos.length) return null;

  const hourBuckets = {};
  const dayBuckets = {};
  const hourDayBuckets = {};

  videos.forEach((video) => {
    const publishedAt = video.publishedAt || video.snippet?.publishedAt;
    if (!publishedAt) return;

    const date = new Date(publishedAt);
    const hour = date.getUTCHours();
    const day = date.getUTCDay();
    const views = Number(video.statistics?.viewCount || video.views || 0);
    const likes = Number(video.statistics?.likeCount || video.likes || 0);
    const comments = Number(video.statistics?.commentCount || video.comments || 0);
    const ageHours = Math.max(1, (Date.now() - date.getTime()) / 3600000);
    const engagementRate = views > 0 ? (likes + comments * 3) / views : 0;
    const score = (views / ageHours) * (1 + engagementRate * 2);

    // Hour buckets
    if (!hourBuckets[hour]) hourBuckets[hour] = { sum: 0, count: 0, totalViews: 0, totalEngagement: 0 };
    hourBuckets[hour].sum += score;
    hourBuckets[hour].count += 1;
    hourBuckets[hour].totalViews += views;
    hourBuckets[hour].totalEngagement += likes + comments * 3;

    // Day buckets
    if (!dayBuckets[day]) dayBuckets[day] = { sum: 0, count: 0, totalViews: 0 };
    dayBuckets[day].sum += score;
    dayBuckets[day].count += 1;
    dayBuckets[day].totalViews += views;

    // Hour+Day buckets
    const key = `${day}-${hour}`;
    if (!hourDayBuckets[key]) hourDayBuckets[key] = { sum: 0, count: 0, totalViews: 0 };
    hourDayBuckets[key].sum += score;
    hourDayBuckets[key].count += 1;
    hourDayBuckets[key].totalViews += views;
  });

  // Find best hour
  let bestHour = -1;
  let bestHourScore = -1;
  for (let h = 0; h < 24; h++) {
    const bucket = hourBuckets[h];
    if (bucket && bucket.count >= 2) {
      const avg = bucket.sum / bucket.count;
      if (avg > bestHourScore) {
        bestHourScore = avg;
        bestHour = h;
      }
    }
  }

  // Find best day
  const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  let bestDay = -1;
  let bestDayScore = -1;
  for (let d = 0; d < 7; d++) {
    const bucket = dayBuckets[d];
    if (bucket && bucket.count >= 2) {
      const avg = bucket.sum / bucket.count;
      if (avg > bestDayScore) {
        bestDayScore = avg;
        bestDay = d;
      }
    }
  }

  // Build rank
  const hourRanking = Object.entries(hourBuckets)
    .map(([hour, data]) => ({
      hour: Number(hour),
      score: data.sum / data.count,
      avgViews: Math.round(data.totalViews / data.count),
      sampleSize: data.count,
    }))
    .sort((a, b) => b.score - a.score);

  const topHours = hourRanking.slice(0, 5).map((h) => ({
    time: `${String(h.hour).padStart(2, "0")}:00`,
    hour: h.hour,
    score: h.score,
    avgViews: h.avgViews,
    confidence: h.sampleSize > 10 ? "high" : h.sampleSize > 4 ? "medium" : "low",
  }));

  const result = {
    bestHour: bestHour >= 0 ? bestHour : 8,
    bestHourLabel: bestHour >= 0 ? `${String(bestHour).padStart(2, "0")}:00` : "08:00",
    bestDay: bestDay >= 0 ? bestDay : 1,
    bestDayName: bestDay >= 0 ? dayNames[bestDay] : "Monday",
    hourRanking,
    topHours,
    hourBuckets,
    dayBuckets,
    timeZone,
    sampleSize: videos.length,
    lastAnalyzed: new Date().toISOString(),
  };

  // Cache to file
  await saveJSON(BEST_TIME_FILE, result);
  return result;
}

/**
 * Score a title based on historical performance data and viral patterns
 */
export function scoreTitle(title, historicalTitles = []) {
  const lower = title.toLowerCase();
  let score = 0;

  // Pattern: Best title length is 30-70 characters
  const len = title.length;
  if (len >= 30 && len <= 70) score += 3;
  else if (len >= 20 && len <= 90) score += 1;

  // Pattern: Numbers in title boost CTR
  if (/\d/.test(lower)) score += 2;

  // Pattern: Curiosity gap creators
  const curiosityTriggers = [
    "this", "these", "why", "how", "secret", "hidden", "truth",
    "actually", "really", "everyone", "nobody", "stop", "start",
  ];
  curiosityTriggers.forEach((trigger) => {
    if (lower.includes(trigger)) score += 1;
  });

  // Pattern: Emotional hooks
  const emotionalTriggers = [
    "shocking", "crazy", "unbelievable", "incredible", "amazing",
    "worst", "best", "biggest", "greatest", "powerful",
  ];
  emotionalTriggers.forEach((trigger) => {
    if (lower.includes(trigger)) score += 1;
  });

  // Pattern: Question formats (high engagement)
  if (lower.includes("?")) score += 2;
  if (lower.includes("!")) score += 1;

  // Pattern: Personal pronouns
  if (/\b(you|your|i|my|we|our)\b/.test(lower)) score += 1;

  // Pattern: Negative framing
  const negativeFraming = [
    "stop", "never", "avoid", "don't", "quit", "worst", "mistake",
  ];
  negativeFraming.forEach((trigger) => {
    if (lower.startsWith(trigger)) score += 2;
  });

  // Pattern: How-to (educational)
  if (lower.startsWith("how to")) score += 2;

  // Historical comparison: if similar titles performed well
  if (historicalTitles.length > 0) {
    const similar = historicalTitles.filter((ht) => {
      const htLower = ht.title.toLowerCase();
      const sharedWords = htLower.split(/\s+/).filter((w) => lower.includes(w));
      return sharedWords.length >= 2;
    });

    if (similar.length > 0) {
      const avgViews = similar.reduce((sum, t) => sum + (t.views || 0), 0) / similar.length;
      score += Math.min(5, Math.log10(avgViews + 1) * 0.5);
    }
  }

  return Math.round(score * 10) / 10;
}

/**
 * Pick the best title from generated options
 */
export function pickBestTitle(titles, historicalTitles = []) {
  if (!titles.length) return "";
  const scored = titles.map((title) => ({
    title,
    score: scoreTitle(title, historicalTitles),
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored[0].title;
}

/**
 * Optimize tags based on performance data
 */
export function optimizeTags(tags, historicalTags = {}) {
  const tagPerformance = historicalTags.tags || {};

  // Add high-performing tags
  const highPerf = Object.entries(tagPerformance)
    .filter(([, data]) => data.avgViews > 100 && data.engagement > 0.05)
    .sort((a, b) => b[1].avgViews - a[1].avgViews);

  const optimized = new Set(tags.map((t) => t.toLowerCase()));

  // Add proven tags (up to limit)
  highPerf.slice(0, 10).forEach(([tag]) => {
    optimized.add(tag.toLowerCase());
  });

  return Array.from(optimized).slice(0, 30);
}

/**
 * Record video performance for learning
 */
export async function recordPerformance({
  videoId,
  title,
  tags,
  publishedAt,
  views,
  likes,
  comments,
  shorts = true,
} = {}) {
  await ensureDir();

  const performance = await loadJSON(PERFORMANCE_FILE);
  const videoData = {
    videoId,
    title,
    tags: Array.isArray(tags) ? tags : [],
    publishedAt,
    views: Number(views) || 0,
    likes: Number(likes) || 0,
    comments: Number(comments) || 0,
    shorts,
    recordedAt: new Date().toISOString(),
  };

  performance[videoId] = videoData;
  await saveJSON(PERFORMANCE_FILE, performance);

  // Update title scores
  const titleScores = await loadJSON(TITLE_SCORES_FILE);
  const words = (title || "").split(/\s+/).filter(Boolean);
  const engagement = views > 0 ? (likes + comments * 3) / views : 0;

  words.forEach((word) => {
    const lower = word.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (lower.length < 3) return;
    if (!titleScores[lower]) {
      titleScores[lower] = { sum: 0, count: 0 };
    }
    titleScores[lower].sum += views * (1 + engagement);
    titleScores[lower].count += 1;
  });
  await saveJSON(TITLE_SCORES_FILE, titleScores);

  // Update hashtag scores
  const hashtagScores = await loadJSON(HASHTAG_SCORES_FILE);
  (tags || []).forEach((tag) => {
    const clean = tag.replace(/^#/, "").toLowerCase();
    if (!hashtagScores[clean]) {
      hashtagScores[clean] = { sum: 0, count: 0 };
    }
    hashtagScores[clean].sum += views * (1 + engagement);
    hashtagScores[clean].count += 1;
  });
  await saveJSON(HASHTAG_SCORES_FILE, hashtagScores);

  return videoData;
}

/**
 * Get the best time to upload today
 */
export function getBestUploadTime(timeZone = "UTC") {
  const now = new Date();
  const currentHour = now.getUTCHours();
  const currentDay = now.getUTCDay();

  // Prime time windows (YouTube Shorts peak engagement)
  const primeWindows = [
    { hour: 7, weight: 0.9, label: "Morning commute" },
    { hour: 8, weight: 0.95, label: "Morning peak" },
    { hour: 9, weight: 0.85, label: "Late morning" },
    { hour: 12, weight: 0.8, label: "Lunch break" },
    { hour: 17, weight: 0.85, label: "After work" },
    { hour: 18, weight: 0.9, label: "Evening prime" },
    { hour: 19, weight: 1.0, label: "Peak evening" },
    { hour: 20, weight: 0.95, label: "Late evening" },
    { hour: 21, weight: 0.8, label: "Night browsing" },
  ];

  // Day multipliers
  const dayMultipliers = {
    0: 0.7,  // Sunday - lower
    1: 1.0,  // Monday - peak
    2: 0.95, // Tuesday
    3: 0.9,  // Wednesday
    4: 0.95, // Thursday
    5: 1.0,  // Friday - peak
    6: 0.85, // Saturday
  };

  const dayMultiplier = dayMultipliers[currentDay] || 0.9;

  // Find nearest prime window
  const sortedWindows = [...primeWindows].sort((a, b) => {
    const distA = Math.abs(a.hour - currentHour);
    const distB = Math.abs(b.hour - currentHour);
    return distA - distB;
  });

  // Pick the best upcoming window (not past)
  const upcoming = primeWindows.filter((w) => w.hour > currentHour);
  const bestWindow = upcoming.length > 0
    ? upcoming.reduce((best, w) => (w.weight > best.weight ? w : best))
    : primeWindows[0]; // If all past, pick the best for tomorrow

  // Calculate next occurrence
  const nextUpload = new Date(now);
  if (bestWindow.hour <= currentHour) {
    // Tomorrow
    nextUpload.setDate(nextUpload.getDate() + 1);
  }
  nextUpload.setHours(bestWindow.hour, 15, 0, 0); // :15 for slight randomization

  return {
    recommendedHour: bestWindow.hour,
    recommendedTime: `${String(bestWindow.hour).padStart(2, "0")}:15`,
    label: bestWindow.label,
    dayScore: dayMultiplier,
    timeWindowScore: bestWindow.weight,
    totalScore: Math.round(dayMultiplier * bestWindow.weight * 100) / 100,
    nextUploadAt: nextUpload.toISOString(),
    timeZone,
    reasoning: `${bestWindow.label} on day ${currentDay} (multiplier: ${dayMultiplier})`,
  };
}

/**
 * Get historical tag performance
 */
export async function getTagPerformance({ minViews = 50 } = {}) {
  const performance = await loadJSON(PERFORMANCE_FILE);
  const tagStats = {};

  Object.values(performance).forEach((video) => {
    const tags = video.tags || [];
    const views = video.views || 0;
    const engagement = views > 0 ? (video.likes + video.comments * 3) / views : 0;

    tags.forEach((tag) => {
      const clean = tag.replace(/^#/, "").toLowerCase();
      if (!tagStats[clean]) {
        tagStats[clean] = { totalViews: 0, totalEngagement: 0, count: 0 };
      }
      tagStats[clean].totalViews += views;
      tagStats[clean].totalEngagement += engagement;
      tagStats[clean].count += 1;
    });
  });

  return Object.entries(tagStats)
    .filter(([, data]) => data.totalViews >= minViews)
    .map(([tag, data]) => ({
      tag,
      avgViews: Math.round(data.totalViews / data.count),
      engagement: Math.round(data.totalEngagement / data.count * 100) / 100,
      uses: data.count,
      score: Math.round((data.totalViews / data.count) * (1 + data.totalEngagement / data.count)),
    }))
    .sort((a, b) => b.score - a.score);
}

/**
 * Generate the perfect title given a topic
 */
export function generateOptimizedTitle(topic, historicalTitles = []) {
  if (!topic) return "Daily Motivation";

  const patterns = [
    // How-to format
    (t) => `How to ${t.toLowerCase().replace(/^(how to )?/i, "")}`,
    // Numbered list
    (t) => {
      const num = Math.floor(Math.random() * 5) + 3;
      return `${num} ${t} Secrets Nobody Tells You`;
    },
    // Curiosity gap
    (t) => `The Real Reason ${t.toLowerCase().replace(/^(the real reason )?/i, "You're Not Succeeding")}`,
    // Emotional trigger
    (t) => `Stop ${t.includes("ing") ? t : t + "ing"} - Do This Instead`,
    // Question
    (t) => `Why ${t} Changes Everything`,
    // Direct address
    (t) => `${t} - Here's What You Need To Know`,
    // Negative hook
    (t) => `The #1 Mistake in ${t} (And How To Fix It)`,
    // Power word opening
    (t) => `Powerful ${t} Advice That Actually Works`,
    // Before/After
    (t) => `What Happens When You ${t.toLowerCase().replace(/^(what happens when you )?/i, "Start Doing This")}`,
    // Simple statement
    (t) => t,
  ];

  const candidates = patterns.map((fn) => {
    try {
      const title = fn(topic);
      return title.length <= 100 ? title : title.slice(0, 97) + "...";
    } catch {
      return topic;
    }
  }).filter(Boolean);

  const unique = Array.from(new Set(candidates));
  return pickBestTitle(unique, historicalTitles);
}

export {
  loadJSON,
  saveJSON,
  OPTIMIZER_DATA_DIR,
  PERFORMANCE_FILE,
  BEST_TIME_FILE,
  TITLE_SCORES_FILE,
  HASHTAG_SCORES_FILE,
};