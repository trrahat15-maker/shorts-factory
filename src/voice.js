import fs from "fs/promises";
import path from "path";
import fetch from "node-fetch";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

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

  const apiKey = (elevenLabsApiKey || "").replace(/\s+/g, "");
  if (apiKey) {
    try {
      const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "xi-api-key": apiKey,
        },
        body: JSON.stringify({ text }),
      });

      if (!res.ok) {
        const body = await res.text();
        throw new Error(`ElevenLabs API error: ${res.status} ${body}`);
      }

      const buffer = await res.arrayBuffer();
      await fs.writeFile(outPath, Buffer.from(buffer));
      return { file: filename, url: `/uploads/generated/${filename}` };
    } catch (err) {
      if (!allowFreeTts) throw err;
      return generateVoiceWithEspeak({ text, outDir });
    }
  }

  if (allowFreeTts) {
    return generateVoiceWithEspeak({ text, outDir });
  }

  // Browser-side fallback is expected; in server context we cannot TTS without API key.
  throw new Error("No ElevenLabs API key provided. Use browser speech synthesis fallback.");
}
