import fs from "fs/promises";
import path from "path";

const ROOT = process.cwd();
const SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  "uploads",
  "data",
  "dist",
  "build",
  "mobile/node_modules",
]);

const SKIP_EXTS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
  ".mp4",
  ".mov",
  ".mp3",
  ".wav",
  ".zip",
]);

const PATTERNS = [
  /sk-[A-Za-z0-9]{20,}/,
  /sk-or-v1-[A-Za-z0-9]{20,}/,
  /AIza[0-9A-Za-z-_]{20,}/,
  /GOCSPX-[A-Za-z0-9_-]{20,}/,
  /ghp_[A-Za-z0-9]{20,}/,
  /BEGIN PRIVATE KEY/,
  /xoxb-[0-9-]+/,
];

async function walk(dir, files = []) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relPath = path.relative(ROOT, fullPath).replace(/\\/g, "/");
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(relPath)) continue;
      if (Array.from(SKIP_DIRS).some((skip) => relPath.startsWith(skip + "/"))) continue;
      await walk(fullPath, files);
    } else {
      files.push({ fullPath, relPath });
    }
  }
  return files;
}

function isBinaryPath(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return SKIP_EXTS.has(ext);
}

async function scan() {
  const files = await walk(ROOT, []);
  const findings = [];

  for (const file of files) {
    if (isBinaryPath(file.relPath)) continue;
    let content;
    try {
      content = await fs.readFile(file.fullPath, "utf8");
    } catch {
      continue;
    }
    const lines = content.split(/\r?\n/);
    lines.forEach((line, idx) => {
      for (const pattern of PATTERNS) {
        if (pattern.test(line)) {
          findings.push({ file: file.relPath, line: idx + 1, match: line.trim() });
          break;
        }
      }
    });
  }

  if (findings.length) {
    console.error("Secret scan failed. Potential secrets found:");
    findings.slice(0, 10).forEach((hit) => {
      console.error(`- ${hit.file}:${hit.line}`);
    });
    process.exit(1);
  }

  console.log("Secret scan passed.");
}

scan().catch((err) => {
  console.error("Secret scan error:", err.message);
  process.exit(1);
});
