import fs from "fs/promises";
import path from "path";
import fetch from "node-fetch";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
}

function tokenizeWords(text) {
  return text
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
}

function splitIntoPhrases(sentence, minWords = 5, maxWords = 12) {
  const words = tokenizeWords(sentence);
  if (words.length <= maxWords) return [words.join(" ")];
  const phrases = [];
  let i = 0;
  while (i < words.length) {
    const remaining = words.length - i;
    const size = remaining < minWords ? remaining : Math.floor(Math.random() * (maxWords - minWords + 1)) + minWords;
    phrases.push(words.slice(i, i + size).join(" "));
    i += size;
  }
  return phrases;
}

function optimizeTextForVoice(rawText) {
  const cleaned = String(rawText || "")
    .replace(/\s+/g, " ")
    .replace(/\s*([,.!?…])/g, "$1")
    .trim();
  if (!cleaned) return "";

  const sentences = cleaned
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const output = [];
  sentences.forEach((sentence, idx) => {
    const phrases = splitIntoPhrases(sentence);
    phrases.forEach((phrase, phraseIdx) => {
      let text = phrase;
      if (idx === 0 && phraseIdx === 0) {
        // Stronger hook delivery.
        if (!/[!?]$/.test(text)) text += "!";
      }
      output.push(text);
    });
  });

  // Add micro pauses between phrases.
  const pause = () => (Math.random() < 0.5 ? "..." : "—");
  return output
    .map((part, index) => {
      if (index === 0) return part;
      return `${pause()} ${part}`;
    })
    .join(" ");
}

async function generateVoiceWithEspeak({ text, outDir }) {
  const base = `voice-${Date.now()}`;
  const wavPath = path.join(outDir, `${base}.wav`);
  const mp3Path = path.join(outDir, `${base}.mp3`);
  const voice = process.env.FREE_TTS_VOICE || "en";
  const rate = process.env.FREE_TTS_RATE || "170";

  await execFileAsync("espeak", ["-v", voice, "-s", String(rate), "-w", wavPath, text]);
  await execFileAsync("ffmpeg", ["-y", "-i", wavPath, "-ac", "1", "-ar", "44100", mp3Path]);
  try {
    await fs.rm(wavPath);
  } catch {
    // ignore
  }
  return { file: path.basename(mp3Path), url: `/uploads/generated/${path.basename(mp3Path)}` };
}

export async function generateVoice({ text, voice = "alloy", elevenLabsApiKey, outDir }) {
  const filename = `voice-${Date.now()}.mp3`;
  const outPath = path.join(outDir, filename);
  const allowFreeTts = process.env.FREE_TTS?.toLowerCase() !== "false";
  const elevenModel = process.env.ELEVENLABS_MODEL || "eleven_multilingual_v2";
  const voiceSettings = {
    stability: clamp(Number(process.env.ELEVENLABS_STABILITY ?? 0.35), 0, 1),
    similarity_boost: clamp(Number(process.env.ELEVENLABS_SIMILARITY ?? 0.85), 0, 1),
    style: clamp(Number(process.env.ELEVENLABS_STYLE ?? 0.45), 0, 1),
    speaker_boost: (process.env.ELEVENLABS_SPEAKER_BOOST ?? "true").toLowerCase() !== "false",
  };
  const tempo = clamp(Number(process.env.VOICE_TEMPO ?? 1.1), 0.8, 1.3);
  const optimizedText = optimizeTextForVoice(text);

  const envKeys = (process.env.ELEVENLABS_API_KEYS || "")
    .split(/[,\n;]/)
    .map((k) => k.trim())
    .filter(Boolean);
  const initialKey = (elevenLabsApiKey || "").replace(/\s+/g, "");
  const keysToTry = [initialKey, ...envKeys].filter(Boolean);

  for (const apiKey of keysToTry) {
    try {
      const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "audio/mpeg",
          "xi-api-key": apiKey,
        },
        body: JSON.stringify({
          text: optimizedText || text,
          model_id: elevenModel,
          voice_settings: voiceSettings,
        }),
      });

      if (!res.ok) {
        const body = await res.text();
        throw new Error(`ElevenLabs API error: ${res.status} ${body}`);
      }

      const buffer = await res.arrayBuffer();
      await fs.writeFile(outPath, Buffer.from(buffer));
      if (tempo !== 1) {
        const spedPath = path.join(outDir, `voice-${Date.now()}-tempo.mp3`);
        await execFileAsync("ffmpeg", ["-y", "-i", outPath, "-filter:a", `atempo=${tempo}`, spedPath]);
        await fs.rm(outPath, { force: true });
        return { file: path.basename(spedPath), url: `/uploads/generated/${path.basename(spedPath)}` };
      }
      return { file: filename, url: `/uploads/generated/${filename}` };
    } catch (err) {
      // Try next key on quota/401/429/voice errors.
      const message = String(err?.message || "");
      const shouldRotate =
        /quota|credits|invalid|unauthorized|401|429|voice_not_found|missing_permissions/i.test(message);
      if (!shouldRotate) {
        if (!allowFreeTts) throw err;
        return generateVoiceWithEspeak({ text, outDir });
      }
    }
  }

  if (allowFreeTts) {
    return generateVoiceWithEspeak({ text, outDir });
  }

  // Browser-side fallback is expected; in server context we cannot TTS without API key.
  throw new Error("No ElevenLabs API key provided. Use browser speech synthesis fallback.");
}
