# Shorts Factory Daily

A Replit-ready app to generate and upload motivational YouTube Shorts automatically from a mobile browser.

## Goals

- Run entirely inside Replit
- Works on mobile browsers
- Generates AI scripts using an OpenAI-compatible API
- Generates voice narration (ElevenLabs + browser preview fallback)
- Creates Shorts videos via FFmpeg
- Uploads to YouTube via OAuth
- Schedules daily uploads while the app is open

## Getting Started

### 1) Install dependencies

```bash
npm install
```

### 2) Configure environment variables

Set these in the Replit Secrets UI (or a local `.env` file):

- `YOUTUBE_CLIENT_ID`
- `YOUTUBE_CLIENT_SECRET`
- `YOUTUBE_REDIRECT_URI` (default: `http://localhost:3000/api/youtube/callback`)

### 3) Run the app

```bash
npm run start
```

Then open the Replit preview or go to `http://localhost:3000`.

## Usage

1. Upload base videos in **Library** (optional if stock video is enabled).
2. (Optional) Add portrait images to `user-images/` to mix your own photos into the AI visuals.
2. In **Settings**, unlock the vault and save your OpenAI + ElevenLabs API keys.
3. In **Create**, generate a script, voice, and video.
4. Connect YouTube in **Settings** to enable uploads.
5. Use **Automation** to schedule daily generation while the app is running.
6. Use **Insights** to analyze your channel and get AI growth suggestions.

## Notes

- API keys are encrypted in your browser local storage (vault password required).
- ElevenLabs is required for exporting MP3 narration and video generation.
- Replit may sleep after inactivity; automation runs only while the app is open.
- Base videos are automatically cropped to 9:16 and looped to match narration length.
- Set `YOUTUBE_PRIVACY_STATUS` to `public`, `unlisted`, or `private` (default: `public`).
- Auto metadata can be toggled in **Settings** and uses your script to generate titles, descriptions, and tags.
- For extra security, set an **App Access Token** in Settings. The backend will require `x-app-token` for API calls.

## Permanent Storage (Optional)

By default, uploads are stored on the server filesystem. On free hosts (Replit/Render), this storage is temporary.
To make storage permanent, use S3-compatible storage (R2, Supabase Storage, Backblaze, AWS S3).

Add these environment variables on your server:

- `STORAGE_DRIVER=s3`
- `S3_BUCKET=your-bucket`
- `S3_REGION=auto` (or your region)
- `S3_ENDPOINT=https://your-s3-endpoint` (required for R2/Supabase)
- `S3_ACCESS_KEY=...`
- `S3_SECRET_KEY=...`

To delete generated videos after successful upload:

- `AUTO_DELETE_AFTER_UPLOAD=true` (default)

## Mobile App (Expo)

The React Native (Expo) app lives in `mobile/` and connects to the Replit backend.

### Install & run locally

```bash
cd mobile
npm install
npx expo start
```

### Build APK with Expo (EAS)

```bash
cd mobile
npx eas build -p android --profile preview
```

When the app launches, set your Replit backend URL in **Settings** (example: `https://your-repl.replit.app`).

## Free Cloud Automation (GitHub Actions)

This project can run daily automation for free using GitHub Actions (no always-on server needed).

### 1) Add base videos to the repo

Create a folder at repo root:

`base-videos/`

Place 1-3 short vertical videos (mp4/mov/webm) inside. Keep files small to stay under GitHub limits.

Optional background music:

`music/`

### Stock visuals (no base videos needed)

If you want fully automatic visuals with no base video uploads, add a Pexels API key:

- `PEXELS_API_KEY`
- `PIXABAY_API_KEY` (optional backup)
- `ENABLE_STOCK_VIDEO=true`
- `ENABLE_IMAGE_MODE=true`

The workflow will fetch matching stock videos. If none are available, it falls back to images and creates Ken Burns-style slides.

### Media Priority & Mixing

1. **Stock visuals (Pexels)**: the system searches by script keywords.
2. **User media**: `/base-videos/` and `/user-images/` are mixed in.
3. **Cache fallback**: previously downloaded media under `data/stock-cache` (best on Replit/Render).

If both stock + user media exist, the pipeline always mixes them so every video blends both sources.

### 2) Add required GitHub Secrets

In your GitHub repo: **Settings -> Secrets and variables -> Actions -> New repository secret**

Required:
- `OPENAI_API_KEY`
- `ELEVENLABS_API_KEY`
- `YOUTUBE_CLIENT_ID`
- `YOUTUBE_CLIENT_SECRET`
- `YOUTUBE_REFRESH_TOKEN`
 - `PEXELS_API_KEY` (for free stock videos/images)
 - `PIXABAY_API_KEY` (optional backup stock source)

