/**
 * YouTube Token & Refresh Helper - Works on Phone!
 * Run once, get your refresh token. The system refreshes it automatically after that.
 * 
 * Just needs YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET set
 * - On phone: Use a free hosting service or Replit
 * - No terminal needed after the first setup
 */

import { google } from "googleapis";
import readline from "readline";
import fs from "fs/promises";
import path from "path";
import http from "http";
import { fileURLToPath } from "url";
import open from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TOKEN_FILE = path.join(__dirname, "..", "data", "youtube-tokens.json");
const CLIENT_ID_FILE = path.join(__dirname, "..", "data", "youtube-credentials.json");

const SCOPES = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube.readonly",
  "https://www.googleapis.com/auth/youtube.force-ssl",
];

async function loadCredentials() {
  // Try environment variables first
  if (process.env.YOUTUBE_CLIENT_ID && process.env.YOUTUBE_CLIENT_SECRET) {
    return {
      clientId: process.env.YOUTUBE_CLIENT_ID.trim(),
      clientSecret: process.env.YOUTUBE_CLIENT_SECRET.trim(),
      redirectUri: process.env.YOUTUBE_REDIRECT_URI || "http://localhost:3000/api/youtube/callback",
    };
  }
  
  // Try saved credentials file
  try {
    const data = await fs.readFile(CLIENT_ID_FILE, "utf8");
    return JSON.parse(data);
  } catch {
    return null;
  }
}

async function saveCredentials(creds) {
  await fs.mkdir(path.dirname(CLIENT_ID_FILE), { recursive: true });
  await fs.writeFile(CLIENT_ID_FILE, JSON.stringify(creds, null, 2));
}

async function saveToken(token) {
  await fs.mkdir(path.dirname(TOKEN_FILE), { recursive: true });
  await fs.writeFile(TOKEN_FILE, JSON.stringify(token, null, 2));
  console.log("\n✅ Token saved to: " + TOKEN_FILE);
  console.log("\n📋 Copy this REFRESH TOKEN for GitHub Secrets:");
  console.log("=".repeat(60));
  console.log(token.refresh_token || token.refreshToken || "No refresh token (use YOUTUBE_REFRESH_TOKEN)");
  console.log("=".repeat(60));
  console.log("\n⚠️  This token won't expire unless you revoke it.");
  console.log("   The system will auto-refresh it every time.\n");
}

async function getTokenFromServer() {
  console.log("\n=== PHONE-FRIENDLY METHOD 🎯 ===\n");

  const credentials = await loadCredentials();
  if (!credentials) {
    console.log("❌ No YouTube credentials found!");
    console.log("Set YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET");
    console.log("or run: node scripts/getYoutubeRefreshToken.js first\n");
    process.exit(1);
  }

  const oauth2Client = new google.auth.OAuth2(
    credentials.clientId,
    credentials.clientSecret,
    "http://localhost:3000/api/youtube/callback"
  );

  // Check if we already have a token that needs refresh
  try {
    const existingToken = await fs.readFile(TOKEN_FILE, "utf8").then(JSON.parse).catch(() => null);
    if (existingToken?.refresh_token) {
      oauth2Client.setCredentials(existingToken);
      try {
        const { token } = await oauth2Client.getAccessToken();
        if (token) {
          console.log("✅ Existing token is still valid!");
          console.log("   Access token refreshed successfully.\n");
          console.log("📋 Your refresh token (for GitHub Secrets):");
          console.log("=".repeat(60));
          console.log(existingToken.refresh_token);
          console.log("=".repeat(60));
          return;
        }
      } catch {
        console.log("⚠️  Existing token expired. Getting a new one...\n");
      }
    }
  } catch {
    // No existing token, need new one
  }

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: SCOPES,
  });

  console.log("📱 Open this URL on your phone (or any browser):\n");
  console.log("=".repeat(60));
  console.log(authUrl);
  console.log("=".repeat(60));
  console.log("\n1. Open the URL above");
  console.log("2. Sign in with your YouTube channel");
  console.log("3. Click 'Allow'");
  console.log("4. You'll be redirected to a page");
  console.log("5. Copy the FULL URL from the address bar");
  console.log("   (It starts with http://localhost:3000/api/youtube/callback?...)\n");
  console.log("6. Paste it below:\n");

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const fullUrl = await new Promise((resolve) => {
    rl.question("Paste the redirect URL here: ", (answer) => {
      resolve(answer.trim());
    });
  });
  rl.close();

  // Extract code from URL
  const urlObj = new URL(fullUrl);
  const code = urlObj.searchParams.get("code");
  if (!code) {
    console.log("\n❌ No authorization code found in the URL.");
    console.log("Make sure you copy the FULL URL from the address bar.\n");
    process.exit(1);
  }

  try {
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);
    await saveToken(tokens);
  } catch (err) {
    console.log("\n❌ Failed to get token: " + err.message);
    console.log("Make sure you copied the FULL URL correctly.\n");
    process.exit(1);
  }
}

// === PHONE-FRIENDLY WEB METHOD ===

let server = null;

