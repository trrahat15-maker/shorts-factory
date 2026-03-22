import { google } from "googleapis";
import fs from "fs";

const SCOPES = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube.readonly",
];

function createOAuthClient() {
  const clientId = process.env.YOUTUBE_CLIENT_ID;
  const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;
  const redirectUri = process.env.YOUTUBE_REDIRECT_URI || "http://localhost:3000/api/youtube/callback";
  if (!clientId || !clientSecret) {
    throw new Error(
      "Missing YOUTUBE_CLIENT_ID or YOUTUBE_CLIENT_SECRET environment variables."
    );
  }
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

export function youtubeAuthUrl() {
  const oauth2Client = createOAuthClient();
  return oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: SCOPES,
  });
}

export async function handleYoutubeCallback(req) {
  const code = req.query.code;
  if (!code) throw new Error("Missing code query parameter");
  const oauth2Client = createOAuthClient();
  const { tokens } = await oauth2Client.getToken(code);
  return tokens;
}

export async function refreshYoutubeAccessToken(refreshToken) {
  if (!refreshToken) {
    throw new Error("Missing YouTube refresh token.");
  }
  const oauth2Client = createOAuthClient();
  oauth2Client.setCredentials({ refresh_token: refreshToken });
  const tokenResponse = await oauth2Client.getAccessToken();
  const accessToken = tokenResponse?.token || tokenResponse;
  if (!accessToken) {
    throw new Error("Failed to refresh YouTube access token.");
  }
  return accessToken;
}

export async function uploadToYoutube({ accessToken, refreshToken, videoPath, title, description, tags = [] }) {
  const oauth2Client = createOAuthClient();
  oauth2Client.setCredentials({ access_token: accessToken, refresh_token: refreshToken });
  const youtube = google.youtube({ version: "v3", auth: oauth2Client });

  const res = await youtube.videos.insert({
    part: ["snippet", "status"],
    requestBody: {
      snippet: {
        title: title || "Daily Short",
        description:
          description ||
          "Daily motivational shorts.\n\nSubscribe for more success mindset content.\n\n#motivation #success #discipline",
        tags: Array.isArray(tags) ? tags : [],
      },
      status: { privacyStatus: "private" },
    },
    media: {
      body: fs.createReadStream(videoPath),
    },
  });

  return res.data;
}
