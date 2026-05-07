// worker/routes/analyze-free.js

import { validateUploadInput } from "../utils/validation.js";
import { fileToBase64, safeJsonParse } from "../utils/files.js";
import { jsonResponse } from "../utils/response.js";
import { runTriage } from "../services/claude.js";
import { enqueueFree, saveFreeCase } from "../services/queue.js";
import { notifyAdminFree, sendConfirmationEmail } from "../services/resend.js";
import { loadPrompts } from "../config/prompts.js";
import { getStripeLink } from "../services/stripe.js";
import { requireType } from "../config/types.js";

export async function handleAnalyzeFree(request, env) {
  const formData = await request.formData();

  const file    = formData.get("file");
  const name    = String(formData.get("name")  || "").trim();
  const email   = String(formData.get("email") || "").trim();
  const rawType = String(formData.get("type")  || "").trim();

  let type;

  try {
    type = requireType(rawType);
  } catch (err) {
    return jsonResponse({ ok: false, error: err.message }, 400);
  }

  const validationError = validateUploadInput({ file, name, email, type });

  if (validationError) {
    return jsonResponse({ ok: false, error: validationError }, 400);
  }

  const { base64, mediaType } = await fileToBase64(file);
  const prompts = await loadPrompts(type);

  const raw = await runTriage(env, {
    fileBase64:   base64,
    mediaType,
    triagePrompt: prompts.triage,
  });

  const triage = safeJsonParse(raw) || {
    sender: null,
    risk:   "medium",
    route:  "SONNET",
    teaser: "Based on your document, there may be grounds to challenge this.",
  };

  console.log("TRIAGE:", JSON.stringify(triage));

  const stripeLink = getStripeLink(env, type);

  await saveFreeCase(env, {
    type,
    name,
    email,
    triage,
    stripeLink,
    fileBase64: base64,
    mediaType,
    fileName:   file.name || null,
    fileSize:   file.size || null,
  });

  await enqueueFree(env, {
    type,
    rawType,
    name,
    email,
    triage,
    stripeLink,
  });

  // Directe bevestigingsemail — geen AI toon, menselijk en vertrouwenwekkend
  try {
    await sendConfirmationEmail(env, { name, email, type });
  } catch (err) {
    console.error("Confirmation email failed:", err.message);
  }

  try {
    await notifyAdminFree(env, { name, email, type, rawType, triage, stripeLink });
  } catch (err) {
    console.error("Admin notify failed:", err.message);
  }

  return jsonResponse({
    ok:      true,
    type,
    triage,
    stripeLink,
    message: "You'll receive your assessment by the next business day before 4pm.",
  });
}
