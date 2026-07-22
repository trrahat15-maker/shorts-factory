/**
 * FILMORAGO-STYLE TEXT-TO-REEL GENERATOR
 * Creates beautiful short reels from scratch - NO base videos needed
 * 
 * Features:
 * - Animated gradient backgrounds with motion
 * - Professional text animations (fade, slide, scale, typewriter)
 * - Particle effects and visual enhancements
 * - Word-by-word subtitle sync with voice
 * - Auto color grading and effects
 * - Creates vertical 9:16 Shorts/Reels format
 */

import ffmpeg from "fluent-ffmpeg";
import ffmpegStatic from "ffmpeg-static";
import ffprobeStatic from "ffprobe-static";
import path from "path";
import fs from "fs";

// FFmpeg setup
const ffmpegPath = (typeof ffmpegStatic === "string" ? ffmpegStatic : ffmpegStatic?.path) || process.env.FFMPEG_PATH;
const ffprobePath = (typeof ffprobeStatic === "string" ? ffprobeStatic : ffprobeStatic?.path) || process.env.FFPROBE_PATH;
if (ffmpegPath) ffmpeg.setFfmpegPath(ffmpegPath);
if (ffprobePath) ffmpeg.setFfprobePath(ffprobePath);

// ====== COLOR PALETTES FOR BACKGROUNDS ======

const BACKGROUND_THEMES = {
  motivation: {
    gradients: [
      { colors: ["#0f0c29", "#302b63", "#24243e"], mood: "deep" },
      { colors: ["#1a1a2e", "#16213e", "#0f3460"], mood: "royal" },
      { colors: ["#0d0d0d", "#1a1a2e", "#e94560"], mood: "dramatic" },
      { colors: ["#000428", "#004e92"], mood: "ocean" },
      { colors: ["#0b0f1a", "#1c2541", "#3a506b"], mood: "steel" },
    ],
    textColor: "white",
    accentColor: "#FFD700",
  },
  success: {
    gradients: [
      { colors: ["#1a1a2e", "#16213e", "#e94560"], mood: "bold" },
      { colors: ["#0f0f0f", "#1a1a2e", "#533483"], mood: "premium" },
      { colors: ["#000000", "#434343"], mood: "black" },
      { colors: ["#0d1117", "#161b22", "#30363d"], mood: "dark" },
    ],
    textColor: "white",
    accentColor: "#00FF88",
  },
  mindset: {
    gradients: [
      { colors: ["#141e30", "#243b55"], mood: "calm" },
      { colors: ["#0f2027", "#203a43", "#2c5364"], mood: "deepBlue" },
      { colors: ["#1c1c1c", "#2d2d2d", "#3d3d3d"], mood: "charcoal" },
      { colors: ["#0a0a0a", "#1a1a2e", "#2d2d44"], mood: "midnight" },
    ],
    textColor: "white",
    accentColor: "#64FFDA",
  },
  money: {
    gradients: [
      { colors: ["#0f0f0f", "#1a1a1a", "#2d2d2d"], mood: "luxury" },
      { colors: ["#1b1b1b", "#2d2d2d", "#3d3d3d"], mood: "platinum" },
      { colors: ["#0a0a0a", "#1a1a2e", "#e94560"], mood: "power" },
    ],
    textColor: "white",
    accentColor: "#FFD700",
  },
};

function detectTheme(script) {
  const lower = (script || "").toLowerCase();
  if (/(success|win|achieve|goal|rich|wealth|money)/.test(lower)) return "success";
  if (/(mindset|focus|discipline|habit|mental|think)/.test(lower)) return "mindset";
  if (/(money|wealth|rich|cash|invest|finance)/.test(lower)) return "money";
  return "motivation";
}

function pickTheme(script) {
  const themeName = detectTheme(script);
  const theme = BACKGROUND_THEMES[themeName] || BACKGROUND_THEMES.motivation;
  const gradient = theme.gradients[Math.floor(Math.random() * theme.gradients.length)];
  return { ...theme, gradient, name: themeName };
}

// ====== EMOJI ENHANCEMENTS ======

