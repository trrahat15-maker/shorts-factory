import OpenAI from "openai";

function extractJson(text) {
  if (!text) return null;
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

function normalizeTags(tags) {
  if (!tags) return [];
  if (Array.isArray(tags)) {
    return tags.map((tag) => String(tag).trim()).filter(Boolean);
  }
  return String(tags)
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

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

export async function generateMetadata({ script, channelContext, apiKey, baseUrl, model, variants = 3 }) {
  const titleInstruction =
    variants && variants > 1
      ? `Return JSON with keys: titles (array of ${variants} options), description, tags.`
      : "Return ONLY valid JSON with keys: title, description, tags.";

  const prompt = `You are a YouTube Shorts growth assistant.
Generate metadata for this Shorts script.
${titleInstruction}
Constraints:
- title: <= 90 characters
- description: 2-3 short sentences + 3-6 hashtags
- tags: 8-15 short keywords, no hashtags

Channel context (if any): ${channelContext || "motivational shorts"}

Script:
${script}`;

  const client = new OpenAI({
    apiKey,
    baseURL: baseUrl || undefined,
  });

  const response = await client.chat.completions.create({
    model: model || "gpt-4o-mini",
    messages: [
      { role: "system", content: "You produce concise, high-performing YouTube Shorts metadata." },
      { role: "user", content: prompt },
    ],
    max_tokens: 260,
  });

  const raw = response.choices?.[0]?.message?.content?.trim();
  if (!raw) throw new Error("OpenAI returned no metadata");
  const data = extractJson(raw);
  if (!data) throw new Error("OpenAI metadata was not valid JSON");

  const title = String(data.title || "").trim();
  const titles = Array.isArray(data.titles) ? data.titles : [];
  const description = String(data.description || "").trim();
  const tags = normalizeTags(data.tags);

  return {
    title: title.length > 90 ? `${title.slice(0, 87).trim()}...` : title,
    description,
    tags,
    titles,
  };
}
