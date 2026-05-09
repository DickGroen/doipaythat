// worker/routes/analyze-free.js

import { validateUploadInput } from "../utils/validation.js";
import { fileToBase64, safeJsonParse } from "../utils/files.js";
import { jsonResponse } from "../utils/response.js";
import { runTriage } from "../services/claude.js";
import { enqueueFree, saveFreeCase } from "../services/queue.js";
import {
  notifyAdminFree,
  sendConfirmationEmail,
  sendFreeEmail,
} from "../services/resend.js";
import { loadPrompts } from "../config/prompts.js";
import { getStripeLink } from "../services/stripe.js";
import { requireType } from "../config/types.js";

function getTriageDecision({ chance, flags }) {
  const c = Number(chance) || 0;
  const f = Number(flags) || 0;

  if (c >= 60 && f >= 2) {
    return { tier: "tier1", showUpsell: true, emailType: "strong" };
  }

  if (c >= 40 || f === 1) {
    return { tier: "tier2", showUpsell: true, emailType: "soft" };
  }

  return { tier: "tier3", showUpsell: false, emailType: "trust" };
}

export async function handleAnalyzeFree(request, env) {
  const formData = await request.formData();

  const file = formData.get("file");
  const name = String(formData.get("name") || "").trim();
  const email = String(formData.get("email") || "").trim();
  const rawType = String(formData.get("type") || "").trim();

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
    fileBase64: base64,
    mediaType,
    triagePrompt: prompts.triage,
  });

  const triage = safeJsonParse(raw) || {
    sender: null,
    risk: "medium",
    route: "SONNET",
    chance: 50,
    flagCount: 1,
    teaser: "Based on your document, there may be grounds to challenge this.",
  };

  console.log("TRIAGE:", JSON.stringify(triage));

  const decision = getTriageDecision({
    chance: triage.chance,
    flags: triage.flagCount,
  });

  triage.tier = decision.tier;
  triage.emailType = decision.emailType;

  const stripeLink = decision.showUpsell ? getStripeLink(env, type) : null;

  console.log("STRIPE LINK:", stripeLink);
  console.log("DECISION:", JSON.stringify(decision));

  try {
    await saveFreeCase(env, {
      type,
      name,
      email,
      triage,
      stripeLink,
      fileBase64: base64,
      mediaType,
      fileName: file.name || null,
      fileSize: file.size || null,
    });

    console.log("saveFreeCase: OK");
  } catch (err) {
    console.error("saveFreeCase FAILED:", err.message);
    return jsonResponse(
      { ok: false, error: "saveFreeCase failed: " + err.message },
      500
    );
  }

  try {
    await enqueueFree(env, {
      type,
      rawType,
      name,
      email,
      triage,
      stripeLink,
    });

    console.log("enqueueFree: OK");
  } catch (err) {
    console.error("enqueueFree FAILED:", err.message);
    return jsonResponse(
      { ok: false, error: "enqueueFree failed: " + err.message },
      500
    );
  }

  try {
    await sendConfirmationEmail(env, { name, email, type });
    console.log("sendConfirmationEmail: OK");
  } catch (err) {
    console.error("Confirmation email failed:", err.message);
  }

  try {
    await notifyAdminFree(env, {
      name,
      email,
      type,
      rawType,
      triage,
      stripeLink,
    });

    console.log("notifyAdminFree: OK");
  } catch (err) {
    console.error("Admin notify failed:", err.message);
  }

  try {
    await sendFreeEmail(env, {
      name,
      email,
      type,
      triage,
      stripeLink,
      stage: 1,
    });

    console.log("sendFreeEmail stage 1: OK");
  } catch (err) {
    console.error("sendFreeEmail stage 1 failed:", err.message);
  }

  return jsonResponse({
    ok: true,
    type,
    tier: decision.tier,
    emailType: decision.emailType,
    stripeLink,
    triage,
    message: "You'll receive your assessment by email.",
  });
}
