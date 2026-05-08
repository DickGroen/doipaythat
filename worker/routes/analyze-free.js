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

function getTriageDecision({ chance, flags }) {
  const c = Number(chance) || 0;
  const f = Number(flags)  || 0;

  if (c >= 60 && f >= 2) {
    return { tier: "tier1", showUpsell: true,  emailType: "strong" };
  }
  if (c >= 40 || f === 1) {
    return { tier: "tier2", showUpsell: true,  emailType: "soft"   };
  }
  return   { tier: "tier3", showUpsell: false, emailType: "trust"  };
}

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
    sender:   null,
    risk:     "medium",
    route:    "SONNET",
    chance:   50,
    flagCount: 1,
    teaser:   "Based on your document, there may be grounds to challenge this.",
  };

  console.log("TRIAGE:", JSON.stringify(triage));

  const decision = getTriageDecision({
    chance: triage.chance,
    flags:  triage.flagCount,
  });

  // Only include Stripe link for tier1 and tier2
  const stripeLink = decision.showUpsell ? getStripeLink(env, type) : null;

  // Enrich triage with decision
  triage.tier      = decision.tier;
  triage.emailType = decision.emailType;

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