const SCRIPT_EMOJIS = {
  success: ["🔥", "💪", "⭐", "👑", "🏆", "✨", "🚀", "💎", "🌟", "⚡"],
  motivation: ["🔥", "💪", "⭐", "👊", "🎯", "✨", "🚀", "💯", "🌟", "⚡"],
  mindset: ["🧠", "💡", "🎯", "🌟", "💪", "✨", "📈", "💭", "⚡", "🎭"],
  money: ["💰", "💎", "🚀", "📈", "💵", "🏦", "💳", "👑", "⚡", "💸"],
};

function generateVisualElements(theme) {
  const emojis = SCRIPT_EMOJIS[theme] || SCRIPT_EMOJIS.motivation;
  const shuffled = [...emojis].sort(() => Math.random() - 0.5);
  return {
    emojis: shuffled.slice(0, 4),
    primaryEmoji: shuffled[0] || "🔥",
  };
}

// ====== ANIMATED BACKGROUND GENERATION ======

function buildGradientBackgroundFilter({ duration, colors, width = 1080, height = 1920 }) {
  const hexToRgb = (hex) => {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `${r}:${g}:${b}`;
  };

  const fps = 30;
  const frames = Math.round(duration * fps);
  const colorStops = colors.map((c, i) => ({
    color: hexToRgb(c),
    position: i / (colors.length - 1),
  }));

  // Create animated gradient with slow color shifting
  const gradStops = colorStops
    .map((c) => `c${c.position * 100}=${c.color}`)
    .join(",");
  
  const moveX = Math.random() * 0.3 + 0.1;
  const moveY = Math.random() * 0.3 + 0.1;
  
  return [
    // Base gradient background
    `color=c=black:s=${width}x${height}:d=${duration}:r=${fps}`,
    // Animated gradient overlay
    `gradients=s=${width}x${height}:${gradStops}:rate=${fps}:d=${duration}[grad]`,
    // Subtle animated light rays
    `color=c=white@0.03:s=${width}x${height}:d=${duration}:r=${fps},` +
      `geq=r='255':g='255':b='255':a='0.03+0.02*sin(2*PI*${moveX}*on/${frames})'[light]`,
    // Combine
    "[base][grad]overlay=0:0[bg1];[bg1][light]overlay=0:0[bgout]",
  ].join(";");
}

function buildParticleEffect({ duration, width = 1080, height = 1920, count = 40 }) {
  const fps = 30;
  const particles = [];
  
  for (let i = 0; i < count; i++) {
    const x = Math.random() * width;
    const y = Math.random() * height;
    const size = Math.random() * 3 + 1;
    const speedY = Math.random() * 2 + 1;
    const speedX = (Math.random() - 0.5) * 0.5;
    const opacity = Math.random() * 0.4 + 0.1;
    const phase = Math.random() * Math.PI * 2;
    
    particles.push(
      `drawbox=x=${x}:y='${y}+${speedY}*on/${fps}+${size}*sin(2*PI*on/${fps * 3}+${phase})':` +
        `w=${size}:h=${size}:color=white@${opacity}:t=fill`
    );
  }
  
  return particles.join(",");
}

// ====== TEXT ANIMATION FILTERS ======

function escapeT(text) {
  return (text || "")
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/:/g, "\\:")
    .replace(/\n/g, "\\n");
}

