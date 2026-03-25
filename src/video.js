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
  if (!title) return `short-${Date.now()}`;
  const safe = title
    .replace(/[^a-zA-Z0-9-_ ]/g, "")
    .trim()
    .replace(/\s+/g, "-");
  const maxLen = 80;
  return safe.length > maxLen ? safe.slice(0, maxLen) : safe;
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

function normalizeWord(word) {
  return word.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

function buildExtraEffects({ enabled, includeEq, grade }) {
  if (!enabled) return [];
  const filters = [];
  if (Math.random() < 0.35) filters.push("hflip");
  const allowVFlip = process.env.ALLOW_VFLIP?.toLowerCase() === "true";
  if (allowVFlip && Math.random() < 0.08) filters.push("vflip");
  if (Math.random() < 0.35) filters.push("vignette");
  if (Math.random() < 0.3) filters.push("unsharp=5:5:0.8:5:5:0.0");
  if (includeEq) {
    const contrast = grade?.contrast ?? randomBetween(0.96, 1.1);
    const brightness = grade?.brightness ?? randomBetween(-0.05, 0.05);
    const saturation = grade?.saturation ?? randomBetween(0.9, 1.15);
    filters.push(`eq=contrast=${contrast}:brightness=${brightness}:saturation=${saturation}`);
  }
  return filters;
}

function pickColorGradePreset() {
  const presetRaw = (process.env.COLOR_GRADE_PRESET || "auto").toLowerCase();
  const presets = ["warm", "cool", "vivid", "cinematic", "punchy", "soft"];
  const preset = presetRaw === "auto" ? presets[Math.floor(Math.random() * presets.length)] : presetRaw;
  switch (preset) {
    case "warm":
      return { contrast: 1.08, brightness: 0.02, saturation: 1.18 };
    case "cool":
      return { contrast: 1.04, brightness: -0.01, saturation: 1.05 };
    case "cinematic":
      return { contrast: 1.1, brightness: -0.02, saturation: 0.95 };
    case "punchy":
      return { contrast: 1.16, brightness: 0.03, saturation: 1.25 };
    case "soft":
      return { contrast: 0.98, brightness: 0.02, saturation: 0.95 };
    case "vivid":
    default:
      return { contrast: 1.12, brightness: 0.01, saturation: 1.22 };
  }
}

function buildTimedSubtitles(script, totalDuration, options = {}) {
  const mode = options.mode || "sentence";
  const highlightWords = Array.isArray(options.highlightWords) ? options.highlightWords : [];
  const highlightSet = new Set(highlightWords.map((w) => normalizeWord(w)));

  if (mode === "word") {
    const words = script.split(/\s+/).map((w) => w.trim()).filter(Boolean);
    if (!words.length) return [];
    const fallbackWps = 2.6;
    const duration = totalDuration || words.length / fallbackWps;
    const punctWeight = Number(process.env.SUBTITLE_PUNCT_WEIGHT || "0.35");
    const weights = words.map((word) => (/[.!?]$/.test(word) ? 1 + punctWeight : 1));
    const totalWeight = weights.reduce((acc, n) => acc + n, 0) || 1;
    let cursor = 0;
    return words.map((word, idx) => {
      const clean = normalizeWord(word);
      const seg = (duration * weights[idx]) / totalWeight;
      const start = cursor;
      const end = Math.min(duration, start + seg);
      cursor = end;
      return {
        text: word,
        start,
        end,
        highlight: highlightSet.has(clean),
      };
    });
  }

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
    const highlight = highlightWords.some((word) => text.toLowerCase().includes(word.toLowerCase()));
    return { text, start, end, highlight };
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
  const yOffset = Number(style.yOffset) || 220;
  const baseColor = style.fontColor || "white";
  const highlightColor = style.highlightColor || "yellow";
  const glow = style.glow !== false;
  const shadow = glow ? "shadowcolor=black@0.7:shadowx=2:shadowy=2:" : "";

  return subtitles.map((s) => {
    const text = escapeDrawtext(s.text || "");
    const start = Number(s.start ?? 0);
    const end = Number(s.end ?? start + 2.5);
    const color = s.highlight ? highlightColor : baseColor;
    const alpha = `if(lt(t,${start}),0,` +
      `if(lt(t,${start + fadeIn}),(t-${start})/${fadeIn},` +
      `if(lt(t,${Math.max(start + fadeIn, end - fadeOut)}),1,` +
      `if(lt(t,${end}),(${end}-t)/${fadeOut},0))))`;
    return `drawtext=fontsize=${fontSize}:fontcolor=${color}:${shadow}borderw=${outline}:bordercolor=black:line_spacing=10:x=(w-text_w)/2:y=h-${yOffset}:alpha='${alpha}':text='${text}'`;
  });
}

function buildHookFilter(hookText, style = {}) {
  if (!hookText) return "";
  const safeText = escapeDrawtext(hookText);
  const fontSize = Number(style.hookSize) || 88;
  const outline = Number(style.hookOutline) || 6;
  const yPos = Number(style.hookY) || 140;
  const glow = style.glow !== false;
  const shadow = glow ? "shadowcolor=black@0.7:shadowx=3:shadowy=3:" : "";
  const alpha = "if(lt(t,0.1),0,if(lt(t,2),1,0))";
  return `drawtext=fontsize=${fontSize}:fontcolor=white:${shadow}borderw=${outline}:bordercolor=black:x=(w-text_w)/2:y=${yPos}:alpha='${alpha}':text='${safeText}'`;
}

function buildKeywordPopups(keywords, duration, style = {}) {
  if (!Array.isArray(keywords) || keywords.length === 0 || !duration) return [];
  const maxPopups = Math.min(3, keywords.length);
  const interval = duration / (maxPopups + 1);
  const fontSize = Number(style.popupSize) || 70;
  const outline = Number(style.popupOutline) || 6;
  const color = style.popupColor || "white";
  const glow = style.glow !== false;
  const shadow = glow ? "shadowcolor=black@0.7:shadowx=3:shadowy=3:" : "";
  const popups = [];
  for (let i = 0; i < maxPopups; i += 1) {
    const start = Math.max(0.5, interval * (i + 1) - 0.4);
    const end = Math.min(duration, start + 0.9);
    const text = escapeDrawtext(String(keywords[i]).toUpperCase());
    const alpha = `if(between(t,${start},${end}),1,0)`;
    popups.push(
      `drawtext=fontsize=${fontSize}:fontcolor=${color}:${shadow}borderw=${outline}:bordercolor=black:x=(w-text_w)/2:y=h-420:alpha='${alpha}':text='${text}'`
    );
  }
  return popups;
}

function buildWatermarkFilter(text) {
  if (!text) return "";
  const safe = escapeDrawtext(text);
  return `drawtext=fontsize=32:fontcolor=white@0.6:shadowcolor=black@0.5:shadowx=2:shadowy=2:borderw=1:bordercolor=black@0.6:x=w-text_w-24:y=h-text_h-24:text='${safe}'`;
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
  minDuration,
  subtitleStyle,
  subtitleMode,
  highlightWords,
  hookText,
  keywordPopups,
  watermarkText,
}) {
  const safeTitle = sanitizeTitle(title);
  const outputFileName = `${safeTitle || "short"}-${Date.now()}.mp4`;
  const outputPath = path.join(outDir, outputFileName);

  const audioDuration = voicePath ? await getMediaDuration(voicePath) : null;
  const baseDuration = baseVideoPath ? await getMediaDuration(baseVideoPath) : null;
  const minTarget = Number(minDuration) || 0;
  const targetDuration =
    minTarget && audioDuration && audioDuration < minTarget ? minTarget : audioDuration || minTarget || null;
  const randomizeStart = process.env.VIDEO_RANDOM_START?.toLowerCase() !== "false";
  const needsLoop = !targetDuration || !baseDuration || baseDuration < targetDuration + 0.5;
  let startOffset = 0;
  if (randomizeStart && baseDuration && audioDuration && baseDuration > audioDuration + 1) {
    const maxStart = Math.max(0, baseDuration - audioDuration - 0.5);
    startOffset = Math.random() * maxStart;
  }

  let computedSubtitles = subtitles;
  if ((!computedSubtitles || computedSubtitles.length === 0) && script) {
    computedSubtitles = buildTimedSubtitles(script, targetDuration || audioDuration, {
      mode: subtitleMode || "sentence",
      highlightWords: highlightWords || [],
    });
  }

  const colorGrade = pickColorGradePreset();
  const subtitleFilters = buildSubtitleFilters(computedSubtitles, subtitleStyle);
  const hookFilter = buildHookFilter(hookText, subtitleStyle);
  const popupFilters = buildKeywordPopups(
    Array.isArray(keywordPopups) ? keywordPopups : [],
    targetDuration || audioDuration,
    subtitleStyle
  );
  const watermarkFilter = buildWatermarkFilter(watermarkText);
  const coldOpen = process.env.COLD_OPEN?.toLowerCase() !== "false";
  const coldOpenFilter = coldOpen
    ? "eq=brightness=0.18:enable='lt(t,0.25)'"
    : "";
  const extraEffectsEnabled = process.env.EXTRA_EFFECTS?.toLowerCase() !== "false";
  const gradeFilter = extraEffectsEnabled
    ? `eq=contrast=${colorGrade.contrast}:brightness=${colorGrade.brightness}:saturation=${colorGrade.saturation}`
    : "";
  const extraFilters = buildExtraEffects({ enabled: extraEffectsEnabled, includeEq: false, grade: colorGrade });
  const baseFilters = [
    "scale=1080:1920:force_original_aspect_ratio=increase",
    "crop=1080:1920",
    "setsar=1",
  ];
  const videoFilters = baseFilters
    .concat(coldOpenFilter ? [coldOpenFilter] : [])
    .concat(gradeFilter ? [gradeFilter] : [])
    .concat(extraFilters)
    .concat(subtitleFilters)
    .concat(hookFilter ? [hookFilter] : [])
    .concat(popupFilters)
    .concat(watermarkFilter ? [watermarkFilter] : []);

  const runFfmpeg = (filters, enableDucking = true) =>
    new Promise((resolve, reject) => {
      const baseInputOptions = [];
      if (startOffset > 0) {
        baseInputOptions.push("-ss", `${startOffset}`);
      }
      if (needsLoop) {
        baseInputOptions.push("-stream_loop", "-1");
      } else if (audioDuration) {
        baseInputOptions.push("-t", `${audioDuration}`);
      }

      const command = ffmpeg().input(baseVideoPath).inputOptions(baseInputOptions);

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
      const padTo = Number(minDuration) || 0;
      if (voicePath && musicPath) {
        const ducking = enableDucking && process.env.AUDIO_DUCKING?.toLowerCase() !== "false";
        const trimSilence = process.env.TRIM_SILENCE?.toLowerCase() !== "false";
        const silenceThresh = process.env.SILENCE_THRESHOLD || "-30dB";
        const silenceDuration = process.env.SILENCE_DURATION || "0.2";
        const needsPad = padTo && audioDuration && audioDuration < padTo;
        const padFilter = needsPad ? `apad,atrim=duration=${padTo}` : "anull";
        const voiceFilter = trimSilence
          ? `silenceremove=start_periods=1:start_duration=${silenceDuration}:start_threshold=${silenceThresh}:stop_periods=1:stop_duration=${silenceDuration}:stop_threshold=${silenceThresh},${padFilter}`
          : padFilter;
        if (ducking) {
          complexFilters.push(`[1:a]${voiceFilter},volume=1.0[voice]`);
          complexFilters.push("[2:a]volume=1.0[music]");
          complexFilters.push("[music][voice]sidechaincompress=threshold=0.05:ratio=8:attack=20:release=200[ducked]");
          complexFilters.push(`[ducked]volume=${bgVolume}[duckedmix]`);
          complexFilters.push("[voice][duckedmix]amix=inputs=2:duration=first:dropout_transition=0[aout]");
        } else {
          complexFilters.push(`[1:a]${voiceFilter},volume=1.0[voice]`);
          complexFilters.push(`[2:a]volume=${bgVolume}[music]`);
          complexFilters.push("[voice][music]amix=inputs=2:duration=first:dropout_transition=0[aout]");
        }
        maps.push("[aout]");
      } else if (voicePath) {
        const trimSilence = process.env.TRIM_SILENCE?.toLowerCase() !== "false";
        const silenceThresh = process.env.SILENCE_THRESHOLD || "-30dB";
        const silenceDuration = process.env.SILENCE_DURATION || "0.2";
        const needsPad = padTo && audioDuration && audioDuration < padTo;
        const padFilter = needsPad ? `apad,atrim=duration=${padTo}` : "anull";
        if (trimSilence || needsPad) {
          complexFilters.push(
            `[1:a]${trimSilence
              ? `silenceremove=start_periods=1:start_duration=${silenceDuration}:start_threshold=${silenceThresh}:stop_periods=1:stop_duration=${silenceDuration}:stop_threshold=${silenceThresh},${padFilter}`
              : padFilter}[aout]`
          );
          maps.push("[aout]");
        } else {
          maps.push("1:a");
        }
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
      if (minDuration && Number(minDuration) > 0) {
        outputOptions.push("-t", `${Number(minDuration)}`);
      }
      const limiter = process.env.AUDIO_LIMITER?.toLowerCase() !== "false";
      if (limiter) {
        command.audioFilters("alimiter=limit=0.95");
      }
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
    return await runFfmpeg(videoFilters, true);
  } catch (err) {
    if (process.env.AUDIO_DUCKING?.toLowerCase() !== "false") {
      console.warn("[video] Audio ducking failed, retrying without ducking.");
      try {
        return await runFfmpeg(videoFilters, false);
      } catch (innerErr) {
        err = innerErr;
      }
    }
    if (subtitleFilters.length && shouldRetryWithoutSubtitles(err)) {
      console.warn("[video] Subtitles filter failed. Retrying without subtitles.");
      return runFfmpeg(baseFilters, false);
    }
    throw err;
  }
}

export { getMediaDuration };

function buildSceneFilters({ addGradient = true, applyEffects = true, isImage = false, duration = 3 } = {}) {
  const grade = pickColorGradePreset();
  const contrast = applyEffects ? grade.contrast : 1;
  const brightness = applyEffects ? grade.brightness : 0;
  const saturation = applyEffects ? grade.saturation : 1;

  const blur = "boxblur=20:1";
  const base = "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920";
  const fg = "scale=1080:1920:force_original_aspect_ratio=decrease";

  const frames = Math.max(1, Math.round(duration * 30));
  const zoom = 1.12;
  const enableSceneZoom = process.env.SCENE_ZOOM?.toLowerCase() !== "false";
  const source = isImage || enableSceneZoom
    ? `[0:v]zoompan=z='min(zoom+0.0015,${zoom})':d=${frames}:s=1080x1920:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'[src];`
    : "[0:v]setpts=PTS-STARTPTS[src];";

  const extraFilters = buildExtraEffects({ enabled: applyEffects, includeEq: false, grade });
  let chain =
    source +
    `[src]${base},${blur}[bg];` +
    `[src]${fg}[fg];` +
    `[bg][fg]overlay=(W-w)/2:(H-h)/2,format=yuv420p`;
  if (applyEffects) {
    chain += `,eq=contrast=${contrast}:brightness=${brightness}:saturation=${saturation}`;
  }
  if (extraFilters.length) {
    chain += `,${extraFilters.join(",")}`;
  }
  chain += "[v0]";

  if (addGradient) {
    chain +=
      ";color=c=black@0.0:s=1080x1920:d=1,format=rgba,geq=a='if(gt(Y,H*0.6),(Y-H*0.6)/(H*0.4)*0.35,0)'[grad];" +
      "[v0][grad]overlay=0:0[v0]";
  }

  return chain;
}

async function renderSceneVideo({
  inputPath,
  duration,
  outPath,
  isImage = false,
  addGradient = true,
  applyEffects = true,
}) {
  const buildSimpleFilters = () => {
    if (isImage) {
      const frames = Math.max(1, Math.round(duration * 30));
      return [
        `zoompan=z='min(zoom+0.0015,1.12)':d=${frames}:s=1080x1920:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'`,
        "scale=1080:1920:force_original_aspect_ratio=increase",
        "crop=1080:1920",
        "format=yuv420p",
      ];
    }
    return [
      "scale=1080:1920:force_original_aspect_ratio=increase",
      "crop=1080:1920",
      "format=yuv420p",
    ];
  };

  const runWithFilters = ({ inputOptions, useComplex, withGradient, withEffects }) =>
    new Promise((resolve, reject) => {
      const command = ffmpeg();
      const baseInputOptions = inputOptions || [];
      if (isImage) {
        command.input(inputPath).inputOptions(["-loop", "1", ...baseInputOptions]);
      } else {
        command.input(inputPath).inputOptions([...baseInputOptions, "-stream_loop", "-1"]);
      }

      if (useComplex) {
        const sceneFilter = buildSceneFilters({
          addGradient: withGradient,
          applyEffects: withEffects,
          isImage,
          duration,
        });
        command.complexFilter(sceneFilter);
        command.outputOptions(["-map", "[v0]"]);
      } else {
        command.videoFilters(buildSimpleFilters().join(","));
      }

      command
        .outputOptions([
          "-preset",
          "veryfast",
          "-crf",
          "23",
          "-pix_fmt",
          "yuv420p",
          "-r",
          "30",
          "-t",
          `${duration}`,
        ])
        .output(outPath)
        .on("end", () => resolve(outPath))
        .on("error", (err) => reject(err))
        .run();
    });

  const inputDuration = !isImage ? await getMediaDuration(inputPath) : null;
  const startOffset =
    inputDuration && inputDuration > duration + 0.5
      ? Math.random() * Math.max(0, inputDuration - duration - 0.5)
      : 0;
  const inputOptions = startOffset > 0 ? ["-ss", `${startOffset}`] : [];

  try {
    return await runWithFilters({
      inputOptions,
      useComplex: true,
      withGradient: addGradient,
      withEffects: applyEffects,
    });
  } catch (err) {
    if (addGradient) {
      console.warn("[video] Gradient overlay failed, retrying without gradient.");
      try {
        return await runWithFilters({
          inputOptions,
          useComplex: true,
          withGradient: false,
          withEffects: applyEffects,
        });
      } catch (innerErr) {
        err = innerErr;
      }
    }
    if (applyEffects) {
      console.warn("[video] Effect filters failed, retrying without effects.");
      try {
        return await runWithFilters({
          inputOptions,
          useComplex: true,
          withGradient: false,
          withEffects: false,
        });
      } catch (innerErr) {
        err = innerErr;
      }
    }
    console.warn("[video] Complex filters failed, retrying with simple filters.");
    return runWithFilters({
      inputOptions,
      useComplex: false,
      withGradient: false,
      withEffects: false,
    });
  }
}

async function concatScenes(scenePaths, outPath) {
  const listPath = path.join(path.dirname(outPath), `concat-${Date.now()}.txt`);
  const list = scenePaths.map((file) => `file '${file.replace(/'/g, "'\\''")}'`).join("\n");
  fs.writeFileSync(listPath, list);

  const attemptConcat = (reencode) =>
    new Promise((resolve, reject) => {
      const command = ffmpeg()
        .input(listPath)
        .inputOptions(["-f", "concat", "-safe", "0"]);

      if (reencode) {
        command.outputOptions(["-c:v", "libx264", "-pix_fmt", "yuv420p", "-r", "30"]);
      } else {
        command.outputOptions(["-c", "copy"]);
      }

      command
        .output(outPath)
        .on("end", () => resolve(outPath))
        .on("error", (err) => reject(err))
        .run();
    });

  try {
    return await attemptConcat(false);
  } catch (err) {
    console.warn("[video] concat copy failed, re-encoding.");
    return attemptConcat(true);
  }
}

export async function generateStockBaseVideo({ scenes, outDir, totalDuration }) {
  if (!Array.isArray(scenes) || scenes.length === 0) {
    throw new Error("No stock scenes provided.");
  }

  const tempScenes = [];
  const wordCounts = scenes.map((scene) => (scene?.text || "").split(/\s+/).filter(Boolean).length || 1);
  const totalWords = wordCounts.reduce((acc, n) => acc + n, 0) || 1;

  const splitDuration = (duration) => {
    const minCut = Number(process.env.CLIP_MIN_SECONDS || "1.5");
    const maxCut = Number(process.env.CLIP_MAX_SECONDS || "3");
    const targetCut = Number(process.env.CLIP_TARGET_SECONDS || "2.3");
    const beatSync = process.env.BEAT_SYNC?.toLowerCase() !== "false";
    const bpm = Number(process.env.MUSIC_BPM || "0");
    const beat = beatSync && Number.isFinite(bpm) && bpm > 30 ? 60 / bpm : 0;
    let segments = Math.max(1, Math.round(duration / targetCut));
    segments = Math.max(segments, Math.ceil(duration / maxCut));
    segments = Math.min(segments, Math.max(1, Math.floor(duration / minCut)));

    const parts = [];
    let remaining = duration;
    for (let i = 0; i < segments; i += 1) {
      const remainingSegs = segments - i;
      const minAllowed = Math.max(minCut, remaining - maxCut * (remainingSegs - 1));
      const maxAllowed = Math.min(maxCut, remaining - minCut * (remainingSegs - 1));
      let seg = i === segments - 1 ? remaining : randomBetween(minAllowed, maxAllowed);
      if (beat) {
        const beats = Math.max(1, Math.round(seg / beat));
        seg = Math.min(maxAllowed, Math.max(minAllowed, beats * beat));
      }
      parts.push(seg);
      remaining -= seg;
    }
    return parts;
  };

  let remaining = totalDuration || 30;
  for (let i = 0; i < scenes.length; i += 1) {
    const scene = scenes[i];
    const portion = wordCounts[i] / totalWords;
    const duration = i === scenes.length - 1 ? remaining : Math.max(3, remaining * portion);
    remaining = Math.max(0, remaining - duration);

    if (scene.type === "images" && Array.isArray(scene.paths) && scene.paths.length) {
      const segments = splitDuration(duration);
      for (let j = 0; j < segments.length; j += 1) {
        const image = scene.paths[j % scene.paths.length];
        const outPath = path.join(outDir, `scene-${i + 1}-${j + 1}.mp4`);
        // eslint-disable-next-line no-await-in-loop
        await renderSceneVideo({
          inputPath: image,
          duration: segments[j],
          outPath,
          isImage: true,
          addGradient: true,
          applyEffects: true,
        });
        tempScenes.push(outPath);
      }
    } else if (scene.type === "video" && scene.path) {
      const segments = splitDuration(duration);
      for (let j = 0; j < segments.length; j += 1) {
        const outPath = path.join(outDir, `scene-${i + 1}-${j + 1}.mp4`);
        // eslint-disable-next-line no-await-in-loop
        await renderSceneVideo({
          inputPath: scene.path,
          duration: segments[j],
          outPath,
          isImage: false,
          addGradient: true,
          applyEffects: true,
        });
        tempScenes.push(outPath);
      }
    }
  }

  if (!tempScenes.length) {
    throw new Error("Unable to render any stock scenes.");
  }

  const mergedPath = path.join(outDir, `stock-base-${Date.now()}.mp4`);
  return concatScenes(tempScenes, mergedPath);
}
