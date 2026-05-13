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

function getTriageDecision({ chance, flags, risk, tier }) {
  const c = Number(chance) || 0;
  const f = Number(flags) || 0;

  if (["tier1", "tier2", "tier3"].includes(tier)) {
    return {
      tier,
      showUpsell: tier !== "tier3",
      emailType: tier === "tier1" ? "strong" : tier === "tier2" ? "soft" : "trust",
    };
  }

  if (risk === "high" || (c >= 60 && f >= 2)) {
    return { tier: "tier1", showUpsell: true, emailType: "strong" };
  }

  if (risk === "medium" || c >= 40 || f === 1) {
    return { tier: "tier2", showUpsell: true, emailType: "soft" };
  }

  return { tier: "tier3", showUpsell: false, emailType: "trust" };
}

export async function handleAnalyzeFree(request, env) {
  try {
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

    if (!prompts?.triage) {
      return jsonResponse(
        { ok: false, error: `Triage prompt not found for type: ${type}` },
        500
      );
    }

    const raw = await runTriage(env, {
      fileBase64: base64,
      mediaType,
      triagePrompt: prompts.triage,
    });

    const triage = normalizeTriage(
      safeJsonParse(raw) || fallbackTriage(type)
    );

    console.log("FREE TRIAGE:", JSON.stringify(triage));

    const decision = getTriageDecision({
      chance: triage.chance,
      flags: triage.flagCount,
      risk: triage.risk,
      tier: triage.tier,
    });

    triage.tier = decision.tier;
    triage.emailType = decision.emailType;

    if (!triage.currency) {
      triage.currency = "GBP";
    }

    const stripeLink = decision.showUpsell ? getStripeLink(env, type) : null;

    console.log("FREE DECISION:", JSON.stringify(decision));
    console.log("FREE STRIPE LINK:", stripeLink);

    await saveFreeCase(env, {
      type,
      rawType,
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

    await enqueueFree(env, {
      type,
      rawType,
      name,
      email,
      triage,
      stripeLink,
    });

    console.log("enqueueFree: OK");

    try {
      await sendConfirmationEmail(env, { name, email, type });
      console.log("sendConfirmationEmail: OK");
    } catch (err) {
      console.error("sendConfirmationEmail FAILED:", err.message);
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
      console.error("notifyAdminFree FAILED:", err.message);
    }

    try {
      await sendFreeEmail(env, {
        name,
        email,
        type,
        rawType,
        triage,
        stripeLink,
        stage: 1,
      });

      console.log("sendFreeEmail stage 1: OK");
    } catch (err) {
      console.error("sendFreeEmail stage 1 FAILED:", err.message);
    }

    return jsonResponse({
      ok: true,
      type,
      tier: decision.tier,
      emailType: decision.emailType,
      stripeLink,
      triage: publicTriage(triage),
      teaser: {
        chancePercent: triage.chance,
        text: triage.teaser,
        stripeLink,
      },
      message: "Your first assessment is ready.",
    });
  } catch (err) {
    console.error("handleAnalyzeFree FAILED:", err?.message, err?.stack);

    return jsonResponse(
      {
        ok: false,
        error: err?.message || "Server error during analysis.",
      },
      500
    );
  }
}

function fallbackTriage(type) {
  return {
    documentType: type || "other",
    sender: null,
    amount_claimed: null,
    currency: "GBP",
    risk: "medium",
    tier: "tier2",
    route: "SONNET",
    chance: 50,
    flagCount: 0,
    teaser:
      "There may be aspects of this document that could benefit from further review before payment is considered.",
    consumer_position:
      "Some elements may require clarification before a final decision is made.",
  };
}

function normalizeTriage(triage = {}) {
  const risk = normalizeRisk(triage.risk);
  const route = normalizeRoute(triage.route, risk);
  const chance = clampChance(triage.chance);
  const flagCount = normalizeFlagCount(triage);
  const tier = normalizeTier(triage.tier, risk, chance, flagCount);

  return {
    ...triage,

    documentType: normalizeText(triage.documentType),
    sender: normalizeText(triage.sender),
    claim_type: normalizeText(triage.claim_type),
    bill_type: normalizeText(triage.bill_type),
    contract_type: normalizeText(triage.contract_type),
    operator_type: normalizeText(triage.operator_type),

    amount_claimed: normalizeAmount(triage.amount_claimed),
    monthly_cost: normalizeAmount(triage.monthly_cost),
    currency: normalizeCurrency(triage.currency),

    risk,
    route,
    chance,
    flagCount,
    tier,

    emailType:
      triage.emailType ||
      (tier === "tier1" ? "strong" : tier === "tier2" ? "soft" : "trust"),

    teaser: normalizeTeaser(risk, triage.teaser),
    consumer_position: normalizeConsumerPosition(
      tier,
      triage.consumer_position
    ),
  };
}

function publicTriage(triage) {
  return {
    documentType: triage.documentType ?? null,
    sender: triage.sender ?? null,

    claim_type: triage.claim_type ?? null,
    bill_type: triage.bill_type ?? null,
    contract_type: triage.contract_type ?? null,
    operator_type: triage.operator_type ?? null,

    amount_claimed: triage.amount_claimed ?? null,
    monthly_cost: triage.monthly_cost ?? null,
    currency: triage.currency ?? "GBP",

    risk: triage.risk,
    tier: triage.tier,
    chance: triage.chance,
    flagCount: triage.flagCount,
    teaser: triage.teaser,
    route: triage.route,
    consumer_position: triage.consumer_position,

    possible_old_debt: triage.possible_old_debt ?? null,
    possible_excessive_fees: triage.possible_excessive_fees ?? null,
    possible_no_proof: triage.possible_no_proof ?? null,
    possible_wrong_person: triage.possible_wrong_person ?? null,
    possible_pressure_language: triage.possible_pressure_language ?? null,

    possible_ntk_timing_defect: triage.possible_ntk_timing_defect ?? null,
    possible_signage_defect: triage.possible_signage_defect ?? null,
    possible_grace_period_failure: triage.possible_grace_period_failure ?? null,
    possible_anpr_timing_issue: triage.possible_anpr_timing_issue ?? null,
    possible_landowner_authority_missing:
      triage.possible_landowner_authority_missing ?? null,
    possible_wrong_vehicle_or_location:
      triage.possible_wrong_vehicle_or_location ?? null,
    possible_procedural_defect: triage.possible_procedural_defect ?? null,
    possible_disproportionate_charge:
      triage.possible_disproportionate_charge ?? null,
    possible_pofa_keeper_liability_failure:
      triage.possible_pofa_keeper_liability_failure ?? null,

    possible_estimated_reading: triage.possible_estimated_reading ?? null,
    possible_wrong_tariff: triage.possible_wrong_tariff ?? null,
    possible_duplicate_charge: triage.possible_duplicate_charge ?? null,
    possible_exit_fee_invalid: triage.possible_exit_fee_invalid ?? null,
    possible_missing_breakdown: triage.possible_missing_breakdown ?? null,
    possible_unclear_terms: triage.possible_unclear_terms ?? null,

    possible_auto_renewal_invalid:
      triage.possible_auto_renewal_invalid ?? null,
    possible_price_increase_exit_right:
      triage.possible_price_increase_exit_right ?? null,
    possible_cancellation_blocked:
      triage.possible_cancellation_blocked ?? null,
    possible_cooling_off_applies:
      triage.possible_cooling_off_applies ?? null,
    possible_hidden_fees: triage.possible_hidden_fees ?? null,

    possible_overpriced: triage.possible_overpriced ?? null,
    possible_unclear_scope: triage.possible_unclear_scope ?? null,
    possible_hidden_costs: triage.possible_hidden_costs ?? null,
    possible_no_breakdown: triage.possible_no_breakdown ?? null,
  };
}

function normalizeRisk(value) {
  return ["low", "medium", "high"].includes(value) ? value : "medium";
}

function normalizeRoute(value, risk) {
  if (["HAIKU", "SONNET"].includes(value)) return value;
  return risk === "high" ? "SONNET" : "HAIKU";
}

function normalizeTier(value, risk, chance, flagCount) {
  if (["tier1", "tier2", "tier3"].includes(value)) return value;

  if (risk === "high" || chance >= 60 || flagCount >= 2) return "tier1";
  if (risk === "medium" || chance >= 40 || flagCount === 1) return "tier2";
  return "tier3";
}

function normalizeCurrency(value) {
  const c = String(value || "").toUpperCase();

  if (["GBP", "EUR", "USD"].includes(c)) return c;
  if (c === "£") return "GBP";
  if (c === "€") return "EUR";
  if (c === "$") return "USD";

  return "GBP";
}

function normalizeAmount(value) {
  if (value === null || value === undefined || value === "") return null;

  if (typeof value === "string") {
    const cleaned = value.replace(/[£€$,]/g, "").trim();
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }

  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeText(value) {
  if (value === null || value === undefined) return null;

  const text = String(value).trim();
  return text ? text : null;
}

function clampChance(value) {
  const n = Number(value);

  if (Number.isNaN(n)) return 50;

  return Math.min(100, Math.max(0, Math.round(n)));
}

function normalizeFlagCount(triage = {}) {
  if (Number.isFinite(Number(triage.flagCount))) {
    return Math.min(12, Math.max(0, Math.round(Number(triage.flagCount))));
  }

  const flags = Object.entries(triage)
    .filter(([key]) => key.startsWith("possible_"))
    .map(([, value]) => value);

  return flags.filter((v) => v === true).length;
}

function normalizeTeaser(risk, teaser) {
  const map = {
    high:
      "There may be important aspects of this document worth checking carefully before responding or making payment.",
    medium:
      "There may be aspects of this document that could benefit from further review before payment is considered.",
    low:
      "Some parts of this document may require clarification before a final decision is made.",
  };

  const allowed = new Set(Object.values(map));

  if (allowed.has(teaser)) return teaser;

  return map[risk] || map.medium;
}

function normalizeConsumerPosition(tier, value) {
  const text = normalizeText(value);

  if (text) return text;

  if (tier === "tier1") {
    return "The document may contain aspects worth reviewing carefully before payment is considered.";
  }

  if (tier === "tier2") {
    return "Some elements may require clarification or supporting evidence before a final decision is made.";
  }

  return "Based on the visible information, the document currently appears relatively standard, although further review remains optional.";
}
