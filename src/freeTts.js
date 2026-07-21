/**
 * FREE Realistic TTS Module
 * 
 * Priority order:
 * 1. edge-tts (Microsoft Edge neural TTS - best quality, 100% free, no API key)
 * 2. gTTS (Google Text-to-Speech - good quality, free, no API key)
 * 3. eSpeak (fallback - robotic but always available)
 *
 * edge-tts requires: Python 3.8+ and `pip install edge-tts`
 * If not installed, falls back automatically.
 */

import { execFile, execSync, execFileSync } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";
import { writeFile, mkdtemp } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

const execFileAsync = promisify(execFile);

// ====== EDGE-TTS (Most realistic, free, no API key) ======

const EDGE_VOICES = {
  // English - US (Best for motivational content)
  "en-US-JennyNeural": "Female, natural, warm - best for motivation",
  "en-US-GuyNeural": "Male, confident, authoritative",
  "en-US-AriaNeural": "Female, energetic, engaging",
  "en-US-DavisNeural": "Male, calm, professional",
  "en-US-JaneNeural": "Female, friendly, approachable",
  "en-US-JasonNeural": "Male, enthusiastic, persuasive",
  "en-US-NancyNeural": "Female, mature, wise",
  "en-US-SaraNeural": "Female, cheerful, optimistic",
  "en-US-TonyNeural": "Male, young, energetic",
  
  // English - GB (British accent)
  "en-GB-SoniaNeural": "Female, British, sophisticated",
  "en-GB-RyanNeural": "Male, British, articulate",
  "en-GB-LibbyNeural": "Female, British, warm",
  
  // English - India
  "en-IN-NeerjaNeural": "Female, Indian English, clear",
  "en-IN-PrabhatNeural": "Male, Indian English, confident",
  
  // Arabic
  "ar-SA-ZariyahNeural": "Female, Arabic (Saudi), natural",
  "ar-SA-HamedNeural": "Male, Arabic (Saudi), authoritative",
  "ar-EG-ShakirNeural": "Male, Arabic (Egyptian), warm",
  "ar-EG-SalmaNeural": "Female, Arabic (Egyptian), clear",
};

const EDGE_DEFAULT_VOICE = "en-US-JennyNeural";
const EDGE_VOICE_ALIASES = {
  "alloy": "en-US-JennyNeural",
  "echo": "en-US-GuyNeural",
  "fable": "en-US-AriaNeural",
  "onyx": "en-US-DavisNeural",
  "nova": "en-US-JaneNeural",
  "shimmer": "en-US-SaraNeural",
  "male": "en-US-GuyNeural",
  "female": "en-US-JennyNeural",
  "british": "en-GB-SoniaNeural",
  "british-male": "en-GB-RyanNeural",
  "arabic": "ar-SA-ZariyahNeural",
  "arabic-male": "ar-SA-HamedNeural",
};

function resolveEdgeVoice(voiceName) {
  if (!voiceName) return EDGE_DEFAULT_VOICE;
  const lower = voiceName.toLowerCase().trim();
  
  // Direct match
  if (EDGE_VOICES[lower] || EDGE_VOICES[voiceName]) {
    return voiceName;
  }
  
  // Alias match
  if (EDGE_VOICE_ALIASES[lower]) {
    return EDGE_VOICE_ALIASES[lower];
  }
  
  // Partial match
  const match = Object.keys(EDGE_VOICES).find(
    (v) => v.toLowerCase().includes(lower) || lower.includes(v.toLowerCase().split("-")[0])
  );
  
  return match || EDGE_DEFAULT_VOICE;
}

async function checkEdgeTtsAvailable() {
  try {
    execSync("edge-tts --version 2>nul", { stdio: "pipe", timeout: 5000 });
    return true;
  } catch {
    // Try with python -m edge_tts
    try {
      execSync("python -m edge_tts --version 2>nul", { stdio: "pipe", timeout: 5000 });
      return true;
    } catch {
      try {
        execSync("python3 -m edge_tts --version 2>nul", { stdio: "pipe", timeout: 5000 });
        return true;
      } catch {
        return false;
      }
    }
  }
}

