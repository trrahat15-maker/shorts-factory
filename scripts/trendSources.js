/**
 * FREE Trend Sources - Multiple sources for finding trending content
 * No API keys required for most sources
 */

const TRENDING_CACHE = new Map();
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

function getCached(key) {
  const entry = TRENDING_CACHE.get(key);
  if (entry && Date.now() - entry.ts < CACHE_TTL) return entry.data;
  return null;
}

function setCache(key, data) {
  TRENDING_CACHE.set(key, { data, ts: Date.now() });
}

/**
 * Fetch trending topics from Reddit (completely free, no API key needed)
 */
export async function fetchRedditTrends({
  subreddits = ["popular", "videos", "trendingsubreddits", "Shorts"],
  limit = 5,
  timeFilter = "day",
} = {}) {
  const cacheKey = `reddit-${subreddits.join("-")}-${limit}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const topics = [];
  for (const sub of subreddits) {
    try {
      const url = `https://www.reddit.com/r/${sub}/hot.json?limit=${limit}&t=${timeFilter}`;
      const res = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; ShortsFactory/1.0)",
          Accept: "application/json",
        },
      });
      if (!res.ok) continue;
      const data = await res.json();
      const posts = data?.data?.children || [];
      posts.forEach((post) => {
        const title = post?.data?.title || "";
        const ups = post?.data?.ups || 0;
        const numComments = post?.data?.num_comments || 0;
        if (title && ups > 10) {
          topics.push({
            title,
            source: `r/${sub}`,
            score: ups + numComments * 2,
          });
        }
      });
    } catch (err) {
      // Silently fail for individual subreddits
    }
  }

  // Sort by engagement score
  topics.sort((a, b) => b.score - a.score);
  const result = topics.slice(0, limit * 3).map((t) => t.title);
  setCache(cacheKey, result);
  return result;
}

/**
 * Fetch trending topics from HackerNews (completely free)
 */
export async function fetchHackerNewsTrends({ limit = 10 } = {}) {
  const cacheKey = `hackernews-${limit}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  try {
    const res = await fetch("https://hacker-news.firebaseio.com/v0/topstories.json");
    if (!res.ok) return [];
    const ids = await res.json();
    const topIds = ids.slice(0, limit * 2);
    const stories = await Promise.all(
      topIds.map(async (id) => {
        try {
          const storyRes = await fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`);
          if (!storyRes.ok) return null;
          return storyRes.json();
        } catch {
          return null;
        }
      })
    );

    const topics = stories
      .filter((story) => story?.title && story?.score > 5)
      .sort((a, b) => (b.score || 0) - (a.score || 0))
      .slice(0, limit)
      .map((story) => story.title);

    setCache(cacheKey, topics);
    return topics;
  } catch {
    return [];
  }
}

/**
 * Fetch trending news from NewsAPI (free tier: 100 req/day)
 */
export async function fetchNewsTrends({
  apiKey = "",
  category = "technology",
  country = "us",
  limit = 10,
} = {}) {
  const cacheKey = `news-${category}-${country}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  if (!apiKey) return [];

  try {
    const url = `https://newsapi.org/v2/top-headlines?country=${country}&category=${category}&pageSize=${limit}`;
    const res = await fetch(url, { headers: { "X-Api-Key": apiKey } });
    if (!res.ok) return [];
    const data = await res.json();
    const articles = data?.articles || [];
    const topics = articles
      .filter((a) => a?.title && a?.description)
      .map((a) => a.title);

    setCache(cacheKey, topics);
    return topics;
  } catch {
    return [];
  }
}

/**
 * Generate topic variations from a base topic
 */
export function expandTrendTopics(topics, maxExpanded = 20) {
  const expansions = {
    motivation: [
      "morning motivation", "success mindset", "discipline", "focus",
      "daily motivation", "inspirational speech", "never give up",
      "hustle culture", "grind mindset", "mental toughness",
    ],
    success: [
      "wealth mindset", "financial freedom", "business tips",
      "entrepreneur mindset", "millionaire habits", "success habits",
      "smart money", "investing tips", "side hustle", "passive income",
    ],
    productivity: [
      "time management", "deep focus", "study tips", "work smart",
      "efficiency hacks", "morning routine", "habit stacking",
      "getting things done", "focus music", "flow state",
    ],
    fitness: [
      "gym motivation", "workout tips", "body transformation",
      "weight loss journey", "healthy habits", "nutrition tips",
      "home workout", "muscle building", "cardio", "flexibility",
    ],
    money: [
      "save money tips", "budgeting", "frugal living",
      "investment basics", "crypto", "real estate",
      "make money online", "freelancing", "passive income ideas",
    ],
    mindset: [
      "positive thinking", "growth mindset", "stoicism",
      "meditation", "self improvement", "confidence building",
      "overcome fear", "daily habits", "mental health",
      "emotional intelligence",
    ],
    "life lessons": [
      "wisdom", "life advice", "philosophy", "psychology facts",
      "human behavior", "relationship advice", "career advice",
      "student tips", "life hacks", "survival skills",
    ],
  };

  const result = new Set();

  topics.forEach((topic) => {
    result.add(topic);
    const lower = topic.toLowerCase();
    // Add expansions
    for (const [key, values] of Object.entries(expansions)) {
      if (lower.includes(key)) {
        values.forEach((v) => result.add(v));
      }
    }
  });

  return Array.from(result).slice(0, maxExpanded);
}