Optional overrides:
- `OPENAI_MODEL`
- `OPENAI_MODEL_FALLBACK`
- `OPENAI_MODEL_LIST` (comma separated list to try in order)
- `OPENAI_MODEL_ATTEMPTS` (default: 2)
- `OPENAI_RETRY_DELAYS` (comma separated seconds, default: `30,60,90`)
- `AUTO_METADATA` (`true` or `false`, default: `true`)
- `CHANNEL_CONTEXT` (short channel description for better titles/tags)
- `UPLOAD_CHANCE` (0-1, default: `1`, use `0.6` to make the second daily run optional)
- `SCRIPT_LANGUAGE` (default: English)
- `TOPIC_LIST` (comma separated topics for daily rotation)
- `TITLE_VARIANTS` (default: 3)
- `HASHTAGS` (comma separated, default: `#shorts,#motivation,#success`)
- `OPENAI_BASE_URL`
- `ENABLE_STOCK_VIDEO` (`true` or `false`, default: `true`)
- `ENABLE_IMAGE_MODE` (`true` or `false`, default: `true`)
- `MIX_USER_MEDIA` (`true` or `false`, default: `true`)
- `SUBTITLE_MODE` (`word` or `sentence`, default: `word`)
- `SUBTITLE_HIGHLIGHT` (`true` or `false`, default: `true`)
- `EXTRA_EFFECTS` (`true` or `false`, default: `true`)
- `SUBTITLE_PUNCT_WEIGHT` (default: `0.35`, adds a small pause after punctuation for better sync)
- `VIRAL_MODE` (`true` or `false`, default: `true`, targets 20-40s shorts and fast cuts)
- `CLIP_MIN_SECONDS` (default: `1.0`)
- `CLIP_MAX_SECONDS` (default: `2.2`)
- `CLIP_TARGET_SECONDS` (default: `1.6`)
- `SCENE_ASSET_COUNT` (default: `3`, downloads multiple visuals per scene)
- `IMAGE_FALLBACK_COUNT` (default: `4`, images per scene when no video)
- `ELEVENLABS_VOICE`
- `VIDEO_TITLE`
- `VIDEO_DESCRIPTION`
- `VIDEO_TAGS` (comma separated)
- `YOUTUBE_PRIVACY_STATUS` (`public`, `unlisted`, or `private`)
- `MAX_DURATION` (maximum video length in seconds, default: `40` in viral mode)
- `SCRIPT_DURATION_SECONDS` (default: `30` in viral mode)
- `MIN_DURATION` (minimum video length in seconds, default: `20` in viral mode)
- `ALLOW_VFLIP` (`true` to allow vertical flips, default: `false`)
- `CTA_LIST` (comma separated CTA lines)
- `APPEND_CTA` (`true` or `false`, default: `true`)
- `SURPRISE_BROLL` (`true` or `false`, default: `true`)
- `SURPRISE_TOPICS` (comma separated surprise B-roll topics)
- `KEYWORD_POPUPS` (`true` or `false`, default: `true`)
- `TEXT_GLOW` (`true` or `false`, default: `true`)
- `CAMERA_SHAKE` (`true` or `false`, default: `true`)
- `MOTION_BLUR` (`true` or `false`, default: `true`)
- `WATERMARK_TEXT` (text watermark in bottom-right)
- `HOOK_BOOST` (`true` or `false`, default: `true`)
- `HOOK_MAX_WORDS` (default: `10`)
- `HOOK_UPPERCASE` (`true` or `false`, default: `true`)
- `MUSIC_VOLUME` (default: `0.18`)
- `WORDS_PER_SECOND` (default: `2.6`, lower = longer scripts)
- `AUDIO_DUCKING` (`true` or `false`, default: `true`)
- `AUDIO_LIMITER` (`true` or `false`, default: `true`)
- `TRIM_SILENCE` (`true` or `false`, default: `true`)
- `SILENCE_THRESHOLD` (default: `-30dB`)
- `SILENCE_DURATION` (default: `0.2`)
- `COLOR_GRADE_PRESET` (`auto`, `warm`, `cool`, `vivid`, `cinematic`, `punchy`, `soft`)
- `BEAT_SYNC` (`true` or `false`, default: `true`)
- `MUSIC_BPM` (number, optional)
- `SCENE_ZOOM` (`true` or `false`, default: `true`)
- `COLD_OPEN` (`true` or `false`, default: `true`)
- `TITLE_POLISH` (`true` or `false`, default: `true`)
- `TITLE_PREFIXES` (comma separated prefixes for short titles)
- `BASE_VIDEO_URLS` (comma separated URLs)
- `MUSIC_URLS` (comma separated URLs)
- `YOUTUBE_PRIVACY_STATUS` (`public`, `unlisted`, or `private`)
- `VIDEO_RANDOM_START` (`true` to randomize the start offset, `false` to always start at 0)

Optional analysis secrets (for manual run):
- `CHANNEL_ID`
- `ANALYSIS_VIDEO_COUNT`

### 3) Enable the workflow

The workflow file is:

`.github/workflows/daily-upload.yml`

It runs every day at **09:00 UTC** and **21:00 UTC** by default (two uploads per day). You can change the cron schedule there.

### 4) How it works

GitHub Actions runs:

1. Generate script
2. Generate voice
3. Create video with FFmpeg
4. Upload to YouTube

Temporary files are stored in `/tmp` and deleted after upload.

### Generate a YouTube refresh token (one-time)

Run locally (not in Actions):

```bash
node scripts/getYoutubeRefreshToken.js
```

It will print a URL. Open it, approve access, and the script will output a refresh token.  
Save that token as the GitHub Secret `YOUTUBE_REFRESH_TOKEN`.

### Use private URLs for base videos (optional)

If you don't want to commit videos to the repo, set these secrets:

- `BASE_VIDEO_URLS` (comma separated URLs to video files)
- `MUSIC_URLS` (comma separated URLs to audio files)

The workflow downloads them into `/tmp` at runtime.

## AI Channel Analysis (Optional)

Generate an AI report for your channel using the YouTube Data API + OpenAI.

```bash
node scripts/analyzeChannel.js
```

Required secrets (local `.env` or Actions):
- `OPENAI_API_KEY`
- `YOUTUBE_CLIENT_ID`
- `YOUTUBE_CLIENT_SECRET`
- `YOUTUBE_REFRESH_TOKEN`

Optional:
- `OPENAI_BASE_URL`
- `OPENAI_MODEL`
- `CHANNEL_ID` (defaults to the authenticated channel)
- `CHANNEL_CONTEXT` (short channel description)
- `ANALYSIS_VIDEO_COUNT` (default: 30)
- `ANALYSIS_OUTPUT` (default: `analysis.md`)
