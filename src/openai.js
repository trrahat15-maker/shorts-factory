import OpenAI from "openai";

export async function generateScript(input, apiKeyFallback) {
  let prompt = "";
  let apiKey = "";
  let baseUrl = "";
  let model = "";

  if (typeof input === "object" && input !== null) {
    ({ prompt, apiKey, baseUrl, model } = input);
  } else {
    prompt = input || "";
    apiKey = apiKeyFallback || "";
  }

  const rawPrompt = prompt || "";
  const rawKey = apiKey || "";
  const rawBase = baseUrl || "";
  const rawModel = model || "";

  prompt = rawPrompt.trim();
  apiKey = rawKey.replace(/\s+/g, "");
  baseUrl = rawBase.replace(/\s+/g, "");
  model = rawModel.trim();

  const keyMatch = apiKey.match(/sk-[A-Za-z0-9_-]{20,}/);
  if (keyMatch) {
    apiKey = keyMatch[0];
  }

  const urlMatch = baseUrl.match(/https?:\/\/[^\s]+/);
  if (urlMatch) {
    baseUrl = urlMatch[0];
  }

  if (!prompt) throw new Error("Missing prompt");
  if (!apiKey) throw new Error("Missing OpenAI API key");

  const client = new OpenAI({
    apiKey,
    baseURL: baseUrl || undefined,
  });
  const system =
    "You are a creative assistant that writes short motivational scripts for YouTube Shorts. Return plain narration text only.";
  const response = await client.chat.completions.create({
    model: model || "gpt-4o-mini",
    messages: [
      { role: "system", content: system },
      { role: "user", content: prompt },
    ],
    max_tokens: 220,
  });

  const output = response.choices?.[0]?.message?.content?.trim();
  if (!output) throw new Error("OpenAI returned no text");
  return output;
}
