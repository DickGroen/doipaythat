// routes/submit-paid.js — direct delivery test version

import { validateUploadInput } from "../utils/validation.js";
import { fileToBase64, safeJsonParse } from "../utils/files.js";
import { jsonResponse } from "../utils/response.js";
import { verifyStripeSession } from "../services/stripe.js";
import { runTriage, runAnalysis } from "../services/claude.js";
import { markPaid, getFreeCase } from "../services/queue.js";
import { sendPaidEmail, notifyAdminPaid } from "../services/resend.js";
import { loadPrompts } from "../config/prompts.js";
import { requireType } from "../config/types.js";

export async function handleSubmitPaid(request, env) {
  const formData = await request.formData();

  const file = formData.get("file");
  const name = String(formData.get("name") || "").trim();
  const email = String(formData.get("email") || "").trim();
  const rawType = String(formData.get("type") || "").trim();
  const tier = String(formData.get("tier") || "pro").trim();
  const sessionId = String(formData.get("session_id") || "").trim();

  let type;

  try {
    type = requireType(rawType);
  } catch (err) {
    return jsonResponse({ ok: false, error: err.message }, 400);
  }

  if (!sessionId) {
    return jsonResponse(
      { ok: false, error: "Valid payment session missing." },
      403
    );
  }

  let payment;

  try {
    payment = await verifyStripeSession(env, sessionId);
  } catch (err) {
    console.error("Stripe verification failed:", err.message);
    return jsonResponse(
      { ok: false, error: "Payment could not be verified." },
      403
    );
  }

  const resolvedEmail =
    email ||
    payment?.customer_details?.email ||
    payment?.email ||
    "";

  const validationError = validateUploadInput({
    file,
    name,
    email: resolvedEmail,
    type,
  });

  if (validationError) {
    return jsonResponse({ ok: false, error: validationError }, 400);
  }

  await markPaid(env, resolvedEmail);

  const { base64, mediaType } = await fileToBase64(file);
  const prompts = await loadPrompts(type);

  let triageSource = "paid_fallback";
  let triage;

  try {
    const savedFree = await getFreeCase(env, {
      type,
      email: resolvedEmail,
    });

    if (savedFree?.triage) {
      triage = savedFree.triage;
      triageSource = "free_reused";
    }
  } catch (err) {
    console.error("Free case lookup failed:", err.message);
  }

  if (!triage) {
    const triageRaw = await runTriage(env, {
      fileBase64: base64,
      mediaType,
      triagePrompt: prompts.triage,
    });

    triage = safeJsonParse(triageRaw) || {
      risk: "medium",
      tier: "tier2",
      route: "SONNET",
      chance: 50,
      flagCount: 0,
      currency: "GBP",
      teaser:
        "There may be aspects of this document that could benefit from further review.",
      consumer_position:
        "Some elements may require clarification before a final decision is made.",
    };
  }

  if (!triage.route || !["HAIKU", "SONNET"].includes(triage.route)) {
    triage.route = "SONNET";
  }

  if (!triage.tier || !["tier1", "tier2", "tier3"].includes(triage.tier)) {
    triage.tier =
      triage.risk === "high"
        ? "tier1"
        : triage.risk === "low"
          ? "tier3"
          : "tier2";
  }

  if (!triage.currency) {
    triage.currency = "GBP";
  }

  console.log("TRIAGE SOURCE:", triageSource);
  console.log("TRIAGE:", JSON.stringify(triage));

  const analysis = await runAnalysis(env, {
    fileBase64: base64,
    mediaType,
    route: triage.route || "SONNET",
    haikuPrompt: prompts.haiku,
    sonnetPrompt: prompts.sonnet,
  });

  const expectedTags = [
    "TITLE",
    "SUMMARY",
    "ISSUES",
    "ASSESSMENT",
    "NEXT_STEPS",
  ];

  const tagStatus = expectedTags
    .map((tag) => `${tag}:${analysis.includes(`[${tag}]`) ? "OK" : "MISSING"}`)
    .join(" ");

  console.log("ANALYSIS TAGS:", tagStatus);
  console.log("ANALYSIS LENGTH:", analysis.length);

  // DIRECT TEST DELIVERY — no paid queue, no cron delay
  try {
    await sendPaidEmail(env, {
      name,
      email: resolvedEmail,
      type,
      rawType,
      tier,
      sessionId,
      triage,
      analysis,
    });

    console.log("sendPaidEmail: OK");
  } catch (err) {
    console.error("sendPaidEmail failed:", err.message);
    return jsonResponse(
      { ok: false, error: "Paid email failed: " + err.message },
      500
    );
  }

  try {
    await notifyAdminPaid(env, {
      name,
      email: resolvedEmail,
      type,
      rawType,
      tier,
      sessionId,
      triage,
      analysis,
    });

    console.log("notifyAdminPaid: OK");
  } catch (err) {
    console.error("Admin notify failed:", err.message);
  }

  return jsonResponse({
    ok: true,
    type,
    tier,
    message:
      "Upload successful. Your full analysis and letter have been sent by email.",
  });
}