async function getTokenWeb() {
  const credentials = await loadCredentials();
  if (!credentials) {
    console.log("❌ No YouTube credentials found!");
    process.exit(1);
  }

  const oauth2Client = new google.auth.OAuth2(
    credentials.clientId,
    credentials.clientSecret,
    "http://localhost:3000/api/youtube/callback"
  );

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: SCOPES,
  });

  console.log("\n🎯 Starting web server for phone-friendly token generation...\n");
  console.log("📱 URL Generator:");
  console.log("=".repeat(60));
  console.log(authUrl);
  console.log("=".repeat(60));
  console.log("\n1. Open the URL on your phone");
  console.log("2. Authorize your YouTube channel");
  console.log("3. The server will automatically capture the token!\n");

  return new Promise((resolve, reject) => {
    server = http.createServer(async (req, res) => {
      const url = new URL(req.url, "http://localhost:3000");
      
      if (url.pathname === "/api/youtube/callback") {
        const code = url.searchParams.get("code");
        
        if (code) {
          try {
            const { tokens } = await oauth2Client.getToken(code);
            await saveToken(tokens);
            res.writeHead(200, { "Content-Type": "text/html" });
            res.end(`
              <html>
                <body style="font-family:sans-serif;text-align:center;padding:40px;">
                  <h1>✅ Success!</h1>
                  <p>Your YouTube token has been saved.</p>
                  <p>The refresh token is stored in <code>data/youtube-tokens.json</code></p>
                  <p>Check the terminal for your refresh token.</p>
                  <script>window.close()</script>
                </body>
              </html>
            `);
            resolve();
          } catch (err) {
            res.writeHead(400);
            res.end("Error: " + err.message);
            reject(err);
          }
        } else {
          res.writeHead(400);
          res.end("No code parameter found");
          reject(new Error("No code"));
        }
        
        if (server) server.close();
      } else {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(`
          <html>
            <body style="font-family:sans-serif;text-align:center;padding:40px;background:#0f0f0f;color:white;">
              <h1>🔄 YouTube Token Manager</h1>
              <p>Ready to receive token</p>
              <a href="${authUrl}" style="display:inline-block;padding:12px 24px;background:#ff6b35;color:white;text-decoration:none;border-radius:8px;margin-top:20px;">
                Authorize YouTube
              </a>
              <p style="margin-top:40px;color:#888;">Open this page on your phone, tap the button, and authorize.</p>
            </body>
          </html>
        `);
      }
    });

    server.listen(3001, () => {
      console.log("🌐 Web interface at: http://localhost:3001");
      console.log("   Open this on your phone to authorize!\n");
    });
  });
}

// === EXPIRY CHECK ===

async function checkTokenExpiry() {
  try {
    const data = await fs.readFile(TOKEN_FILE, "utf8");
    const token = JSON.parse(data);
    
    if (token.expiry_date) {
      const expiresIn = token.expiry_date - Date.now();
      const daysLeft = Math.floor(expiresIn / (1000 * 60 * 60 * 24));
      const hoursLeft = Math.floor((expiresIn % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      
      if (expiresIn > 0) {
        console.log(`✅ Token expires in: ${daysLeft}d ${hoursLeft}h`);
        
        if (daysLeft < 7) {
          console.log("⚠️  Token will expire soon. Use this tool to refresh it!");
        }
        
        // Check if refresh token exists
        if (token.refresh_token) {
          console.log("✅ Refresh token exists - will auto-refresh on expiry");
        } else {
          console.log("❌ No refresh token! Regenerate with consent prompt.");
        }
      } else {
        console.log("❌ Token has expired!");
      }
    }
    
    if (token.refresh_token) {
      console.log("\n📋 Your Refresh Token (for GitHub Secrets):");
      console.log("=".repeat(60));
      console.log(token.refresh_token);
      console.log("=".repeat(60));
    }
  } catch {
    console.log("❌ No token found. Run the generator first.");
  }
}

// === MAIN ===

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || "help";

  switch (command) {
    case "web":
      // Phone-friendly web method
      console.log("\n📱 PHONE-FRIENDLY TOKEN GENERATOR\n");
      console.log("This starts a web server you can access from your phone.\n");
      await getTokenWeb();
      break;
      
    case "phone":
      // Phone-friendly terminal method
      await getTokenFromServer();
      break;
      
    case "check":
      // Check token status
      console.log("\n🔍 CHECKING TOKEN STATUS\n");
      await checkTokenExpiry();
      break;
      
    case "save":
      // Save credentials
      if (args[1] && args[2]) {
        await saveCredentials({
          clientId: args[1],
          clientSecret: args[2],
          redirectUri: args[3] || "http://localhost:3000/api/youtube/callback",
        });
        console.log("\n✅ Credentials saved to " + CLIENT_ID_FILE);
      } else {
        console.log("Usage: node getYoutubeTokenPhone.js save <client_id> <client_secret>");
      }
      break;
      
    default:
      console.log("\n🎯 YouTube Token Manager - Works on Phone!\n");
      console.log("Commands:");
      console.log("  phone       - Get token via clipboard (paste URL on phone)");
      console.log("  web         - Start web server (access from phone browser)");
      console.log("  check       - Check token expiry status");
      console.log("  save <id> <secret> - Save your API credentials\n");
      console.log("EXAMPLE:");
      console.log("  node scripts/getYoutubeTokenPhone.js phone\n");
      
      // Run phone method by default
      console.log("Running phone method...\n");
      await getTokenFromServer();
  }
  
  // Ensure we exit properly
  if (server) {
    server.close();
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  if (server) server.close();
  process.exit(1);
});