function buildTitleAnimation({ text, duration, style = {} }) {
  const safe = escapeT(text || "");
  if (!safe) return [];
  
  const fontSize = style.fontSize || 72;
  const outline = style.outline || 6;
  const color = style.color || "white";
  const accent = style.accentColor || "#FFD700";
  const bgColor = style.bgColor || "black@0.3";
  
  // Title appears with scale-in fade animation (first 2 seconds)
  const startFrame = "on";
  const midFrame = Math.round(duration * 30 * 0.15);
  const endFrame = Math.round(duration * 30 * 0.25);
  
  return [
    // Main title - scale in + glow
    `drawtext=fontsize=${fontSize}:fontcolor=${color}:` +
      `borderw=${outline}:bordercolor=black@0.8:` +
      `shadowcolor=black@0.5:shadowx=2:shadowy=2:` +
      `box=1:boxcolor=${bgColor}:boxborderw=16:` +
      `x=(w-text_w)/2:y=h/2-${fontSize}:` +
      `text='${safe}':` +
      `alpha='if(lte(on,${midFrame}),on/${midFrame},if(gte(on,${endFrame}),1-(on-${endFrame})/${midFrame},1))'` +
      `:enable='between(on,${midFrame * 0.5},${endFrame * 2})'`,
    
    // Accent line below title
    `drawbox=x=(w-200)/2:y=h/2+${fontSize * 0.3}:w=200:h=4:` +
      `color=${accent}:t=fill:` +
      `enable='between(on,${midFrame + 10},${endFrame * 2})'`,
  ];
}

function buildSubtitleAnimations({ subtitles, style = {} }) {
  if (!subtitles?.length) return [];
  
  const fontSize = style.fontSize || 56;
  const outline = style.outline || 4;
  const color = style.fontColor || "white";
  const highlightColor = style.highlightColor || "#FFD700";
  const fadeIn = 3; // frames
  const yPos = style.yOffset || 250;
  const popScale = style.popScale || 1.15;
  
  const filters = [];
  
  subtitles.forEach((sub) => {
    const safe = escapeT(sub.text || "");
    if (!safe) return;
    
    const startFrame = Math.max(0, Math.round((sub.start || 0) * 30));
    const endFrame = Math.round((sub.end || sub.start + 1.5) * 30);
    const highlight = sub.highlight ? highlightColor : color;
    const popSize = Math.round(fontSize * popScale);
    
    // Word-by-word animation: slide up + fade in
    filters.push(
      `drawtext=fontsize=${fontSize}:fontcolor=${highlight}:` +
        `borderw=${outline}:bordercolor=black@0.7:` +
        `shadowcolor=black@0.4:shadowx=2:shadowy=2:` +
        `x=(w-text_w)/2:y=h-${yPos}:` +
        `text='${safe}':` +
        `alpha='if(lt(on,${startFrame}),0,if(lt(on,${startFrame + fadeIn}),(on-${startFrame})/${fadeIn},' +` +
        `if(lt(on,${endFrame}),1,if(lt(on,${endFrame + fadeIn}),1-(on-${endFrame})/${fadeIn},0))))'` +
        `:enable='between(on,${startFrame},${endFrame + fadeIn})'`
    );
    
    // Pop effect on first frame for emphasis
    if (sub.highlight) {
      filters.push(
        `drawtext=fontsize=${popSize}:fontcolor=${highlightColor}:` +
          `borderw=${outline + 1}:bordercolor=black@0.8:` +
          `x=(w-text_w)/2:y=h-${yPos}:` +
          `text='${safe}':` +
          `alpha='if(lt(on,${startFrame}),0,if(lt(on,${startFrame + 4}),1,0))'` +
          `:enable='between(on,${startFrame},${startFrame + 4})'`
      );
    }
  });
  
  return filters;
}

// ====== HOOK/TITLE OVERLAY ======

function buildHookOverlay({ text, style = {} }) {
  if (!text) return [];
  const safe = escapeT(text);
  const fontSize = style.hookSize || 88;
  const outline = style.hookOutline || 8;
  const yPos = style.hookY || 160;
  
  return [
    `drawtext=fontsize=${fontSize}:fontcolor=white:` +
      `borderw=${outline}:bordercolor=black:` +
      `shadowcolor=black@0.6:shadowx=3:shadowy=3:` +
      `box=1:boxcolor=black@0.45:boxborderw=12:` +
      `x=(w-text_w)/2:y=${yPos}:` +
      `text='${safe}':` +
      `alpha='if(lt(on,3),on/3,if(lt(on,90),1,1-(on-90)/5))':` +
      `enable='between(on,0,120)'`,
  ];
}

// ====== WATERMARK ======

