import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import multer from "multer";
import fs from "fs/promises";

import { generateMetadata, generateScript } from "./src/openai.js";
import { generateVoice } from "./src/voice.js";
import { generateVideo } from "./src/video.js";
import { analyzeChannel } from "./src/channelAnalysis.js";
import {
  refreshYoutubeAccessToken,
  youtubeAuthUrl,
  handleYoutubeCallback,
  uploadToYoutube,
} from "./src/youtube.js";
import {
  ensureStorage,
  listHistory,
  appendHistory,
  getConfig,
  setConfig,
  getYoutubeTokens,
  setYoutubeTokens,
} from "./src/storage.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const UPLOAD_DIR = path.join(__dirname, "uploads");
const BASE_VIDEOS_DIR = path.join(UPLOAD_DIR, "base-videos");
const GENERATED_DIR = path.join(UPLOAD_DIR, "generated");
const MUSIC_DIR = path.join(UPLOAD_DIR, "music");

await ensureStorage(UPLOAD_DIR);
await ensureStorage(BASE_VIDEOS_DIR);
await ensureStorage(GENERATED_DIR);
await ensureStorage(MUSIC_DIR);

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "frontend")));

const baseUpload = multer({ dest: BASE_VIDEOS_DIR });
const musicUpload = multer({ dest: MUSIC_DIR });

app.get("/api/health", (req, res) => res.json({ ok: true }));

app.get("/api/config", async (req, res) => {
  const config = await getConfig();
  res.json(config);
});

app.post("/api/config", async (req, res) => {
  const config = req.body || {};
  await setConfig(config);
  res.json({ ok: true });
});

app.post("/api/script", async (req, res) => {
  try {
    const { prompt, apiKey, baseUrl, model } = req.body;
    if (!prompt || !apiKey) return res.status(400).json({ error: "Missing prompt or apiKey" });
    const script = await generateScript({ prompt, apiKey, baseUrl, model });
    res.json({ script });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message || "Failed to generate script" });
  }
});

app.post("/api/metadata", async (req, res) => {
  try {
    const { script, apiKey, baseUrl, model, channelContext } = req.body;
    if (!script || !apiKey) {
      return res.status(400).json({ error: "Missing script or apiKey" });
    }
    const metadata = await generateMetadata({
      script,
      apiKey,
      baseUrl,
      model,
      channelContext,
    });
    res.json(metadata);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message || "Failed to generate metadata" });
  }
});

app.post("/api/voice", async (req, res) => {
  try {
    const { text, voice, elevenLabsApiKey } = req.body;
    if (!text) return res.status(400).json({ error: "Missing text" });
    const result = await generateVoice({ text, voice, elevenLabsApiKey, outDir: GENERATED_DIR });
    res.json(result);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message || "Failed to generate voice" });
  }
});

app.post("/api/base/upload", baseUpload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });
  const existing = await fs.readdir(BASE_VIDEOS_DIR);
  if (existing.length > 3) {
    await fs.unlink(req.file.path);
    return res.status(400).json({ error: "Base video limit reached (max 3)." });
  }
  res.json({ file: req.file.filename, url: `/uploads/base-videos/${req.file.filename}` });
});

app.get("/api/base/list", async (req, res) => {
  try {
    const files = await fs.readdir(BASE_VIDEOS_DIR);
    res.json({ videos: files });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/music/upload", musicUpload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });
  res.json({ file: req.file.filename, url: `/uploads/music/${req.file.filename}` });
});

app.get("/api/music/list", async (req, res) => {
  try {
    const files = await fs.readdir(MUSIC_DIR);
    res.json({ tracks: files });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/video", async (req, res) => {
  try {
    const { baseVideo, voiceFile, subtitles, title, script, musicFile, maxDuration, subtitleStyle, musicVolume } = req.body;
    if (!baseVideo || !voiceFile) return res.status(400).json({ error: "Missing baseVideo or voiceFile" });

    const safeBase = path.basename(baseVideo);
    const safeVoice = path.basename(voiceFile);
    const safeMusic = musicFile ? path.basename(musicFile) : null;

    const output = await generateVideo({
      baseVideoPath: path.join(BASE_VIDEOS_DIR, safeBase),
      voicePath: path.join(GENERATED_DIR, safeVoice),
      subtitles,
      script,
      outDir: GENERATED_DIR,
      title,
      musicPath: safeMusic ? path.join(MUSIC_DIR, safeMusic) : null,
      maxDuration,
      subtitleStyle,
      musicVolume,
    });

    const historyItem = {
      id: `${Date.now()}`,
      title: title || "Untitled",
      file: path.basename(output),
      createdAt: new Date().toISOString(),
      status: "done",
    };
    await appendHistory(historyItem);
    res.json({ file: path.basename(output), url: `/uploads/generated/${path.basename(output)}` });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message || "Failed to generate video" });
  }
});

app.get("/api/history", async (req, res) => {
  const history = await listHistory();
  res.json({ history });
});

app.get("/api/youtube/auth-url", (req, res) => {
  res.json({ url: youtubeAuthUrl() });
});

