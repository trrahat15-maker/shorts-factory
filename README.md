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

1. Upload 1-3 base videos in **Library**.
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

### 2) Add required GitHub Secrets

In your GitHub repo: **Settings -> Secrets and variables -> Actions -> New repository secret**

Required:
- `OPENAI_API_KEY`
- `ELEVENLABS_API_KEY`
- `YOUTUBE_CLIENT_ID`
- `YOUTUBE_CLIENT_SECRET`
- `YOUTUBE_REFRESH_TOKEN`

Optional overrides:
- `OPENAI_MODEL`
- `OPENAI_MODEL_FALLBACK`
- `OPENAI_MODEL_LIST` (comma separated list to try in order)
- `OPENAI_MODEL_ATTEMPTS` (default: 2)
- `OPENAI_RETRY_DELAYS` (comma separated seconds, default: `30,60,90`)
- `AUTO_METADATA` (`true` or `false`, default: `true`)
- `CHANNEL_CONTEXT` (short channel description for better titles/tags)
- `OPENAI_BASE_URL`
- `ELEVENLABS_VOICE`
- `VIDEO_TITLE`
- `VIDEO_DESCRIPTION`
- `VIDEO_TAGS` (comma separated)
- `MAX_DURATION`
- `BASE_VIDEO_URLS` (comma separated URLs)
- `MUSIC_URLS` (comma separated URLs)

### 3) Enable the workflow

The workflow file is:

`.github/workflows/daily-upload.yml`

It runs every day at **10:00 UTC**. You can change the cron schedule there.

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
