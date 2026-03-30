import fetch from "node-fetch";

const log = (message) => console.log(`[elevenlabs-test] ${message}`);

function parseKeys() {
  const primary = (process.env.ELEVENLABS_API_KEY || "").trim();
  const extras = (process.env.ELEVENLABS_API_KEYS || "")
    .split(/[,
;]/)
    .map((k) => k.trim())
    .filter(Boolean);
  return [primary, ...extras].filter(Boolean);
}

async function fetchVoices(apiKey) {
  const res = await fetch("https://api.elevenlabs.io/v1/voices", {
    headers: { "xi-api-key": apiKey },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`voices ${res.status}: ${text}`);
  const json = JSON.parse(text);
  return json?.voices || [];
}

async function testTts(apiKey, voiceId) {
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "xi-api-key": apiKey,
    },
    body: JSON.stringify({ text: "Test." }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`tts ${res.status}: ${body}`);
  return true;
}

async function run() {
  const keys = parseKeys();
  if (!keys.length) {
    throw new Error("Missing ELEVENLABS_API_KEY or ELEVENLABS_API_KEYS.");
  }
  const doTts = (process.env.ELEVENLABS_TEST_TTS || "false").toLowerCase() === "true";

  for (let i = 0; i < keys.length; i += 1) {
    const apiKey = keys[i];
    log(`Testing key ${i + 1}/${keys.length}`);
    try {
      const voices = await fetchVoices(apiKey);
      log(`Key ${i + 1} OK. Voices: ${voices.length}`);
      if (doTts) {
        const voiceId = process.env.ELEVENLABS_TEST_VOICE || voices?.[0]?.voice_id;
        if (!voiceId) {
          log("No voice_id available to test TTS.");
        } else {
          await testTts(apiKey, voiceId);
          log(`Key ${i + 1} TTS OK (voice: ${voiceId})`);
        }
      }
    } catch (err) {
      log(`Key ${i + 1} failed: ${err.message}`);
    }
  }
}

run().catch((err) => {
  console.error("[elevenlabs-test] Fatal error:", err.message);
  process.exit(1);
});
