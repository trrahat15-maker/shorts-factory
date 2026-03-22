import fs from "fs";
import ffmpeg from "fluent-ffmpeg";
import ffmpegStatic from "ffmpeg-static";
import ffprobeStatic from "ffprobe-static";
import path from "path";

function resolveBinaryPath(envKey, fallbackPath) {
  const envPath = process.env[envKey];
  if (envPath && fs.existsSync(envPath)) return envPath;
  if (fallbackPath && fs.existsSync(fallbackPath)) return fallbackPath;
  return "";
}

const systemFfmpeg = resolveBinaryPath(
  "FFMPEG_PATH",
  process.platform === "win32" ? "" : "/usr/bin/ffmpeg"
);
const systemFfprobe = resolveBinaryPath(
  "FFPROBE_PATH",
  process.platform === "win32" ? "" : "/usr/bin/ffprobe"
);
const ffmpegPath = systemFfmpeg || (typeof ffmpegStatic === "string" ? ffmpegStatic : ffmpegStatic.path);
const ffprobePath = systemFfprobe || (typeof ffprobeStatic === "string" ? ffprobeStatic : ffprobeStatic.path);
if (ffmpegPath) ffmpeg.setFfmpegPath(ffmpegPath);
if (ffprobePath) ffmpeg.setFfprobePath(ffprobePath);

function sanitizeTitle(title) {
  return title ? title.replace(/[^a-zA-Z0-9-_ ]/g, "").trim().replace(/\s+/g, "-") : `short-${Date.now()}`;
}

function splitScriptToSentences(script) {
  if (!script) return [];
  return script
    .split(/(?<=[.?!])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

async function getMediaDuration(filePath) {
  if (!filePath) return null;
  return new Promise((resolve) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) return resolve(null);
      const duration = metadata?.format?.duration;
      resolve(typeof duration === "number" ? duration : null);
    });
  });
}

function buildTimedSubtitles(script, totalDuration) {
  const sentences = splitScriptToSentences(script);
  if (!sentences.length) return [];
  const words = sentences.map((s) => s.split(/\s+/).filter(Boolean).length);
  const totalWords = words.reduce((acc, n) => acc + n, 0) || 1;
  const fallbackWps = 2.6;
  const duration = totalDuration || totalWords / fallbackWps;

  let cursor = 0;
  return sentences.map((text, idx) => {
    const portion = words[idx] / totalWords;
    const segDuration = Math.max(1.2, duration * portion);
    const start = cursor;
    const end = Math.min(duration, start + segDuration);
    cursor = end;
    return { text, start, end };
  });
}

function escapeDrawtext(text) {
  return (text || "")
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/:/g, "\\:")
    .replace(/\n/g, "\\n");
}

function buildSubtitleFilters(subtitles, style = {}) {
  if (!Array.isArray(subtitles) || subtitles.length === 0) return [];
  const fadeIn = 0.2;
  const fadeOut = 0.25;
  const fontSize = Number(style.fontSize) || 64;
  const outline = Number(style.outline) || 4;

  return subtitles.map((s) => {
    const text = escapeDrawtext(s.text || "");
    const start = Number(s.start ?? 0);
    const end = Number(s.end ?? start + 2.5);
    const alpha = `if(lt(t,${start}),0,` +
      `if(lt(t,${start + fadeIn}),(t-${start})/${fadeIn},` +
      `if(lt(t,${Math.max(start + fadeIn, end - fadeOut)}),1,` +
      `if(lt(t,${end}),(${end}-t)/${fadeOut},0))))`;
    return `drawtext=fontsize=${fontSize}:fontcolor=white:borderw=${outline}:bordercolor=black:line_spacing=10:x=(w-text_w)/2:y=h-220:alpha='${alpha}':text='${text}'`;
  });
}

function shouldRetryWithoutSubtitles(err) {
  const message = `${err?.message || ""} ${err?.stderr || ""}`.toLowerCase();
  return (
    message.includes("no such filter") ||
    message.includes("filter not found") ||
    message.includes("drawtext")
  );
}

export async function generateVideo({
  baseVideoPath,
  voicePath,
  subtitles,
  script,
  outDir,
  title,
  musicPath,
  musicVolume,
  maxDuration,
  subtitleStyle,
}) {
  const safeTitle = sanitizeTitle(title);
  const outputFileName = `${safeTitle || "short"}-${Date.now()}.mp4`;
  const outputPath = path.join(outDir, outputFileName);

  let computedSubtitles = subtitles;
  if ((!computedSubtitles || computedSubtitles.length === 0) && script) {
    const audioDuration = await getMediaDuration(voicePath);
    computedSubtitles = buildTimedSubtitles(script, audioDuration);
  }

  const subtitleFilters = buildSubtitleFilters(computedSubtitles, subtitleStyle);
  const baseFilters = [
    "scale=1080:1920:force_original_aspect_ratio=increase",
    "crop=1080:1920",
    "setsar=1",
  ];
  const videoFilters = baseFilters.concat(subtitleFilters);

  const runFfmpeg = (filters) =>
    new Promise((resolve, reject) => {
      const command = ffmpeg()
        .input(baseVideoPath)
        .inputOptions(["-stream_loop", "-1"]);

      if (voicePath) {
        command.input(voicePath);
      }

      if (musicPath) {
        command.input(musicPath).inputOptions(["-stream_loop", "-1"]);
      }

      command.videoFilters(filters.join(","));

      const maps = ["0:v"];
      const complexFilters = [];
      const bgVolume = typeof musicVolume === "number" ? musicVolume : 0.18;
      if (voicePath && musicPath) {
        complexFilters.push("[1:a]volume=1.0[voice]");
        complexFilters.push(`[2:a]volume=${bgVolume}[music]`);
        complexFilters.push("[voice][music]amix=inputs=2:duration=first:dropout_transition=0[aout]");
        maps.push("[aout]");
      } else if (voicePath) {
        maps.push("1:a");
      } else if (musicPath) {
        complexFilters.push(`[1:a]volume=${bgVolume}[aout]`);
        maps.push("[aout]");
      }

      if (complexFilters.length) {
        command.complexFilter(complexFilters);
      }

      maps.forEach((map) => {
        command.outputOptions(["-map", map]);
      });

      const outputOptions = [
        "-preset veryfast",
        "-crf 23",
        "-movflags +faststart",
        "-shortest",
        "-r 30",
      ];
      command.outputOptions(outputOptions);
      if (maxDuration) {
        command.outputOptions(["-t", `${Number(maxDuration)}`]);
      }

      command
        .output(outputPath)
        .on("error", (err) => reject(err))
        .on("end", () => resolve(outputPath))
        .run();
    });

  try {
    return await runFfmpeg(videoFilters);
  } catch (err) {
    if (subtitleFilters.length && shouldRetryWithoutSubtitles(err)) {
      console.warn("[video] Subtitles filter failed. Retrying without subtitles.");
      return runFfmpeg(baseFilters);
    }
    throw err;
  }
}

export { getMediaDuration };
