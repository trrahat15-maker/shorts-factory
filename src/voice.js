import fs from "fs/promises";
import path from "path";
import fetch from "node-fetch";

export async function generateVoice({ text, voice = "alloy", elevenLabsApiKey, outDir }) {
  const filename = `voice-${Date.now()}.mp3`;
  const outPath = path.join(outDir, filename);

  const apiKey = (elevenLabsApiKey || "").replace(/\s+/g, "");
  if (apiKey) {
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
  }

  // Browser-side fallback is expected; in server context we cannot TTS without API key.
  throw new Error("No ElevenLabs API key provided. Use browser speech synthesis fallback.");
}
