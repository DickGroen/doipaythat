// worker/index.js
import triagePrompt from "../prompts/debt/triage.js";
import haikuPrompt from "../prompts/debt/haiku.js";
import sonnetPrompt from "../prompts/debt/sonnet.js";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS });
    }

    const url = new URL(request.url);

    if (url.pathname === "/api/analyze-free") {
      return handleAnalyze(request, env, { paid: false });
    }

    if (url.pathname === "/api/submit") {
      return handleAnalyze(request, env, { paid: true });
    }

    return json({ error: "Not found" }, 404);
  },
};

async function handleAnalyze(request, env, options) {
  try {
    const formData = await request.formData();

    const type = formData.get("type");
    const file = formData.get("file");
    const email = formData.get("email");
    const name = formData.get("name");

    if (type !== "debt") {
      return json({ error: "Unsupported type" }, 400);
    }

    if (!file || typeof file === "string") {
      return json({ error: "No file uploaded" }, 400);
    }

    if (file.size > 10 * 1024 * 1024) {
      return json({ error: "File too large. Max 10MB." }, 400);
    }

    const base64 = await fileToBase64(file);

    // 1. TRIAGE
    const triageText = await callClaude(env, {
      model: "claude-3-5-haiku-latest",
      system: triagePrompt,
      base64,
      mimeType: file.type,
    });

    const triage = parseBlocks(triageText);

    const documentType = clean(triage.TYPE);
    const complexity = clean(triage.COMPLEXITY);
    const confidence = clean(triage.CONFIDENCE);

    if (documentType !== "debt") {
      return json({
        status: "rejected",
        reason: "This does not appear to be a UK debt collection document.",
        triage,
      });
    }

    // 2. MODEL DECISION
    const useSonnet =
      options.paid ||
      confidence === "low" ||
      complexity === "complex";

    const model = useSonnet
      ? "claude-3-5-sonnet-latest"
      : "claude-3-5-haiku-latest";

    const prompt = useSonnet ? sonnetPrompt : haikuPrompt;

    // 3. FULL ANALYSIS
    const analysisText = await callClaude(env, {
      model,
      system: prompt,
      base64,
      mimeType: file.type,
    });

    const analysis = parseBlocks(analysisText);

    // 4. OPTIONAL QUEUE / EMAIL
    const job = {
      id: crypto.randomUUID(),
      type,
      name,
      email,
      paid: options.paid,
      model,
      triage,
      analysis,
      createdAt: new Date().toISOString(),
    };

    if (env.JOBS_KV) {
      await env.JOBS_KV.put(job.id, JSON.stringify(job));
    }

    return json({
      status: "ok",
      paid: options.paid,
      model,
      triage,
      analysis,
      jobId: job.id,
    });
  } catch (err) {
    return json({ error: err.message || "Server error" }, 500);
  }
}

async function callClaude(env, { model, system, base64, mimeType }) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: model.includes("sonnet") ? 3500 : 1600,
      system,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "document",
              source: {
                type: "base64",
                media_type: mimeType || "application/pdf",
                data: base64,
              },
            },
            {
              type: "text",
              text: "Analyse this uploaded document.",
            },
          ],
        },
      ],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Claude error: ${text}`);
  }

  const data = await res.json();
  return data.content?.[0]?.text || "";
}

async function fileToBase64(file) {
  const buffer = await file.arrayBuffer();
  let binary = "";
  const bytes = new Uint8Array(buffer);

  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }

  return btoa(binary);
}

function parseBlocks(text) {
  const result = {};
  const regex = /\[([A-Z_]+)\]([\s\S]*?)\[\/\1\]/g;

  let match;
  while ((match = regex.exec(text)) !== null) {
    result[match[1]] = match[2].trim();
  }

  return result;
}

function clean(value) {
  return String(value || "").trim().toLowerCase();
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...CORS,
    },
  });
}
