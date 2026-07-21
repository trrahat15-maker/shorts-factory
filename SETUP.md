# 🚀 Shorts Factory Daily - Complete Setup Guide

## The Ultimate FREE YouTube Shorts Automation System

This system **analyzes your channel**, **scans trending topics from the internet**, **generates viral-optimized videos**, and **uploads them at the best time** - all for FREE using GitHub Actions.

---

## 📋 What You Get

| Feature | How It Works | Cost |
|---------|-------------|------|
| **Channel Analysis** | Analyzes your YouTube channel's best-performing content | Free |
| **Trend Detection** | Scans Reddit, HackerNews, Google Trends, YouTube Trends | Free |
| **AI Script Generation** | Uses free OpenRouter models (Llama, Gemini) | Free |
| **Viral Title Optimization** | Scores titles based on 15+ viral patterns | Free |
| **Best Time Upload** | Analyzes your channel to find peak engagement hours | Free |
| **Auto Hashtags** | Generates optimized hashtags from trends + performance | Free |
| **Stock Media** | Pexels/Pixabay free tier for auto-visuals | Free |
| **Scheduled Uploads** | GitHub Actions cron jobs (no server needed) | Free |
| **Performance Learning** | Tracks what works and improves over time | Free |

---

## 🎯 Quick Start (5 minutes)

### Step 1: Fork this repository
Click "Fork" on GitHub to create your own copy.

### Step 2: Get YouTube API credentials

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project (or select existing)
3. Enable **YouTube Data API v3**
4. Go to **Credentials** → **Create Credentials** → **OAuth 2.0 Client ID**
5. Application type: **Web application**
6. Add redirect URI: `http://localhost:3000/api/youtube/callback`
7. Save the **Client ID** and **Client Secret**

### Step 3: Get YouTube Refresh Token

Run this locally (one time only):
```bash
# Install dependencies
npm install

# Set your YouTube credentials
set YOUTUBE_CLIENT_ID=your_client_id
set YOUTUBE_CLIENT_SECRET=your_client_secret

# Run the token generator
node scripts/getYoutubeRefreshToken.js
```

Follow the URL, authorize your YouTube channel, and copy the refresh token.

### Step 3.5: Install FREE Realistic Voice (Optional but Recommended)

For **realistic, natural-sounding voiceovers** without paying for ElevenLabs, install edge-tts:

```bash
# Windows (requires Python)
pip install edge-tts

# Or install via the web UI after running the server
# Just visit Settings -> Install Free TTS Engine
```

**What you get:**
- **edge-tts** (Microsoft Edge neural TTS) — sounds as good as ElevenLabs, completely free
- **gTTS** (Google TTS) — good quality, no API key needed
- **eSpeak** (fallback) — robotic but always available

**How to set the voice:**
- Set `FREE_TTS_VOICE=en-US-JennyNeural` for a warm female voice (best for motivation)
- Set `FREE_TTS_VOICE=en-US-GuyNeural` for a confident male voice
- Supports 18+ voices including English (US/UK/India) and Arabic

The system automatically picks the best available engine:
1. **edge-tts** → Best quality (Microsoft neural voices)
2. **gTTS** → Good quality (Google)
3. **eSpeak** → Basic fallback (robotic)

---

### Step 4: Get a FREE AI API Key

