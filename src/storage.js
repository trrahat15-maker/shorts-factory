import fs from "fs/promises";
import path from "path";

const DATA_DIR = path.join(process.cwd(), "data");
const HISTORY_FILE = path.join(DATA_DIR, "history.json");
const CONFIG_FILE = path.join(DATA_DIR, "config.json");
const YOUTUBE_TOKENS_FILE = path.join(DATA_DIR, "youtube-tokens.json");

export async function ensureStorage(...paths) {
  for (const p of paths) {
    await fs.mkdir(p, { recursive: true });
  }
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    await fs.access(HISTORY_FILE);
  } catch {
    await fs.writeFile(HISTORY_FILE, JSON.stringify([], null, 2));
  }
  try {
    await fs.access(CONFIG_FILE);
  } catch {
    await fs.writeFile(CONFIG_FILE, JSON.stringify({
      defaultPrompt: "Write a 30 second motivational speech for YouTube Shorts. Hook the viewer in the first sentence. Use simple powerful language.",
      defaultVoice: "alloy",
      defaultTitle: "Daily Motivation",
      defaultDescription: "Daily motivational shorts.\n\nSubscribe for more success mindset content.\n\n#motivation #success #discipline",
      defaultTags: ["motivation", "success", "discipline"],
      videosPerDay: 1,
      uploadTime: "09:00",
      openaiModel: "gpt-4o-mini",
      openaiBaseUrl: "",
      autoMetadata: true,
      channelContext: "motivational shorts",
      analysisVideoCount: 30,
      musicVolume: 0.18,
      maxDuration: 0,
      subtitleStyle: {
        fontSize: 64,
        outline: 4
      }
    }, null, 2));
  }
  try {
    await fs.access(YOUTUBE_TOKENS_FILE);
  } catch {
    await fs.writeFile(YOUTUBE_TOKENS_FILE, JSON.stringify({}, null, 2));
  }
}

export async function getConfig() {
  try {
    const data = await fs.readFile(CONFIG_FILE, "utf8");
    return JSON.parse(data);
  } catch {
    return {};
  }
}

export async function setConfig(config) {
  await fs.writeFile(CONFIG_FILE, JSON.stringify(config, null, 2));
}

export async function getYoutubeTokens() {
  try {
    const data = await fs.readFile(YOUTUBE_TOKENS_FILE, "utf8");
    return JSON.parse(data);
  } catch {
    return {};
  }
}

export async function setYoutubeTokens(tokens) {
  await fs.writeFile(YOUTUBE_TOKENS_FILE, JSON.stringify(tokens, null, 2));
}

export async function listHistory() {
  try {
    const data = await fs.readFile(HISTORY_FILE, "utf8");
    return JSON.parse(data);
  } catch {
    return [];
  }
}

export async function appendHistory(item) {
  const history = await listHistory();
  history.unshift(item);
  await fs.writeFile(HISTORY_FILE, JSON.stringify(history, null, 2));
}
