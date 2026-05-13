// worker/routes/track.js

import { jsonResponse } from "../utils/response.js";
import { saveAbandoned } from "../services/queue.js";
import { requireType } from "../config/types.js";

const TRACK_TTL_SECONDS = 60 * 60 * 24 * 90; // 90 days

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeType(value) {
  try {
    return requireType(String(value || "").trim());
  } catch {
    return "unknown";
  }
}

function isTier3(payload = {}) {
  return (
    payload?.tier === "tier3" ||
    payload?.triage?.tier === "tier3" ||
    payload?.emailType === "trust" ||
    payload?.triage?.emailType === "trust"
  );
}

function getStripeLink(payload = {}) {
  return (
    payload.stripeLink ||
    payload.stripe_link ||
    payload.paymentLink ||
    payload.checkoutUrl ||
    null
  );
}

export async function handleTrack(request, env) {
  let payload;

  try {
    payload = await request.json();
  } catch (_) {
    return jsonResponse({ ok: false, error: "Invalid JSON" }, 400);
  }

  const event = String(payload.event || "").trim();

  if (!event) {
    return jsonResponse({ ok: false, error: "Event missing" }, 400);
  }

  const type = normalizeType(payload.type || "unknown");
  const email = normalizeEmail(payload.email);
  const id = crypto.randomUUID();

  const entry = {
    ...payload,
    event,
    type,
    email: email || null,
    received_at: new Date().toISOString(),
    user_agent: request.headers.get("user-agent") || null,
    ip_country: request.headers.get("cf-ipcountry") || null,
    referer: request.headers.get("referer") || null,
  };

  const key = `track:${type}:${event}:${Date.now()}:${id}`;

  try {
    await env.DEBT_QUEUE.put(key, JSON.stringify(entry), {
      expirationTtl: TRACK_TTL_SECONDS,
    });
  } catch (err) {
    console.error("Track KV error:", err.message);
  }

  // When Stripe / checkout link is clicked — save abandoned entry.
  // Tier 3 should not receive abandoned checkout pressure emails.
  if (
    ["stripe_clicked", "checkout_clicked", "payment_clicked"].includes(event) &&
    email &&
    payload.name &&
    getStripeLink(payload) &&
    !isTier3(payload)
  ) {
    try {
      await saveAbandoned(env, {
        email,
        name: String(payload.name || "").trim(),
        type: type === "unknown" ? "debt" : type,
        rawType: payload.rawType || payload.type || null,
        amount: payload.amount || null,
        stripeLink: getStripeLink(payload),
        tier: payload.tier || payload.triage?.tier || null,
        emailType: payload.emailType || payload.triage?.emailType || null,
        triage: payload.triage || null,
      });
    } catch (err) {
      console.error("Abandoned save error:", err.message);
    }
  }

  return jsonResponse({ ok: true });
}