app.get("/api/youtube/callback", async (req, res) => {
  try {
    const tokens = await handleYoutubeCallback(req);
    await setYoutubeTokens(tokens);
    return res.redirect("/?youtube=connected");
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
});

app.get("/api/youtube/tokens", async (req, res) => {
  const tokens = await getYoutubeTokens();
  res.json(tokens);
});

app.post("/api/channel/analysis", async (req, res) => {
  try {
    const { apiKey, baseUrl, model, channelId, channelContext, maxVideos } = req.body || {};
    if (!apiKey) {
      return res.status(400).json({ error: "Missing OpenAI API key." });
    }
    const tokens = await getYoutubeTokens();
    let accessToken = tokens.access_token;
    if (!accessToken && tokens.refresh_token) {
      accessToken = await refreshYoutubeAccessToken(tokens.refresh_token);
    }
    if (!accessToken) {
      return res.status(400).json({ error: "Connect YouTube in Settings first." });
    }

    const result = await analyzeChannel({
      accessToken,
      channelId,
      maxVideos: Number(maxVideos) || 30,
      openaiKey: apiKey,
      baseUrl,
      model,
      channelContext,
    });
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Channel analysis failed" });
  }
});

app.post("/api/youtube/upload", async (req, res) => {
  try {
    const { accessToken, refreshToken, videoFile, title, description, tags } = req.body;
    if (!accessToken || !videoFile) {
      return res.status(400).json({ error: "Missing accessToken or videoFile" });
    }
    const safeVideo = path.basename(videoFile);
    const localVideoPath = path.join(GENERATED_DIR, safeVideo);
    const result = await uploadToYoutube({
      accessToken,
      refreshToken,
      videoPath: localVideoPath,
      title,
      description,
      tags,
    });
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/automation/run", async (req, res) => {
  try {
    const {
      openaiKey,
      openaiBaseUrl,
      openaiModel,
      elevenLabsKey,
      voice,
      upload,
      maxDuration,
      musicFile,
      promptOverride,
    } = req.body || {};
    const config = await getConfig();
    const baseVideos = await fs.readdir(BASE_VIDEOS_DIR);
    if (!baseVideos.length) {
      return res.status(400).json({ error: "Upload at least one base video first." });
    }
    if (!openaiKey) {
      return res.status(400).json({ error: "Missing OpenAI API key." });
    }
    if (!elevenLabsKey) {
      return res.status(400).json({ error: "Missing ElevenLabs API key for automation." });
    }

    const tokens = upload ? await getYoutubeTokens() : {};
    const results = [];
    const count = Number(config.videosPerDay) || 1;
    const useAutoMetadata = config.autoMetadata !== false;

    for (let i = 0; i < count; i += 1) {
      const baseVideo = baseVideos[Math.floor(Math.random() * baseVideos.length)];
      const prompt = promptOverride || config.defaultPrompt;
      const script = await generateScript({
        prompt,
        apiKey: openaiKey,
        baseUrl: openaiBaseUrl || config.openaiBaseUrl,
        model: openaiModel || config.openaiModel,
      });

      let videoTitle = config.defaultTitle;
      let videoDescription = config.defaultDescription;
      let videoTags = config.defaultTags;
      if (useAutoMetadata) {
        try {
          const metadata = await generateMetadata({
            script,
            apiKey: openaiKey,
            baseUrl: openaiBaseUrl || config.openaiBaseUrl,
            model: openaiModel || config.openaiModel,
            channelContext: config.channelContext,
          });
          if (metadata.title) videoTitle = metadata.title;
          if (metadata.description) videoDescription = metadata.description;
          if (metadata.tags?.length) videoTags = metadata.tags;
        } catch (err) {
          console.error("Metadata generation failed:", err.message);
        }
      }

      const voiceResult = await generateVoice({
        text: script,
        voice: voice || config.defaultVoice,
        elevenLabsApiKey: elevenLabsKey,
        outDir: GENERATED_DIR,
      });

      const videoPath = await generateVideo({
        baseVideoPath: path.join(BASE_VIDEOS_DIR, baseVideo),
        voicePath: path.join(GENERATED_DIR, voiceResult.file),
        script,
        outDir: GENERATED_DIR,
        title: videoTitle,
        musicPath: musicFile ? path.join(MUSIC_DIR, path.basename(musicFile)) : null,
        maxDuration: maxDuration || config.maxDuration,
        subtitleStyle: config.subtitleStyle,
        musicVolume: config.musicVolume,
      });

      const historyItem = {
        id: `${Date.now()}-${i}`,
        title: videoTitle || "Daily Short",
        file: path.basename(videoPath),
        createdAt: new Date().toISOString(),
        status: "done",
      };
      await appendHistory(historyItem);

      let uploadResult = null;
      if (upload && tokens?.access_token) {
        uploadResult = await uploadToYoutube({
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
          videoPath,
          title: videoTitle,
          description: videoDescription,
          tags: videoTags,
        });
      }

      results.push({
        script,
        voiceFile: voiceResult.file,
        videoFile: path.basename(videoPath),
        upload: uploadResult,
      });
    }

    res.json({ results });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message || "Automation failed" });
  }
});

app.use("/uploads", express.static(UPLOAD_DIR));

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Shorts Factory server listening on http://localhost:${port}`);
});
