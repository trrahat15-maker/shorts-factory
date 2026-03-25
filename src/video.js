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

function normalizeWord(word) {
  return word.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

function buildExtraEffects({ enabled, includeEq }) {
  if (!enabled) return [];
  const filters = [];
  if (Math.random() < 0.35) filters.push("hflip");
  if (Math.random() < 0.08) filters.push("vflip");
  if (Math.random() < 0.35) filters.push("vignette");
  if (Math.random() < 0.3) filters.push("unsharp=5:5:0.8:5:5:0.0");
  if (includeEq) {
    const contrast = randomBetween(0.96, 1.1);
    const brightness = randomBetween(-0.05, 0.05);
    const saturation = randomBetween(0.9, 1.15);
    filters.push(`eq=contrast=${contrast}:brightness=${brightness}:saturation=${saturation}`);
  }
  return filters;
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
    const perWord = duration / words.length;
    return words.map((word, idx) => {
      const clean = normalizeWord(word);
      return {
        text: word,
        start: idx * perWord,
        end: Math.min(duration, (idx + 1) * perWord),
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

  return subtitles.map((s) => {
    const text = escapeDrawtext(s.text || "");
    const start = Number(s.start ?? 0);
    const end = Number(s.end ?? start + 2.5);
    const color = s.highlight ? highlightColor : baseColor;
    const alpha = `if(lt(t,${start}),0,` +
      `if(lt(t,${start + fadeIn}),(t-${start})/${fadeIn},` +
      `if(lt(t,${Math.max(start + fadeIn, end - fadeOut)}),1,` +
      `if(lt(t,${end}),(${end}-t)/${fadeOut},0))))`;
    return `drawtext=fontsize=${fontSize}:fontcolor=${color}:borderw=${outline}:bordercolor=black:line_spacing=10:x=(w-text_w)/2:y=h-${yOffset}:alpha='${alpha}':text='${text}'`;
  });
}

function buildHookFilter(hookText, style = {}) {
  if (!hookText) return "";
  const safeText = escapeDrawtext(hookText);
  const fontSize = Number(style.hookSize) || 88;
  const outline = Number(style.hookOutline) || 6;
  const yPos = Number(style.hookY) || 140;
  const alpha = "if(lt(t,0.1),0,if(lt(t,2),1,0))";
  return `drawtext=fontsize=${fontSize}:fontcolor=white:borderw=${outline}:bordercolor=black:x=(w-text_w)/2:y=${yPos}:alpha='${alpha}':text='${safeText}'`;
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
  subtitleMode,
  highlightWords,
  hookText,
}) {
  const safeTitle = sanitizeTitle(title);
  const outputFileName = `${safeTitle || "short"}-${Date.now()}.mp4`;
  const outputPath = path.join(outDir, outputFileName);

  const audioDuration = voicePath ? await getMediaDuration(voicePath) : null;
  const baseDuration = baseVideoPath ? await getMediaDuration(baseVideoPath) : null;
  const randomizeStart = process.env.VIDEO_RANDOM_START?.toLowerCase() !== "false";
  const needsLoop = !audioDuration || !baseDuration || baseDuration < audioDuration + 0.5;
  let startOffset = 0;
  if (randomizeStart && baseDuration && audioDuration && baseDuration > audioDuration + 1) {
    const maxStart = Math.max(0, baseDuration - audioDuration - 0.5);
    startOffset = Math.random() * maxStart;
  }

  let computedSubtitles = subtitles;
  if ((!computedSubtitles || computedSubtitles.length === 0) && script) {
    computedSubtitles = buildTimedSubtitles(script, audioDuration, {
      mode: subtitleMode || "sentence",
      highlightWords: highlightWords || [],
    });
  }

  const subtitleFilters = buildSubtitleFilters(computedSubtitles, subtitleStyle);
  const hookFilter = buildHookFilter(hookText, subtitleStyle);
  const extraEffectsEnabled = process.env.EXTRA_EFFECTS?.toLowerCase() !== "false";
  const extraFilters = buildExtraEffects({ enabled: extraEffectsEnabled, includeEq: true });
  const baseFilters = [
    "scale=1080:1920:force_original_aspect_ratio=increase",
    "crop=1080:1920",
    "setsar=1",
  ];
  const videoFilters = baseFilters
    .concat(extraFilters)
    .concat(subtitleFilters)
    .concat(hookFilter ? [hookFilter] : []);

  const runFfmpeg = (filters) =>
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

function buildSceneFilters({ addGradient = true, applyEffects = true, isImage = false, duration = 3 } = {}) {
  const contrast = applyEffects ? randomBetween(0.95, 1.1) : 1;
  const brightness = applyEffects ? randomBetween(-0.04, 0.04) : 0;
  const saturation = applyEffects ? randomBetween(0.9, 1.15) : 1;

  const blur = "boxblur=20:1";
  const base = "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920";
  const fg = "scale=1080:1920:force_original_aspect_ratio=decrease";

  const frames = Math.max(1, Math.round(duration * 30));
  const zoom = 1.12;
  const source = isImage
    ? `[0:v]zoompan=z='min(zoom+0.0015,${zoom})':d=${frames}:s=1080x1920:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'[src];`
    : "[0:v]setpts=PTS-STARTPTS[src];";

  const extraFilters = buildExtraEffects({ enabled: applyEffects, includeEq: false });
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
<<<<<<< HEAD
  const runRender = (withGradient, withEffects) =>
    new Promise((resolve, reject) => {
      const command = ffmpeg();
      if (isImage) {
        command.input(inputPath).inputOptions(["-loop", "1"]);
      } else {
        command.input(inputPath).inputOptions(["-stream_loop", "-1"]);
      }

      const sceneFilter = buildSceneFilters({
        addGradient: withGradient,
        applyEffects: withEffects,
        isImage,
        duration,
      });

      command
        .complexFilter(sceneFilter)
        .outputOptions([
          "-map",
          "[v0]",
=======
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
>>>>>>> 49fcae1 (Add safe fallback for scene filters)
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

<<<<<<< HEAD
  try {
    if (!isImage) {
      const inputDuration = await getMediaDuration(inputPath);
      if (inputDuration && inputDuration > duration + 0.5) {
        const maxStart = Math.max(0, inputDuration - duration - 0.5);
        const startOffset = Math.random() * maxStart;
        // rerun with seek by injecting -ss in input options
        return await new Promise((resolve, reject) => {
          const command = ffmpeg()
            .input(inputPath)
            .inputOptions(["-ss", `${startOffset}`, "-stream_loop", "-1"]);

          const sceneFilter = buildSceneFilters({
            addGradient,
            applyEffects,
            isImage,
            duration,
          });

          command
            .complexFilter(sceneFilter)
            .outputOptions([
              "-map",
              "[v0]",
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
      }
    }
    return await runRender(addGradient, applyEffects);
  } catch (err) {
    if (addGradient) {
      console.warn("[video] Gradient overlay failed, retrying without gradient.");
      return runRender(false, applyEffects);
    }
    if (applyEffects) {
      console.warn("[video] Effect filters failed, retrying without effects.");
      return runRender(false, false);
    }
    throw err;
=======
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
      return runWithFilters({
        inputOptions,
        useComplex: true,
        withGradient: false,
        withEffects: applyEffects,
      });
    }
    if (applyEffects) {
      console.warn("[video] Effect filters failed, retrying without effects.");
      return runWithFilters({
        inputOptions,
        useComplex: true,
        withGradient: false,
        withEffects: false,
      });
    }
    console.warn("[video] Complex filters failed, retrying with simple filters.");
    return runWithFilters({
      inputOptions,
      useComplex: false,
      withGradient: false,
      withEffects: false,
    });
>>>>>>> 49fcae1 (Add safe fallback for scene filters)
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
    const segments = [];
    let remaining = duration;
    while (remaining > 0.15) {
      const seg = Math.min(remaining, randomBetween(1.5, 3));
      segments.push(seg);
      remaining -= seg;
    }
    return segments;
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
