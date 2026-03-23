import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import os from "os";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";

const DRIVER = (process.env.STORAGE_DRIVER || "local").toLowerCase();
const BUCKET = process.env.S3_BUCKET || "";
const REGION = process.env.S3_REGION || "auto";
const ENDPOINT = process.env.S3_ENDPOINT || "";
const ACCESS_KEY = process.env.S3_ACCESS_KEY || "";
const SECRET_KEY = process.env.S3_SECRET_KEY || "";

const LOCAL_ROOT = path.join(process.cwd(), "uploads");
const TYPE_PREFIX = {
  base: "base-videos",
  music: "music",
  generated: "generated",
};

function useS3() {
  return DRIVER === "s3";
}

function getPrefix(type) {
  return TYPE_PREFIX[type] || type;
}

function getS3Client() {
  if (!ACCESS_KEY || !SECRET_KEY || !BUCKET) {
    throw new Error("Missing S3_BUCKET/S3_ACCESS_KEY/S3_SECRET_KEY for storage.");
  }
  return new S3Client({
    region: REGION,
    endpoint: ENDPOINT || undefined,
    forcePathStyle: Boolean(ENDPOINT),
    credentials: {
      accessKeyId: ACCESS_KEY,
      secretAccessKey: SECRET_KEY,
    },
  });
}

export async function ensureLocalDirs() {
  if (useS3()) return;
  await fsp.mkdir(path.join(LOCAL_ROOT, "base-videos"), { recursive: true });
  await fsp.mkdir(path.join(LOCAL_ROOT, "music"), { recursive: true });
  await fsp.mkdir(path.join(LOCAL_ROOT, "generated"), { recursive: true });
}

export async function storeFile({ type, localPath, filename, contentType }) {
  const prefix = getPrefix(type);
  if (!useS3()) {
    const destDir = path.join(LOCAL_ROOT, prefix);
    await fsp.mkdir(destDir, { recursive: true });
    const destPath = path.join(destDir, filename);
    await fsp.rename(localPath, destPath);
    return { key: filename };
  }

  const s3 = getS3Client();
  const key = `${prefix}/${filename}`;
  const body = await fsp.readFile(localPath);
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType || "application/octet-stream",
    })
  );
  await fsp.rm(localPath, { force: true });
  return { key: filename };
}

export async function listFiles(type) {
  const prefix = getPrefix(type);
  if (!useS3()) {
    try {
      const dir = path.join(LOCAL_ROOT, prefix);
      return await fsp.readdir(dir);
    } catch {
      return [];
    }
  }

  const s3 = getS3Client();
  const res = await s3.send(
    new ListObjectsV2Command({
      Bucket: BUCKET,
      Prefix: `${prefix}/`,
    })
  );
  const contents = res.Contents || [];
  return contents
    .map((obj) => obj.Key || "")
    .filter(Boolean)
    .map((key) => key.replace(`${prefix}/`, ""))
    .filter(Boolean);
}

export async function getLocalPath(type, filename) {
  if (!useS3()) {
    return path.join(LOCAL_ROOT, getPrefix(type), filename);
  }

  const prefix = getPrefix(type);
  const s3 = getS3Client();
  const key = `${prefix}/${filename}`;
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "sfd-"));
  const tempPath = path.join(tempDir, filename);

  const res = await s3.send(
    new GetObjectCommand({
      Bucket: BUCKET,
      Key: key,
    })
  );
  if (!res.Body) throw new Error("Failed to download object");
  await new Promise((resolve, reject) => {
    const stream = res.Body;
    const write = fs.createWriteStream(tempPath);
    stream.pipe(write);
    stream.on("error", reject);
    write.on("finish", resolve);
    write.on("error", reject);
  });
  return tempPath;
}

export async function streamFile(res, type, filename) {
  const prefix = getPrefix(type);
  if (!useS3()) {
    const filePath = path.join(LOCAL_ROOT, prefix, filename);
    const stream = fs.createReadStream(filePath);
    stream.on("error", () => res.sendStatus(404));
    stream.pipe(res);
    return;
  }

  const s3 = getS3Client();
  const key = `${prefix}/${filename}`;
  const data = await s3.send(
    new GetObjectCommand({
      Bucket: BUCKET,
      Key: key,
    })
  );
  if (data.ContentType) {
    res.setHeader("Content-Type", data.ContentType);
  }
  if (!data.Body) {
    res.sendStatus(404);
    return;
  }
  data.Body.pipe(res);
}

export async function deleteFile(type, filename) {
  const prefix = getPrefix(type);
  if (!useS3()) {
    const filePath = path.join(LOCAL_ROOT, prefix, filename);
    await fsp.rm(filePath, { force: true });
    return;
  }
  const s3 = getS3Client();
  await s3.send(
    new DeleteObjectCommand({
      Bucket: BUCKET,
      Key: `${prefix}/${filename}`,
    })
  );
}