**Option A: OpenRouter (Recommended - Free)**
1. Go to [OpenRouter.ai](https://openrouter.ai/)
2. Sign up and get your API key
3. Free credits for Llama, Gemini, and other models

**Option B: OpenAI (Paid but best quality)**
1. Go to [platform.openai.com](https://platform.openai.com/)
2. Create an API key (costs ~$0.15/day for 3 videos)

### Step 5: Add GitHub Secrets

Go to your forked repo → **Settings** → **Secrets and variables** → **Actions**

**Required Secrets:**
```
YOUTUBE_CLIENT_ID=your_client_id
YOUTUBE_CLIENT_SECRET=your_client_secret
YOUTUBE_REFRESH_TOKEN=your_refresh_token
OPENAI_API_KEY=your_openai_or_openrouter_key
```

**Optional but Recommended:**
```
ELEVENLABS_API_KEY=your_elevenlabs_key    # Better voice quality
PEXELS_API_KEY=your_pexels_key            # Stock video backgrounds
PIXABAY_API_KEY=your_pixabay_key          # More stock media
DROPBOX_ACCESS_TOKEN=your_dropbox_token   # Backup generated videos
```

### Step 6: Configure Variables (Optional)

Go to **Settings** → **Secrets and variables** → **Actions** → **Variables**

```
TOPIC_LIST=success,mindset,money,productivity,discipline
CHANNEL_CONTEXT=motivational shorts
SCHEDULE_TZ=America/New_York
HASHTAGS=#shorts,#motivation,#success,#mindset,#viral,#fyp
```

### Step 7: Enable the Workflow

1. Go to **Actions** tab in your repo
2. Click **"I understand my workflows, go ahead and enable them"**
3. The system will automatically run on schedule!

---

## 🧠 How It Works (The Intelligence)

### 1. Trend Analysis Pipeline
```
Internet Trends (Reddit/HN/News)
        ↓
YouTube Trending Shorts
        ↓
Competitor Analysis
        ↓
Your Channel Performance History
        ↓
    MERGED + SCORED
        ↓
  Best Topic Selected
```

### 2. Content Generation Pipeline
```
Best Topic
    ↓
AI Generates 5 Hook Variants
    ↓
Best Hook Selected (scored by viral patterns)
    ↓
AI Generates Script with Hook
    ↓
AI Generates Title + Description + Tags
    ↓
Title Optimized (15+ viral patterns checked)
    ↓
Voice Generated (ElevenLabs or free eSpeak)
    ↓
Stock Media Fetched (Pexels/Pixabay)
    ↓
Video Rendered with Effects
    ↓
Thumbnail Generated
    ↓
Uploaded to YouTube
```

### 3. Learning System
```
After Upload → Track Views/Likes/Comments
    ↓
Update Title Score Database
    ↓
Update Hashtag Performance Database
    ↓
Update Best Upload Time Analysis
    ↓
Next Video Uses Learned Data
```

---

## ⚙️ Configuration Options

### Environment Variables (set as GitHub Secrets or Variables)

| Variable | Default | Description |
|----------|---------|-------------|
| `SMART_SCHEDULE` | `true` | Analyzes channel to find best upload time |
| `SCHEDULE_TZ` | `UTC` | Your timezone (e.g., `America/New_York`) |
| `VIRAL_MODE` | `true` | Optimizes for Shorts viral potential |
| `MIN_DURATION` | `20` | Minimum video length in seconds |
| `MAX_DURATION` | `40` | Maximum video length in seconds |
| `TOPIC_LIST` | `success,mindset,money...` | Comma-separated content topics |
| `TOPIC_BLOCKLIST` | `` | Topics to avoid |
| `CHANNEL_CONTEXT` | `motivational shorts` | Your channel's niche |
| `ENABLE_TRENDS` | `true` | Enable internet trend scanning |
| `TRENDS_REGION` | `US` | Region for trends |
| `AUTO_METADATA` | `true` | Auto-generate title/desc/tags |
| `TITLE_VARIANTS` | `3` | Number of title options to generate |
| `HOOK_VARIANTS` | `5` | Number of hook options to generate |
| `SUBTITLE_MODE` | `word` | `word` or `sentence` subtitles |
| `COLOR_GRADE_PRESET` | `auto` | `auto`, `warm`, `cool`, `cinematic`, `punchy` |
| `YOUTUBE_PRIVACY_STATUS` | `public` | `public`, `unlisted`, or `private` |
| `POST_COMMENT` | `false` | Auto-post a comment on upload |
| `PINNED_COMMENT` | `` | Comment text to post |

### OpenRouter Free Models (set as Variables)
```
OPENAI_BASE_URL=https://openrouter.ai/api/v1
OPENAI_MODEL=meta-llama/llama-3.2-3b-instruct:free
OPENAI_MODEL_FALLBACK=meta-llama/llama-3.2-3b-instruct:free
OPENAI_MODEL_LIST=meta-llama/llama-3.2-3b-instruct:free,google/gemini-3.1-flash-lite-preview:free,stepfun/step-3.5-flash:free
```

---

## 📊 Monitoring Performance

### Check Upload Logs
1. Go to **Actions** tab in your repo
2. Click on any workflow run
3. Download the **upload-logs** artifact
4. Open the `.log` file to see detailed output

### View Generated Videos
1. Go to **Actions** → workflow run
2. Download **generated-videos** artifact

### Manual Trigger
Go to **Actions** → **Daily Shorts Factory** → **Run workflow** → Choose:
- `UPLOAD_NOW` - Force upload immediately
- `GENERATE_BACKUP` - Generate videos without uploading
- `BACKUP_ONLY` - Upload existing backup videos
- `CHECK_LOGS` - View last run logs

---

## 🎬 Adding Your Own Base Videos

### Option 1: Upload to repo
Add `.mp4` files to the `base-videos/` folder in your repo.

### Option 2: URL Downloads
Set secret `BASE_VIDEO_URLS` with comma-separated direct download URLs.

### Option 3: Dropbox Sync
Set up Dropbox token and folder path for automatic sync.

---

## 🔧 Local Development

```bash
# Install
npm install

# Set environment variables
set OPENAI_API_KEY=your_key
set YOUTUBE_CLIENT_ID=your_id
set YOUTUBE_CLIENT_SECRET=your_secret
set YOUTUBE_REFRESH_TOKEN=your_token

# Run once
node scripts/autoUpload.js

# Or run the web server
npm start
```

---

## 🆘 Troubleshooting

**"YouTube refresh token is invalid"**
→ Regenerate token using `node scripts/getYoutubeRefreshToken.js`

**"No base videos found"**
→ Add `.mp4` files to `base-videos/` folder or enable stock media

**"OpenAI API key error"**
→ Set `OPENAI_API_KEY` secret with your OpenRouter or OpenAI key

**"Workflow not running"**
→ Go to Actions tab and enable workflows

---

## 📈 Pro Tips for Going Viral

1. **Upload at peak times**: The system auto-optimizes this based on your channel
2. **Use strong hooks**: First 2 seconds determine 80% of success
3. **Keep it short**: 20-40 seconds is the sweet spot for Shorts
4. **Loop endings**: Videos that loop get 2x more views
5. **Post consistently**: Daily uploads build algorithmic momentum
6. **Engage immediately**: Reply to comments in first hour
7. **Use trending audio**: The system can auto-select trending music
8. **Test different hooks**: A/B test hooks to find what resonates

---

## 🆓 100% Free Stack

| Service | What It Does | Free Tier |
|---------|-------------|-----------|
| **GitHub Actions** | Scheduled execution | 2000 min/month (plenty) |
| **OpenRouter** | AI script generation | Free models available |
| **Reddit API** | Trend detection | Unlimited |
| **HackerNews API** | Trend detection | Unlimited |
| **Google Trends** | Trend detection | Unlimited |
| **Pexels** | Stock videos | 200 req/hour |
| **Pixabay** | Stock media | Unlimited |
| **eSpeak** | Text-to-speech | Free (system) |
| **Dropbox** | Backup storage | 2GB free |
| **YouTube API** | Upload & analytics | 10,000 units/day |

---

## 🔒 Privacy & Security

- All API keys stored as GitHub Secrets (encrypted)
- Videos are uploaded directly to YOUR YouTube channel
- No third-party data collection
- All processing happens in GitHub's infrastructure
- You maintain full ownership of all content

---

## 🎯 Next Steps After Setup

1. **First week**: Let it run daily, check logs
2. **After 10 videos**: Review performance in YouTube Studio
3. **Adjust topics**: Update `TOPIC_LIST` based on what works
4. **Refine hooks**: Check which hooks get best retention
5. **Scale up**: Increase `videosPerDay` in config

---

**Made with ❤️ for creators who want to grow for free.**