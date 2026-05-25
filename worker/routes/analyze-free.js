// worker/routes/analyze-free.js — doipaythat

import { fileToBase64, safeJsonParse, extractTaggedSection } from "../utils/files.js";
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
 
const ALLOWED_TYPES = ["debt", "parking", "bill", "subscription", "quote", "contract", "housing"];

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

// ── Debug mock triage ─────────────────────────────────────────────────────────

function mockTriage(type) {
  return {
    documentType:   type,
    sender:         "Debug Sender Ltd",
    amount_claimed: 150,
    risk:           "medium",
    route:          "HAIKU",
    chance:         55,
    flagCount:      2,
    teaser:         "[DEBUG] This is a mock triage result. No API call was made.",
    possible_excessive_fees: true,
    possible_no_proof:       true,
  };
}

export async function handleAnalyzeFree(request, env) {
  const debugMode = env.API_DEBUG_MODE === "true";

  try {
    const formData = await request.formData();

    const file  = formData.get("file");
    const name  = String(formData.get("name")  || "").trim();
    const email = String(formData.get("email") || "").trim();
    const type  = String(formData.get("type")  || "").trim();

    if (!file || !name || !email || !type) {
      return jsonResponse({ ok: false, error: "Missing required fields." }, 400);
    }

    if (!ALLOWED_TYPES.includes(type)) {
      return jsonResponse({ ok: false, error: `Invalid funnel type: ${type}` }, 400);
    }

    const { base64, mediaType } = await fileToBase64(file);

    // ── API cost log ────────────────────────────────────────────────────────
    console.log("API_CALL_LOG:", JSON.stringify({
      route:      "analyze-free",
      model:      "haiku",
      type,
      free_paid:  "free",
      file:       !!file,
      file_size:  file?.size || 0,
      debug_mode: debugMode,
      timestamp:  new Date().toISOString(),
    }));

    let triage;

    if (debugMode) {
      console.log("[DEBUG] Skipping Anthropic API call — debug mode enabled");
      triage = normalizeTriage(mockTriage(type));
    } else {
      const prompts = await loadPrompts(type);

      if (!prompts?.triage) {
        return jsonResponse({ ok: false, error: `Triage prompt not found for type: ${type}` }, 500);
      }

      const raw = await runTriage(env, {
        fileBase64:   base64,
        mediaType,
        triagePrompt: prompts.triage,
      });

      triage = normalizeTriage(safeJsonParse(raw) || {
        documentType: null,
        sender:       null,
        amount_claimed: null,
        risk:    "medium",
        route:   "SONNET",
        chance:  50,
        flagCount: 0,
        teaser:  "There may be aspects of this document worth checking before you respond or pay.",
      });
    }

    console.log("FREE TRIAGE:", JSON.stringify(triage));

    const decision = getTriageDecision({ chance: triage.chance, flags: triage.flagCount });

    triage.tier      = decision.tier;
    triage.emailType = decision.emailType;

    const stripeLink = getStripeLink(env, type) || null;

    console.log("FREE DECISION:", JSON.stringify(decision));

    try {
      await saveFreeCase(env, {
        type, name, email, triage, stripeLink,
        fileBase64: base64, mediaType,
        fileName: file.name || null,
        fileSize: file.size || null,
      });
      console.log("saveFreeCase: OK");
    } catch (err) {
      console.error("saveFreeCase FAILED:", err.message);
      return jsonResponse({ ok: false, error: "saveFreeCase failed: " + err.message }, 500);
    }

    try {
      await enqueueFree(env, { type, name, email, triage, stripeLink });
      console.log("enqueueFree: OK");
    } catch (err) {
      console.error("enqueueFree FAILED:", err.message);
      return jsonResponse({ ok: false, error: "enqueueFree failed: " + err.message }, 500);
    }

    if (!debugMode) {
      try {
        await sendConfirmationEmail(env, { name, email, type });
        console.log("sendConfirmationEmail: OK");
      } catch (err) {
        console.error("sendConfirmationEmail failed:", err.message);
      }

      try {
        await notifyAdminFree(env, { name, email, type, triage, stripeLink });
        console.log("notifyAdminFree: OK");
      } catch (err) {
        console.error("notifyAdminFree failed:", err.message);
      }

      try {
        await sendFreeEmail(env, { name, email, type, triage, stripeLink, stage: 1 });
        console.log("sendFreeEmail stage 1: OK");
      } catch (err) {
        console.error("sendFreeEmail stage 1 failed:", err.message);
      }
    } else {
      console.log("[DEBUG] Skipping emails — debug mode enabled");
    }

    return jsonResponse({
      ok:        true,
      debug:     debugMode,
      type,
      tier:      decision.tier,
      emailType: decision.emailType,
      stripeLink,
      triage: {
        documentType:   triage.documentType   ?? null,
        sender:         triage.sender         ?? null,
        amount_claimed: triage.amount_claimed ?? null,
        risk:           triage.risk,
        chance:         triage.chance,
        flagCount:      triage.flagCount,
        teaser:         triage.teaser,
        route:          triage.route,
        emailType:      triage.emailType,
      },
      teaser: {
        chancePercent: triage.chance,
        text:          triage.teaser,
        stripeLink,
      },
      message: debugMode ? "[DEBUG] Mock triage returned. No API call made." : "Your first check is ready.",
    });

  } catch (err) {
    console.error("handleAnalyzeFree FAILED:", err?.message, err?.stack);
    return jsonResponse({ ok: false, error: err?.message || "Server error." }, 500);
  }
}

function normalizeTriage(triage) {
  const risk = ["low", "medium", "high"].includes(triage.risk) ? triage.risk : "medium";

  const route = ["HAIKU", "SONNET"].includes(triage.route)
    ? triage.route
    : risk === "high" ? "SONNET" : "HAIKU";

  return {
    ...triage,
    amount_claimed: normalizeAmount(triage.amount_claimed),
    risk,
    route,
    chance:    clampChance(triage.chance),
    flagCount: normalizeFlagCount(triage),
    teaser:    normalizeTeaser(risk, triage.teaser),
  };
}

function normalizeAmount(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function clampChance(value) {
  const n = Number(value);
  if (Number.isNaN(n)) return 50;
  return Math.min(100, Math.max(0, Math.round(n)));
}

function normalizeFlagCount(triage) {
  return Object.keys(triage)
    .filter(k => k.startsWith("possible_") && triage[k] === true)
    .length;
}

function normalizeTeaser(risk, teaser) {
  if (teaser && typeof teaser === "string" && teaser.trim().length > 10) {
    return teaser.trim();
  }
  const map = {
    high:   "There may be several aspects of this document worth checking carefully before responding or making payment.",
    medium: "There may be aspects of this document that could benefit from further review before payment is considered.",
    low:    "It may still be worth checking the details carefully before responding — some aspects of the claim may not be fully explained.",
  };
  return map[risk] || map.medium;
}