function buildWatermark(text) {
  if (!text) return [];
  const safe = escapeT(text);
  return [
    `drawtext=fontsize=28:fontcolor=white@0.5:` +
      `shadowcolor=black@0.3:shadowx=1:shadowy=1:` +
      `borderw=1:bordercolor=black@0.4:` +
      `x=w-text_w-16:y=h-text_h-16:` +
      `text='${safe}'`,
  ];
}

// ====== GET MEDIA DURATION ======

function getMediaDuration(filePath) {
  return new Promise((resolve) => {
    if (!filePath || !fs.existsSync(filePath)) return resolve(null);
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) return resolve(null);
      resolve(metadata?.format?.duration || null);
    });
  });
}

// ====== MAIN GENERATOR ======

/**
 * Generate a beautiful text-to-reel video (FilmoraGo style)
 * No base videos needed - creates everything from scratch!
 * 
 * @param {Object} options
 * @param {string} options.script - The narration script
 * @param {string} [options.voicePath] - Path to voice audio file
 * @param {string} options.outDir - Output directory
 * @param {string} [options.title] - Video title
 * @param {string} [options.hookText] - Hook text overlay
 * @param {Array} [options.highlightWords] - Words to highlight
 * @param {number} [options.maxDuration] - Max duration in seconds
 * @param {number} [options.minDuration] - Min duration in seconds
 * @param {Object} [options.subtitleStyle] - Subtitle styling
 * @param {string} [options.watermarkText] - Watermark text
 * @returns {Promise<string>} Path to generated video
 */
