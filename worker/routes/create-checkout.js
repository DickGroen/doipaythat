// worker/routes/create-checkout.js — doipaythat

import { jsonResponse } from "../utils/response.js";
import { requireType } from "../config/types.js";

const PRICES = {
  debt: 4900,
  parking: 1900,
  bill: 2900,
  subscription: 2900,
  quote: 2900,
};
 
const PRODUCT_NAMES = {
  debt: "Full analysis + ready-to-send dispute letter",
  parking: "Full analysis + ready-to-send appeal letter",
  bill: "Full analysis + ready-to-send dispute letter",
  subscription: "Full analysis + ready-to-send cancellation letter",
  quote: "Full analysis + ready-to-send response letter",
};

const PRODUCT_DESC = {
  debt:
    "Check the claim before you decide what to do. Includes a full review and a ready-to-send response letter.",
  parking:
    "Check the parking charge before you decide what to do. Includes a full review and a ready-to-send appeal letter.",
  bill:
    "Check the bill before you decide what to do. Includes a full review and a ready-to-send response letter.",
  subscription:
    "Check the subscription or contract before you decide what to do. Includes a full review and a ready-to-send letter.",
  quote:
    "Check the quote before you agree. Includes a full review and a ready-to-send clarification letter.",
};

const SUCCESS_PATH = {
  debt: "debt",
  parking: "parking",
  bill: "bill",
  subscription: "subscription",
  quote: "quote",
};

async function trackEvent(env, event, data = {}) {
  try {
    const id = crypto.randomUUID();
    const key = `track:${data.type || "unknown"}:${event}:${Date.now()}:${id}`;

    await env.DEBT_QUEUE.put(
      key,
      JSON.stringify({
        event,
        ...data,
        received_at: new Date().toISOString(),
      }),
      { expirationTtl: 60 * 60 * 24 * 90 }
    );
  } catch (err) {
    console.error("Track error:", err.message);
  }
}

export async function handleCreateCheckout(request, env) {
  let body;

  try {
    body = await request.json();
  } catch (_) {
    return jsonResponse({ ok: false, error: "Invalid JSON" }, 400);
  }

  const rawType = String(body.type || "").trim();
  const name = String(body.name || "").trim();
  const email = String(body.email || "").trim().toLowerCase();
  const freeSessionId = String(body.freeSessionId || body.free_session_id || "").trim();
  const tier = String(body.tier || "").trim();
  const source = String(body.source || "free_result").trim();

  let type;

  try {
    type = requireType(rawType);
  } catch (err) {
    return jsonResponse({ ok: false, error: err.message }, 400);
  }

  if (!name || !email) {
    return jsonResponse(
      { ok: false, error: "Name and email are required" },
      400
    );
  }

  if (!env.STRIPE_SECRET_KEY) {
    console.error("Missing STRIPE_SECRET_KEY");
    return jsonResponse(
      { ok: false, error: "Checkout is temporarily unavailable." },
      500
    );
  }

  const unitAmount = PRICES[type] || PRICES.debt;
  const origin = new URL(request.url).origin;
  const path = SUCCESS_PATH[type] || type;

  const successUrl =
    `${origin}/${path}/thankyou` +
    `?session_id={CHECKOUT_SESSION_ID}` +
    `&type=${encodeURIComponent(type)}`;

  const cancelUrl = `${origin}/${path}/`;

  const sessionPayload = {
    mode: "payment",
    payment_method_types: ["card"],
    line_items: [
      {
        price_data: {
          currency: "gbp",
          product_data: {
            name: PRODUCT_NAMES[type] || PRODUCT_NAMES.debt,
            description: PRODUCT_DESC[type] || PRODUCT_DESC.debt,
          },
          unit_amount: unitAmount,
        },
        quantity: 1,
      },
    ],
    customer_email: email,
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: {
      name,
      email,
      type,
      tier,
      source,
      free_session_id: freeSessionId,
    },
  };

  let res;

  try {
    res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: encodeStripeParams(sessionPayload),
    });
  } catch (err) {
    console.error("Stripe checkout fetch failed:", err.message);
    return jsonResponse(
      { ok: false, error: "Failed to connect to checkout." },
      500
    );
  }

  if (!res.ok) {
    const errText = await res.text();
    console.error("Stripe checkout session error:", errText);

    await trackEvent(env, "checkout_session_failed", {
      type,
      email,
      value: unitAmount / 100,
      currency: "GBP",
      reason: "stripe_error",
    });

    return jsonResponse(
      { ok: false, error: "Failed to create checkout session." },
      500
    );
  }

  const session = await res.json();

  await trackEvent(env, "checkout_session_created", {
    type,
    email,
    tier: tier || null,
    value: unitAmount / 100,
    currency: "GBP",
    session_id: session.id || null,
  });

  return jsonResponse({
    ok: true,
    url: session.url,
    sessionId: session.id || null,
  });
}

function encodeStripeParams(obj, prefix = "") {
  const parts = [];

  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined) continue;

    const fullKey = prefix ? `${prefix}[${key}]` : key;

    if (typeof value === "object" && !Array.isArray(value)) {
      parts.push(encodeStripeParams(value, fullKey));
      continue;
    }

    if (Array.isArray(value)) {
      value.forEach((item, i) => {
        if (item === null || item === undefined) return;

        if (typeof item === "object") {
          parts.push(encodeStripeParams(item, `${fullKey}[${i}]`));
        } else {
          parts.push(
            `${encodeURIComponent(`${fullKey}[${i}]`)}=${encodeURIComponent(item)}`
          );
        }
      });

      continue;
    }

    parts.push(`${encodeURIComponent(fullKey)}=${encodeURIComponent(value)}`);
  }

  return parts.filter(Boolean).join("&");
}
