const HAIKU_MODEL = "claude-haiku-4-5";
const SONNET_MODEL = "claude-sonnet-4-6";

export async function callClaude(env, { model, maxTokens, prompt, fileBase64, mediaType }) {
  const isPdf = mediaType === "application/pdf";

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system: prompt,
      messages: [
        {
          role: "user",
          content: [
            isPdf
              ? {
                  type: "document",
                  source: {
                    type: "base64",
                    media_type: mediaType,
                    data: fileBase64
                  }
                }
              : {
                  type: "image",
                  source: {
                    type: "base64",
                    media_type: mediaType,
                    data: fileBase64
                  }
                }
          ]
        }
      ]
    })
  });

  const data = await res.json();

  if (!res.ok) {
    throw new Error(`Claude API error: ${JSON.stringify(data)}`);
  }

  return data?.content?.[0]?.text || "";
}

export async function runTriage(env, { fileBase64, mediaType, triagePrompt }) {
  return callClaude(env, {
    model: HAIKU_MODEL,
    maxTokens: 800,
    prompt: triagePrompt,
    fileBase64,
    mediaType
  });
}

export async function runAnalysis(env, { fileBase64, mediaType, route, haikuPrompt, sonnetPrompt }) {
  const useSonnet = route === "SONNET";

  return callClaude(env, {
    model: useSonnet ? SONNET_MODEL : HAIKU_MODEL,
    maxTokens: useSonnet ? 3500 : 1800,
    prompt: useSonnet ? sonnetPrompt : haikuPrompt,
    fileBase64,
    mediaType
  });
}