async function checkGttsAvailable() {
  try {
    execSync("python -c \"from gtts import gTTS\" 2>nul", { stdio: "pipe", timeout: 5000 });
    return true;
  } catch {
    try {
      execSync("python3 -c \"from gtts import gTTS\" 2>nul", { stdio: "pipe", timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }
}

async function getPythonCommand() {
  for (const cmd of ["python3", "python"]) {
    try {
      execSync(`${cmd} --version 2>nul`, { stdio: "pipe", timeout: 3000 });
      return cmd;
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * Generate voice using Microsoft Edge TTS (free, neural, realistic)
 * Install: pip install edge-tts
 */
async function generateWithEdgeTts({ text, voice, outPath }) {
  const resolvedVoice = resolveEdgeVoice(voice);
  const scriptPath = join(tmpdir(), `tts-edge-${Date.now()}.py`);
  
  const pythonScript = `
import asyncio
import edge_tts
import sys

async def main():
    try:
        tts = edge_tts.Communicate("""${escapePythonString(text)}""", "${resolvedVoice}")
        await tts.save("${escapePythonString(outPath)}")
        print("OK")
    except Exception as e:
        print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(1)

asyncio.run(main())
`;

  await fs.writeFile(scriptPath, pythonScript, "utf8");
  
  try {
    const pythonCmd = await getPythonCommand();
    if (!pythonCmd) throw new Error("Python not found");
    
    await execFileAsync(pythonCmd, [scriptPath], { timeout: 60000 });
    return outPath;
  } finally {
    try { await fs.rm(scriptPath, { force: true }); } catch {}
  }
}

function escapePythonString(str) {
  return str
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t")
    .replace(/\$/g, "\\$")
    .replace(/`/g, "\\`");
}

// ====== gTTS (Google TTS - free, good quality, no API key) ======

const GTTS_TLDS = {
  "en": "com",       // English - US
  "en-GB": "co.uk",  // English - UK
  "en-IN": "co.in",  // English - India
  "ar": "com.sa",    // Arabic
  "ar-SA": "com.sa", // Arabic - Saudi
  "ar-EG": "com.eg", // Arabic - Egypt
};

async function generateWithGtts({ text, voice, outPath }) {
  // Map voice to language code
  const voiceLower = (voice || "").toLowerCase();
  let lang = "en";
  
  if (voiceLower.includes("ar") || voiceLower.includes("arabic")) {
    lang = "ar";
  } else if (voiceLower.includes("gb") || voiceLower.includes("british") || voiceLower.includes("uk")) {
    lang = "en-GB";
  } else if (voiceLower.includes("in") || voiceLower.includes("india")) {
    lang = "en-IN";
  }
  
  const tld = GTTS_TLDS[lang] || "com";
  const scriptPath = join(tmpdir(), `tts-gtts-${Date.now()}.py`);
  
  const pythonScript = `
from gtts import gTTS
import sys

try:
    text = """${escapePythonString(text)}"""
    tts = gTTS(text=text, lang="${lang.split("-")[0]}", tld="${tld}", slow=False)
    tts.save("${escapePythonString(outPath)}")
    print("OK")
except Exception as e:
    print(f"ERROR: {e}", file=sys.stderr)
    sys.exit(1)
`;

  await fs.writeFile(scriptPath, pythonScript, "utf8");
  
  try {
    const pythonCmd = await getPythonCommand();
    if (!pythonCmd) throw new Error("Python not found");
    
    await execFileAsync(pythonCmd, [scriptPath], { timeout: 60000 });
    return outPath;
  } finally {
    try { await fs.rm(scriptPath, { force: true }); } catch {}
  }
}

// ====== eSpeak (Fallback - always available) ======

async function generateWithEspeak({ text, outDir }) {
  const base = `voice-${Date.now()}`;
  const wavPath = path.join(outDir, `${base}.wav`);
  const mp3Path = path.join(outDir, `${base}.mp3`);
  const voice = process.env.FREE_TTS_VOICE || "en";
  const rate = process.env.FREE_TTS_RATE || "170";

  // Try different espeak binaries
  const espeakCmds = ["espeak-ng", "espeak"];
  let espeakCmd = null;
  
  for (const cmd of espeakCmds) {
    try {
      execFileSync(cmd, ["--version"], { stdio: "pipe", timeout: 3000 });
      espeakCmd = cmd;
      break;
    } catch {
      continue;
    }
  }
  
  if (!espeakCmd) {
    throw new Error("No TTS engine available. Install espeak-ng, edge-tts, or gTTS.");
  }

  await execFileAsync(espeakCmd, ["-v", voice, "-s", String(rate), "-w", wavPath, text]);
  
  // Use ffmpeg to convert to MP3
  const ffmpegCmds = ["ffmpeg"];
  let ffmpegCmd = "ffmpeg";
  
  await execFileAsync(ffmpegCmd, ["-y", "-i", wavPath, "-ac", "1", "-ar", "44100", "-b:a", "64k", mp3Path]);
  
  try { await fs.rm(wavPath); } catch {}
  
  return { file: path.basename(mp3Path), url: `/uploads/generated/${path.basename(mp3Path)}` };
}

// ====== Browser Speech Synthesis (Client-side only) ======

export function getBrowserVoices() {
  if (typeof window === "undefined" || !window.speechSynthesis) {
    return ["Browser TTS not available server-side"];
  }
  return window.speechSynthesis.getVoices().map((v) => v.name);
}

export async function generateBrowserTTS(text) {
  if (typeof window === "undefined" || !window.speechSynthesis) {
    throw new Error("Browser TTS not available in server context");
  }
  
  // Use MediaRecorder to capture audio
  return new Promise((resolve, reject) => {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.0;
    utterance.pitch = 1.0;
    utterance.volume = 1.0;
    
    utterance.onend = () => resolve({ success: true });
    utterance.onerror = (err) => reject(err);
    
    window.speechSynthesis.speak(utterance);
  });
}

// ====== Auto-detect best available free TTS ======

let cachedTtsStatus = null;

export async function checkFreeTtsStatus() {
  if (cachedTtsStatus) return cachedTtsStatus;
  
  const status = {
    edgeTts: false,
    gtts: false,
    espeak: false,
    python: false,
    installCommands: [],
  };
  
  // Check Python
  const pythonCmd = await getPythonCommand();
  status.python = pythonCmd !== null;
  
  // Check edge-tts
  status.edgeTts = await checkEdgeTtsAvailable();
  
  // Check gTTS
  status.gtts = await checkGttsAvailable();
  
  // Check espeak
  try {
    execSync("espeak-ng --version 2>nul", { stdio: "pipe", timeout: 3000 });
    status.espeak = true;
  } catch {
    try {
      execSync("espeak --version 2>nul", { stdio: "pipe", timeout: 3000 });
      status.espeak = true;
    } catch {
      status.espeak = false;
    }
  }
  
  // Build install commands
  if (!status.edgeTts) {
    status.installCommands.push("pip install edge-tts");
  }
  if (!status.gtts) {
    status.installCommands.push("pip install gtts");
  }
  if (!status.espeak) {
    status.installCommands.push("apt-get install espeak-ng");
  }
  
  cachedTtsStatus = status;
  return status;
}

/**
 * Generate realistic free voice - automatically picks the best available engine
 * 
 * @param {Object} options
 * @param {string} options.text - Text to convert to speech
 * @param {string} [options.voice] - Voice name (edge-tts voice or alias)
 * @param {string} options.outDir - Output directory
 * @param {boolean} [options.forceEspeak] - Force eSpeak even if better options exist
 * @returns {Promise<{file: string, url: string, engine: string}>}
 */
export async function generateFreeVoice({ text, voice = "alloy", outDir, forceEspeak = false }) {
  const filename = `voice-${Date.now()}.mp3`;
  const outPath = path.join(outDir, filename);
  
  // Check what's available
  const available = await checkFreeTtsStatus();
  
  const engines = [];
  
  if (!forceEspeak) {
    // Priority 1: edge-tts (most realistic, neural voices)
    if (available.edgeTts) {
      engines.push({ name: "edge-tts", fn: generateWithEdgeTts });
    }
    
    // Priority 2: gTTS (good quality, Google's engine)
    if (available.gtts) {
      engines.push({ name: "gtts", fn: generateWithGtts });
    }
  }
  
  // Priority 3: eSpeak (fallback, robotic but works everywhere)
  if (available.espeak) {
    engines.push({ name: "espeak", fn: null }); // Handled separately
  }
  
  // Try each engine in priority order
  for (const engine of engines) {
    try {
      if (engine.name === "espeak") {
        const result = await generateWithEspeak({ text, outDir });
        return { ...result, engine: "espeak" };
      }
      
      await engine.fn({ text, voice, outPath });
      
      // Verify file was created
      const stats = await fs.stat(outPath).catch(() => null);
      if (stats && stats.size > 100) {
        console.log(`[voice] Generated with ${engine.name}`);
        return { file: filename, url: `/uploads/generated/${filename}`, engine: engine.name };
      }
    } catch (err) {
      console.warn(`[voice] ${engine.name} failed: ${err.message}. Trying next engine...`);
    }
  }
  
  // Final fallback to eSpeak if it wasn't in the list
  if (available.espeak) {
    const result = await generateWithEspeak({ text, outDir });
    return { ...result, engine: "espeak" };
  }
  
  throw new Error(
    "No TTS engine available. Install one of:\n" +
    "  pip install edge-tts     (Best - neural voices, free)\n" +
    "  pip install gtts         (Good - Google TTS, free)\n" +
    "  apt-get install espeak-ng (Basic - works everywhere)"
  );
}

/**
 * Install edge-tts for the best free realistic voices
 */
export async function installEdgeTts() {
  const pythonCmd = await getPythonCommand();
  if (!pythonCmd) throw new Error("Python not found. Install Python 3.8+ first.");
  
  const result = execSync(`${pythonCmd} -m pip install edge-tts`, {
    stdio: "pipe",
    timeout: 120000,
  });
  
  cachedTtsStatus = null; // Reset cache
  return result.toString();
}

/**
 * Install gTTS as backup
 */
export async function installGtts() {
  const pythonCmd = await getPythonCommand();
  if (!pythonCmd) throw new Error("Python not found.");
  
  const result = execSync(`${pythonCmd} -m pip install gtts`, {
    stdio: "pipe",
    timeout: 120000,
  });
  
  cachedTtsStatus = null;
  return result.toString();
}

// Export available voices for UI
export { EDGE_VOICES, EDGE_DEFAULT_VOICE, EDGE_VOICE_ALIASES };