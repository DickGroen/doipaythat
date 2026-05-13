// worker/services/claude.js

const HAIKU_MODEL = "claude-haiku-4-5-20251001";
const SONNET_MODEL = "claude-sonnet-4-6";

const DEFAULT_TIMEOUT_MS = 1000 * 90;
const MAX_RETRIES = 2;

function isPdf(mediaType) {
  return mediaType === "application/pdf";
}

function isSupportedMediaType(mediaType) {
  return [
    "application/pdf",
    "image/jpeg",
    "image/png",
    "image/webp",
  ].includes(mediaType);
}

function buildHeaders(env, mediaType) {
  const headers = {
    "x-api-key": env.ANTHROPIC_API_KEY,
    "anthropic-version": "2023-06-01",
    "content-type": "application/json",
  };

  if (isPdf(mediaType)) {
    headers["anthropic-beta"] = "pdfs-2024-09-25";
  }

  return headers;
}

function buildContent(fileBase64, mediaType, prompt) {
  return [
    isPdf(mediaType)
      ? {
          type: "document",
          source: {
            type: "base64",
            media_type: mediaType,
            data: fileBase64,
          },
        }
      : {
          type: "image",
          source: {
            type: "base64",
            media_type: mediaType,
            data: fileBase64,
          },
        },

    {
      type: "text",
      text: prompt,
    },
  ];
}

function truncate(value, length = 600) {
  return String(value || "").slice(0, length);
}

function safeExtractText(data) {
  if (!data?.content || !Array.isArray(data.content)) {
    return "";
  }

  const textBlocks = data.content
    .filter((block) => block?.type === "text" && typeof block?.text === "string")
    .map((block) => block.text);

  return textBlocks.join("\n").trim();
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();

  const timeout = setTimeout(() => {
    controller.abort("Anthropic timeout");
  }, timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

export async function callClaude(
  env,
  {
    model,
    maxTokens,
    prompt,
    fileBase64,
    mediaType,
    retries = MAX_RETRIES,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  }
) {
  if (!env?.ANTHROPIC_API_KEY) {
    throw new Error("Missing ANTHROPIC_API_KEY");
  }

  if (!prompt || typeof prompt !== "string") {
    throw new Error("Claude prompt missing");
  }

  if (!fileBase64 || typeof fileBase64 !== "string") {
    throw new Error("Claude fileBase64 missing");
  }

  if (!isSupportedMediaType(mediaType)) {
    throw new Error(`Unsupported media type: ${mediaType}`);
  }

  const headers = buildHeaders(env, mediaType);

  const body = {
    model,
    max_tokens: maxTokens,
    messages: [
      {
        role: "user",
        content: buildContent(fileBase64, mediaType, prompt),
      },
    ],
  };

  let lastError;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      console.log(
        "CLAUDE REQUEST:",
        JSON.stringify({
          model,
          mediaType,
          maxTokens,
          attempt: attempt + 1,
        })
      );

      const res = await fetchWithTimeout(
        "https://api.anthropic.com/v1/messages",
        {
          method: "POST",
          headers,
          body: JSON.stringify(body),
        },
        timeoutMs
      );

      let data;

      try {
        data = await res.json();
      } catch (err) {
        throw new Error("Claude returned invalid JSON");
      }

      if (!res.ok) {
        const message =
          data?.error?.message ||
          data?.message ||
          JSON.stringify(data);

        throw new Error(`Claude API error: ${message}`);
      }

      const text = safeExtractText(data);

      if (!text || !text.trim()) {
        throw new Error("Claude returned empty response");
      }

      console.log(
        "CLAUDE RESPONSE:",
        JSON.stringify({
          model,
          length: text.length,
          preview: truncate(text, 200),
        })
      );

      return text.trim();
    } catch (err) {
      lastError = err;

      console.error(
        "CLAUDE CALL FAILED:",
        JSON.stringify({
          model,
          attempt: attempt + 1,
          error: err?.message || String(err),
        })
      );

      if (attempt >= retries) {
        break;
      }

      await new Promise((resolve) =>
        setTimeout(resolve, 1200 * (attempt + 1))
      );
    }
  }

  throw lastError || new Error("Claude request failed");
}

export async function runTriage(
  env,
  {
    fileBase64,
    mediaType,
    triagePrompt,
  }
) {
  const raw = await callClaude(env, {
    model: HAIKU_MODEL,
    maxTokens: 800,
    prompt: triagePrompt,
    fileBase64,
    mediaType,
  });

  console.log("TRIAGE RAW:", truncate(raw, 300));

  return raw;
}

export async function runAnalysis(
  env,
  {
    fileBase64,
    mediaType,
    route,
    haikuPrompt,
    sonnetPrompt,
  }
) {
  const useSonnet = route === "SONNET";

  const analysis = await callClaude(env, {
    model: useSonnet ? SONNET_MODEL : HAIKU_MODEL,
    maxTokens: useSonnet ? 5000 : 1800,
    prompt: useSonnet ? sonnetPrompt : haikuPrompt,
    fileBase64,
    mediaType,
  });

  console.log(
    "ANALYSIS COMPLETE:",
    JSON.stringify({
      model: useSonnet ? "SONNET" : "HAIKU",
      length: analysis.length,
    })
  );

  if (analysis.length < 120) {
    console.warn("Analysis unusually short");
  }

  return analysis;
}