export async function generateReelVideo({
  script,
  voicePath,
  outDir,
  title = "Daily Motivation",
  hookText,
  highlightWords = [],
  maxDuration = 0,
  minDuration = 0,
  subtitleStyle = {},
  watermarkText = "",
}) {
  if (!script) throw new Error("Script is required for reel generation");
  
  const outputFileName = `reel-${Date.now()}.mp4`;
  const outputPath = path.join(outDir, outputFileName);
  
  // Get audio duration if voice file exists
  const audioDuration = voicePath ? await getMediaDuration(voicePath) : null;
  const targetDuration = Math.max(
    minDuration || 15,
    Math.min(
      maxDuration || audioDuration || 30,
      audioDuration || 30
    )
  );
  
  const visualDuration = Math.max(targetDuration, audioDuration || targetDuration);
  const fps = 30;
  const totalFrames = Math.round(visualDuration * fps);
  
  // Detect theme from script
  const theme = pickTheme(script);
  const visuals = generateVisualElements(theme.name);
  
  // Parse script into subtitle chunks
  const sentences = script
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  
  const subtitles = [];
  const wps = 2.6; // words per second
  let cursor = 0.5; // slight delay before first subtitle
  
  sentences.forEach((sentence) => {
    const words = sentence.split(/\s+/).filter(Boolean);
    const segDuration = Math.max(1.5, words.length / wps);
    const isHighlight = highlightWords.some((w) => 
      sentence.toLowerCase().includes(w.toLowerCase())
    );
    
    subtitles.push({
      text: sentence,
      start: cursor,
      end: Math.min(visualDuration, cursor + segDuration),
      highlight: isHighlight,
    });
    
    cursor += segDuration + 0.15;
  });
  
  // If subtitles exceed duration, trim them
  if (cursor > visualDuration) {
    const scale = visualDuration / cursor;
    subtitles.forEach((s) => {
      s.start *= scale;
      s.end *= scale;
    });
  }
  
  // Detect hook text (first sentence, uppercase)
  const hook = hookText || 
    (sentences[0] || script).split(" ").slice(0, 8).join(" ").toUpperCase();
  
  // === BUILD FFMPEG FILTERS ===
  
  // 1. Animated gradient background
  const bgColors = theme.gradient.colors;
  const bgInput = `color=c=black:s=1080x1920:d=${visualDuration}:r=${fps}`;
  
  // 2. Gradient overlay
  const colorStops = bgColors.map((c, i) => {
    const r = parseInt(c.slice(1, 3), 16);
    const g = parseInt(c.slice(3, 5), 16);
    const b = parseInt(c.slice(5, 7), 16);
    const pos = Math.round((i / (bgColors.length - 1)) * 100);
    return `c${pos}=${r}:${g}:${b}`;
  }).join(",");
  
  const gradientFilter = `gradients=s=1080x1920:${colorStops}:rate=${fps}:d=${visualDuration}[grad]`;
  
  // 3. Subtle noise/texture for depth
  const noiseFilter = `noise=alls=3:allf=t+u:enable='between(on,0,${totalFrames})'[noise]`;
  
  // 4. Emoji overlay floating
  const emojiFilters = visuals.emojis.map((emoji, i) => {
    const xPos = [100, 980, 50, 950][i] || 100;
    const yBase = [200, 400, 1500, 1700][i] || 500;
    const driftX = Math.random() * 0.3;
    const driftY = Math.random() * 0.2;
    const size = 48 + Math.random() * 24;
    
    return `drawtext=fontsize=${size}:fontcolor=white@0.15:` +
      `x='${xPos}+${driftX}*on':` +
      `y='${yBase}+${driftY}*on':` +
      `text='${emoji}':` +
      `shadowcolor=black@0.2:shadowx=1:shadowy=1:enable='between(on,0,${totalFrames})'`;
  });
  
  // 5. Build text animations
  const titleAnimations = buildTitleAnimation({
    text: title,
    duration: visualDuration,
    style: {
      fontSize: 72,
      outline: 6,
      color: "white",
      accentColor: theme.accentColor,
    },
  });
  
  const hookOverlay = buildHookOverlay({
    text: hook,
    style: {
      hookSize: (subtitleStyle.hookSize || 88),
      hookOutline: (subtitleStyle.hookOutline || 8),
      hookY: (subtitleStyle.hookY || 160),
    },
  });
  
  const subtitleAnimations = buildSubtitleAnimations({
    subtitles,
    style: {
      fontSize: subtitleStyle.fontSize || 56,
      outline: subtitleStyle.outline || 4,
      yOffset: subtitleStyle.yOffset || 250,
      fontColor: subtitleStyle.fontColor || "white",
      highlightColor: subtitleStyle.highlightColor || theme.accentColor,
      popScale: subtitleStyle.popScale || 1.15,
    },
  });
  
  const watermark = buildWatermark(watermarkText);
  
  // 6. Color grade
  const colorGrade = `eq=contrast=1.08:brightness=0.01:saturation=1.1`;
  
  // Combine all filters
  const allFilters = [
    bgInput,
    `[0:v]format=yuv420p[base]`,
    `[base]${gradientFilter}[withgrad]`,
    `[withgrad]${noiseFilter}[withnoise]`,
    ...emojiFilters.map((f) => `[withnoise]${f}[v]`),
  ];
  
  // Build complex filter string
  const filterChain = [
    `[0:v]format=yuv420p[base]`,
    `[base]gradients=s=1080x1920:${colorStops}:rate=${fps}:d=${visualDuration}[bg]`,
    `[bg]noise=alls=3:allf=t+u:enable='between(on,0,${totalFrames})'[bgtex]`,
    `[bgtex]${colorGrade}[graded]`,
    ...emojiFilters.map((f) => `[graded]${f}[vbase]`).slice(-1),
  ];
  
  // The actual rendering
  const runFfmpeg = () => new Promise((resolve, reject) => {
    const command = ffmpeg();
    
    // 1. Color background input
    command.input(`color=c=black:s=1080x1920:d=${visualDuration}:r=${fps}`)
      .inputOptions(["-f", "lavfi"]);
    
    // 2. Voice input (if provided)
    if (voicePath && fs.existsSync(voicePath)) {
      command.input(voicePath);
    }
    
    // Build all video filters
    const allVideoFilters = [
      // Gradient background with animation
      `[0:v]format=yuv420p[base]`,
      `[base]gradients=s=1080x1920:${colorStops}:rate=${fps}:d=${visualDuration}[bg]`,
      `[bg]noise=alls=3:allf=t+u:enable='between(on,0,${totalFrames})'[bgtex]`,
      `[bgtex]eq=contrast=1.08:brightness=0.01:saturation=1.1[graded]`,
      
      // Floating emojis
      ...visuals.emojis.map((emoji, i) => {
        const xPos = [100, 980, 50, 950][i] || 100;
        const yBase = [200, 400, 1500, 1700][i] || 500;
        const driftX = 0.1 + Math.random() * 0.2;
        const driftY = 0.1 + Math.random() * 0.15;
        const size = 48 + Math.random() * 24;
        return `[graded]drawtext=fontsize=${size}:fontcolor=white@0.12:` +
          `x='${xPos}+${driftX}*on':` +
          `y='${yBase}+${driftY}*on':` +
          `text='${emoji}':enable='between(on,0,${totalFrames})'[v${i}]`;
      }).join(";"),
    ].join(";");
    
    // Add text overlays
    const textFilters = [
      // Title (appears first, fades after 3s)
      `drawtext=fontsize=72:fontcolor=white:` +
        `borderw=6:bordercolor=black@0.8:` +
        `shadowcolor=black@0.5:shadowx=2:shadowy=2:` +
        `box=1:boxcolor=black@0.3:boxborderw=16:` +
        `x=(w-text_w)/2:y=h/2-150:` +
        `text='${escapeT(title)}':` +
        `alpha='if(lt(on,10),on/10,if(lt(on,90),1,1-(on-90)/10))':` +
        `enable='between(on,0,120)'`,
      
      // Hook overlay
      `drawtext=fontsize=88:fontcolor=white:` +
        `borderw=8:bordercolor=black:` +
        `shadowcolor=black@0.6:shadowx=3:shadowy=3:` +
        `box=1:boxcolor=black@0.45:boxborderw=12:` +
        `x=(w-text_w)/2:y=160:` +
        `text='${escapeT(hook)}':` +
        `alpha='if(lt(on,3),on/3,if(lt(on,90),1,1-(on-90)/5))':` +
        `enable='between(on,0,120)'`,
      
      // Subtitle animations (word-by-word)
      ...subtitles.map((sub) => {
        const safe = escapeT(sub.text);
        if (!safe) return "";
        const sf = Math.max(0, Math.round(sub.start * fps));
        const ef = Math.round(sub.end * fps);
        const fc = 3; // fade frames
        const isHL = sub.highlight;
        const hlColor = theme.accentColor;
        const subColor = isHL ? hlColor : "white";
        const subSize = isHL ? 62 : 56;
        
        return `drawtext=fontsize=${subSize}:fontcolor=${subColor}:` +
          `borderw=4:bordercolor=black@0.7:` +
          `shadowcolor=black@0.4:shadowx=2:shadowy=2:` +
          `x=(w-text_w)/2:y=h-250:` +
          `text='${safe}':` +
          `alpha='if(lt(on,${sf}),0,if(lt(on,${sf + fc}),(on-${sf})/${fc},` +
          `if(lt(on,${ef}),1,if(lt(on,${ef + fc}),1-(on-${ef})/${fc},0))))':` +
          `enable='between(on,${sf},${ef + fc})'`;
      }).join(";"),
      
      // Emoji popups for keywords
      ...highlightWords.slice(0, 3).map((word, i) => {
        const emoji = visuals.emojis[i] || "🔥";
        const popStart = Math.round((visualDuration / (highlightWords.length + 1)) * (i + 1) * fps);
        return `drawtext=fontsize=72:fontcolor=white@0.25:` +
          `x='${400 + Math.random() * 200}':` +
          `y='${600 + Math.random() * 400}':` +
          `text='${emoji}':` +
          `alpha='if(lt(on,${popStart}),0,if(lt(on,${popStart + 15}),` +
          `(on-${popStart})/15,if(lt(on,${popStart + 30}),1,` +
          `1-(on-${popStart + 30})/10)))':` +
          `enable='between(on,${popStart},${popStart + 40})'`;
      }),
      
      // Watermark
      watermarkText ? `drawtext=fontsize=28:fontcolor=white@0.5:` +
        `shadowcolor=black@0.3:shadowx=1:shadowy=1:` +
        `borderw=1:bordercolor=black@0.4:` +
        `x=w-text_w-16:y=h-text_h-16:` +
        `text='${escapeT(watermarkText)}'` : "",
    ].filter(Boolean).join(";");
    
    // Combine all video filters
    const fullVideoFilter = [
      allVideoFilters,
      ...[`[v${visuals.emojis.length - 1}]`].map((label) => 
        textFilters.replace(/^/gm, `${label}`)
      ),
    ].join(";");
    
    // Use complex filter
    const allfilterParts = [allVideoFilters, textFilters].filter(Boolean);
    if (allfilterParts.length > 0) {
      command.complexFilter(allfilterParts.join(";"));
    }
    
    // Map audio and video
    const maps = ["0:v"];
    const complexAudio = [];
    
    if (voicePath && fs.existsSync(voicePath)) {
      maps.push("1:a");
    }
    
    // Output options
    const outputOptions = [
      "-y",
      "-preset", "veryfast",
      "-crf", "23",
      "-movflags", "+faststart",
      "-r", String(fps),
      "-pix_fmt", "yuv420p",
    ];
    
    if (maxDuration > 0) {
      outputOptions.push("-t", String(maxDuration));
    } else if (audioDuration) {
      outputOptions.push("-t", String(audioDuration));
    }
    
    maps.forEach((map) => command.outputOptions(["-map", map]));
    command.outputOptions(outputOptions);
    
    command
      .output(outputPath)
      .on("error", (err) => {
        console.error("[reel] FFmpeg error:", err.message);
        reject(err);
      })
      .on("end", () => resolve(outputPath))
      .run();
  });
  
  // Try with complex filters first, fallback to simpler version
  try {
    return await runFfmpeg();
  } catch (err) {
    console.warn("[reel] Complex filter failed, trying simpler version...");
    
    // Fallback: simpler rendering with just text and gradient
    return new Promise((resolve, reject) => {
      const cmd = ffmpeg();
      cmd.input(`color=c=${theme.gradient.colors[0]}:s=1080x1920:d=${visualDuration}:r=${fps}`)
        .inputOptions(["-f", "lavfi"]);
      
      if (voicePath && fs.existsSync(voicePath)) {
        cmd.input(voicePath);
      }
      
      // Simple subtitle text
      const simpleFilters = subtitles.map((sub, i) => {
        const safe = escapeT(sub.text);
        const sf = Math.round(sub.start * fps);
        const ef = Math.round(sub.end * fps);
        return `drawtext=fontsize=52:fontcolor=white:borderw=4:bordercolor=black:x=(w-text_w)/2:y=h-300:` +
          `text='${safe}':enable='between(on,${sf},${ef})'`;
      }).join(",");
      
      if (simpleFilters) {
        cmd.videoFilters(simpleFilters);
      }
      
      const maps = ["0:v"];
      if (voicePath && fs.existsSync(voicePath)) maps.push("1:a");
      maps.forEach((m) => cmd.outputOptions(["-map", m]));
      
      cmd.outputOptions([
        "-y", "-preset", "veryfast", "-crf", "23",
        "-movflags", "+faststart", "-pix_fmt", "yuv420p",
      ]);
      
      if (maxDuration > 0) {
        cmd.outputOptions(["-t", String(maxDuration)]);
      }
      
      cmd.output(outputPath)
        .on("end", () => resolve(outputPath))
        .on("error", (err) => reject(err))
        .run();
    });
  }
}

// ====== HELPER: Generate a complete reel from text only ======

export async function textToReel({
  script,
  title,
  voicePath,
  outDir,
  watermarkText,
}) {
  return generateReelVideo({
    script,
    title: title || "Daily Motivation",
    voicePath,
    outDir,
    maxDuration: 30,
    minDuration: 15,
    subtitleStyle: {
      fontSize: 56,
      outline: 4,
      yOffset: 250,
      fontColor: "white",
      highlightColor: "#FFD700",
      popScale: 1.15,
    },
    highlightWords: detectTheme(script) === "motivation" 
      ? ["discipline", "success", "focus", "never", "power"]
      : [],
    watermarkText,
  });
}

export { detectTheme, pickTheme, BACKGROUND_THEMES };