/**
 * Score topics by viral potential
 */
export function scoreTopicViralPotential(topics, channelContext = "") {
  const viralTriggers = [
    "secret", "nobody", "everyone", "stop", "start", "why", "how",
    "never", "always", "worst", "best", "shocking", "crazy",
    "unbelievable", "changed my life", "game changer", "life hack",
    "you need to", "must watch", "important", "hidden", "truth",
    "exposed", "revealed", "warning", "mistake", "error",
    "guaranteed", "simple", "easy", "powerful", "effective",
  ];

  const scored = topics.map((topic) => {
    const lower = topic.toLowerCase();
    let score = 0;

    // Base score from length (medium length titles perform better)
    const words = lower.split(/\s+/).filter(Boolean);
    if (words.length >= 3 && words.length <= 8) score += 2;

    // Viral trigger words
    viralTriggers.forEach((trigger) => {
      if (lower.includes(trigger)) score += 1;
    });

    // Numbers in title
    if (/\d/.test(lower)) score += 1;

    // Question or exclamation
    if (/[?!]/.test(lower)) score += 1;

    // Channel context match
    if (channelContext && lower.includes(channelContext.toLowerCase().split(" ")[0])) {
      score += 2;
    }

    // Emotional words
    const emotionalWords = ["love", "hate", "fear", "happy", "sad", "angry", "shock", "surprise"];
    emotionalWords.forEach((word) => {
      if (lower.includes(word)) score += 1;
    });

    return { topic, score, words: words.length };
  });

  return scored.sort((a, b) => b.score - a.score);
}

/**
 * Fetch RSS feed trends from free sources
 */
export async function fetchRSSTrends({ limit = 10 } = {}) {
  const cacheKey = `rss-${limit}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const rssFeeds = [
    "https://feeds.feedburner.com/tedtalks_headlines",
    "https://www.psychologytoday.com/us/front/feed",
    "https://lifehacker.com/rss",
    "https://feeds.content.dowjones.io/public/rss/mw_topstories",
  ];

  const topics = [];

  for (const feedUrl of rssFeeds) {
    try {
      const res = await fetch(feedUrl, {
        headers: { "User-Agent": "Mozilla/5.0" },
      });
      if (!res.ok) continue;
      const text = await res.text();

      // Simple XML title extraction (no parser needed)
      const titleMatches = text.match(/<title[^>]*>([^<]+)<\/title>/gi) || [];
      titleMatches.slice(1, 6).forEach((match) => {
        const title = match.replace(/<\/?title[^>]*>/gi, "").trim();
        if (title && title.length > 10 && title.length < 200) {
          topics.push(title);
        }
      });
    } catch {
      // Silently fail
    }
  }

  setCache(cacheKey, topics.slice(0, limit));
  return topics.slice(0, limit);
}

/**
 * Get trending hashtags for a topic (free method)
 */
export async function fetchTrendingHashtags({
  topic = "",
  niche = "motivation",
  limit = 20,
} = {}) {
  const cacheKey = `hashtags-${topic || niche}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  // Base hashtags by niche
  const nicheHashtags = {
    motivation: [
      "#motivation", "#success", "#mindset", "#inspiration", "#hustle",
      "#discipline", "#goals", "#focus", "#grind", "#successmindset",
      "#positivity", "#dreambig", "#workhard", "#nevergiveup", "#believe",
      "#motivational", "#inspirational", "#dailyinspiration", "#lifecoach", "#mindfulness",
    ],
    fitness: [
      "#fitness", "#gym", "#workout", "#health", "#training",
      "#bodybuilding", "#fitfam", "#exercise", "#gymlife", "#fitnessmotivation",
      "#getfit", "#cardio", "#muscle", "#transformation", "#healthylifestyle",
    ],
    money: [
      "#money", "#wealth", "#finance", "#investing", "#financialfreedom",
      "#passiveincome", "#entrepreneur", "#business", "#success", "#millionaire",
      "#crypto", "#trading", "#realestate", "#savingmoney", "#moneymindset",
    ],
    productivity: [
      "#productivity", "#timemanagement", "#efficiency", "#organization", "#focus",
      "#goalsetting", "#planning", "#deepwork", "#getitdone", "#studytips",
      "#workflow", "#hustle", "#routine", "#habits", "#selfimprovement",
    ],
    default: [
      "#shorts", "#viral", "#trending", "#fyp", "#explorepage",
      "#contentcreator", "#growth", "#tips", "#lifehacks", "#advice",
    ],
  };

  const relevantHashtags = [];
  const lowerTopic = (topic || "").toLowerCase();

  // Add niche-specific hashtags
  for (const [key, tags] of Object.entries(nicheHashtags)) {
    if (lowerTopic.includes(key)) {
      relevantHashtags.push(...tags);
    }
  }

  // Always add default
  relevantHashtags.push(...nicheHashtags.default);

  // Deduplicate
  const unique = Array.from(new Set(relevantHashtags));

  // Generate topic-specific hashtags
  if (topic) {
    const words = topic.split(/\s+/).filter((w) => w.length > 2);
    words.forEach((word) => {
      const hashtag = `#${word.replace(/[^a-zA-Z0-9]/g, "").toLowerCase()}`;
      if (hashtag.length > 2 && !unique.includes(hashtag)) {
        unique.push(hashtag);
      }
    });
  }

  const result = unique.slice(0, limit);
  setCache(cacheKey, result);
  return result;
}