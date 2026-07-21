# 🚀 Shorts Factory Daily

**The Ultimate FREE YouTube Shorts Automation System**

Analyze your channel, scan trending topics, generate viral-optimized videos, and auto-upload at peak times — **100% FREE with GitHub Actions**.

> 📖 **New to the project?** See [**SETUP.md**](SETUP.md) for a complete step-by-step guide.

---

## ✨ What's New (v2.0)

| Feature | Description |
|---------|-------------|
| 🔥 **Multi-Source Trends** | Scans Reddit, HackerNews, Google Trends, YouTube Trends — all free |
| 📊 **Best Time Optimizer** | Analyzes your channel to find exact peak upload hours |
| 🏷️ **Smart Hashtags** | Generates niche-optimized hashtags + tracks performance |
| 🎯 **Viral Title Scoring** | Scores titles against 15+ viral patterns |
| 🧠 **Performance Learning** | Tracks what works and improves over time |
| 📈 **Trend Dashboard** | See trending topics + hashtag performance in the UI |
| 🤖 **Free AI Models** | Works with free OpenRouter models (Llama, Gemini) |
| ⏰ **GitHub Scheduler** | Cron-based uploads — no server needed |

---

## 🆓 100% Free Stack

| Service | What It Does | Free Tier |
|---------|-------------|-----------|
| **GitHub Actions** | Scheduled execution | 2000 min/month |
| **OpenRouter** | AI script generation | Free models |
| **Reddit API** | Trend detection | Unlimited |
| **HackerNews API** | Trend detection | Unlimited |
| **Google Trends** | Trend detection | Unlimited |
| **Pexels/Pixabay** | Stock media | Free tier |
| **Dropbox** | Backup storage | 2GB free |
| **YouTube API** | Upload & analytics | 10,000 units/day |

---

## 🚀 Quick Start (30 seconds)

```bash
# 1. Fork the repo on GitHub

# 2. Add 4 GitHub Secrets:
#    YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET, 
#    YOUTUBE_REFRESH_TOKEN, OPENAI_API_KEY

# 3. Enable GitHub Actions

# Done! Videos will auto-generate and upload daily.
```

**Full guide → [SETUP.md](SETUP.md)**

---

## 🏗️ Architecture

```
┌─────────────────────────────┐
│      TREND PIPELINE         │
├─────────────────────────────┤
│ Reddit │ HackerNews │ News  │
│ Google Trends │ YouTube     │
│ Competitor Analysis         │
└──────────────┬──────────────┘
               ↓
┌─────────────────────────────┐
│    CONTENT GENERATOR        │
├─────────────────────────────┤
│ Best Topic → Best Hook      │
│ AI Script → Viral Title     │
│ Voice → Stock Media         │
│ Video Rendering + Effects   │
└──────────────┬──────────────┘
               ↓
┌─────────────────────────────┐
│    OPTIMIZER ENGINE         │
├─────────────────────────────┤
│ Best Upload Time Analyzer   │
│ Title Performance Scoring   │
│ Hashtag Performance Tracking│
│ Learning System → Improves  │
└──────────────┬──────────────┘
               ↓
┌─────────────────────────────┐
│      YOUTUBE UPLOAD         │
├─────────────────────────────┤
│ Thumbnail + Description     │
│ Tags + Hashtags             │
│ Auto Comment (optional)     │
│ Performance Recording        │
└─────────────────────────────┘
```

---

## 📁 Project Structure

```
├── .github/workflows/
│   └── schedule-upload.yml    # GitHub Actions scheduler
├── scripts/
│   ├── autoUpload.js          # Main upload pipeline (2263 lines)
│   ├── trendSources.js        # FREE trend sources (Reddit, HN, etc.)
│   ├── optimizer.js           # Time/title/hashtag optimizer
│   ├── analyzeChannel.js      # Channel analysis script
│   └── getYoutubeRefreshToken.js
├── src/
│   ├── openai.js              # AI script & metadata generation
│   ├── video.js               # FFmpeg video rendering
│   ├── voice.js               # TTS voice generation
│   ├── youtube.js             # YouTube API integration
│   ├── trends.js              # Google/YouTube trends
│   ├── channelAnalysis.js     # Channel analysis with AI
│   ├── stock.js               # Stock media (Pexels/Pixabay)
│   └── competitors.js         # Competitor analysis
├── server.js                  # Web server + API
├── frontend/                  # Web dashboard UI
├── base-videos/               # Your base videos
├── music/                     # Background music
└── SETUP.md                   # Complete setup guide
```

---

## 🖥️ Web Dashboard

Run locally with the web UI:

```bash
npm install
npm start
# Open http://localhost:3000
```

Features:
- **Dashboard** — see best upload time, trending topics, top hashtags
- **Create** — manual script/voice/video generation
- **Trends** — Reddit trends, HN trends, hashtag performance
- **Insights** — AI channel analysis
- **Automation** — schedule daily uploads
- **Settings** — configure everything

---

## ⚙️ Environment Variables

See [**SETUP.md**](SETUP.md) for the complete list. Key ones:

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `YOUTUBE_CLIENT_ID` | ✅ | - | YouTube OAuth client ID |
| `YOUTUBE_CLIENT_SECRET` | ✅ | - | YouTube OAuth client secret |
| `YOUTUBE_REFRESH_TOKEN` | ✅ | - | YouTube OAuth refresh token |
| `OPENAI_API_KEY` | ✅ | - | OpenAI or OpenRouter API key |
| `ELEVENLABS_API_KEY` | ❌ | - | Better voice quality |
| `PEXELS_API_KEY` | ❌ | - | Stock video backgrounds |
| `DROPBOX_ACCESS_TOKEN` | ❌ | - | Backup storage |
| `VIRAL_MODE` | ❌ | `true` | Optimize for viral Shorts |
| `SMART_SCHEDULE` | ❌ | `true` | Find best upload time |
| `ENABLE_TRENDS` | ❌ | `true` | Scan trending topics |

---

## 📜 License

MIT — free for personal and commercial use.

---

**Made with ❤️ for creators who want to grow for free.**