import http from "http";
import { google } from "googleapis";

const CLIENT_ID = process.env.YOUTUBE_CLIENT_ID;
const CLIENT_SECRET = process.env.YOUTUBE_CLIENT_SECRET;
const REDIRECT_URI = process.env.YOUTUBE_REDIRECT_URI || "http://localhost:3000/oauth2callback";

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("Missing YOUTUBE_CLIENT_ID or YOUTUBE_CLIENT_SECRET in env.");
  process.exit(1);
}

const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
const scopes = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube.readonly",
];

const authUrl = oauth2Client.generateAuthUrl({
  access_type: "offline",
  prompt: "consent",
  scope: scopes,
});

console.log("\nOpen this URL in your browser to authorize:");
console.log(authUrl);
console.log("\nWaiting for OAuth callback on:", REDIRECT_URI);

const server = http.createServer(async (req, res) => {
  try {
    if (!req.url?.includes("code=")) {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("Waiting for OAuth code...");
      return;
    }

    const url = new URL(req.url, REDIRECT_URI);
    const code = url.searchParams.get("code");
    if (!code) {
      res.writeHead(400, { "Content-Type": "text/plain" });
      res.end("Missing code.");
      return;
    }

    const { tokens } = await oauth2Client.getToken(code);
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("Authorization complete. You can close this tab.");

    console.log("\nRefresh token:");
    console.log(tokens.refresh_token);
    console.log("\nSave it as GitHub Secret: YOUTUBE_REFRESH_TOKEN");
    server.close();
  } catch (err) {
    console.error("Error getting token:", err.message);
    res.writeHead(500, { "Content-Type": "text/plain" });
    res.end("Failed to get token.");
    server.close();
  }
});

server.listen(3000);
