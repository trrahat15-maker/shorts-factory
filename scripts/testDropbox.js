const log = (message) => console.log(`[dropbox-test] ${message}`);

function getEnv(name, fallback = "") {
  const value = process.env[name];
  if (value === undefined || value === null || value === "") return fallback;
  return value;
}

function normalizeDropboxPath(input) {
  if (!input) return "";
  let pathValue = input.trim();
  if (!pathValue.startsWith("/")) pathValue = `/${pathValue}`;
  pathValue = pathValue.replace(/\/+/, "/");
  if (pathValue.length > 1 && pathValue.endsWith("/")) {
    pathValue = pathValue.slice(0, -1);
  }
  return pathValue;
}

function getDropboxFolders() {
  const root = normalizeDropboxPath(getEnv("DROPBOX_SYSTEM_ROOT", "").trim());
  const useSystem = getEnv("DROPBOX_USE_SYSTEM_FOLDERS", "false").toLowerCase() === "true" || Boolean(root);
  if (useSystem) {
    const base = root || "/youtube_ai_system";
    return {
      backup: `${base}/backup_videos`,
      generated: `${base}/generated_videos`,
      used: `${base}/used_videos`,
      logs: `${base}/logs`,
    };
  }
  return {
    backup: normalizeDropboxPath(getEnv("DROPBOX_FOLDER_PATH", "").trim()),
    generated: "",
    used: normalizeDropboxPath(getEnv("DROPBOX_USED_FOLDER_PATH", "").trim()),
    logs: "",
  };
}

async function dropboxFetch(url, token, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body || {}),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Dropbox API error ${res.status}: ${text}`);
  }
  return text ? JSON.parse(text) : {};
}

async function listFolder(token, path) {
  return dropboxFetch("https://api.dropboxapi.com/2/files/list_folder", token, { path });
}

async function run() {
  const token = getEnv("DROPBOX_ACCESS_TOKEN", "").trim();
  if (!token) throw new Error("Missing DROPBOX_ACCESS_TOKEN.");
  const folders = getDropboxFolders();
  const path = folders.backup;
  if (!path) throw new Error("Missing DROPBOX_FOLDER_PATH or DROPBOX_SYSTEM_ROOT.");

  log(`Testing Dropbox access for: ${path}`);
  try {
    const data = await listFolder(token, path);
    const entries = data?.entries || [];
    const files = entries.filter((e) => e?.[".tag"] === "file");
    log(`Success. Found ${files.length} file(s) in ${path}.`);
    if (files.length) {
      log(`Example files: ${files.slice(0, 5).map((f) => f.name).join(", ")}`);
    } else {
      log("Folder is empty. Upload at least one backup video.");
    }
  } catch (err) {
    log(`Failed: ${err.message}`);
    log("Tip: App Folder apps use '/YouTube Videos' (not /Apps/...).");
  }
}

run().catch((err) => {
  console.error("[dropbox-test] Fatal error:", err.message);
  process.exit(1);
});
