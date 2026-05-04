// worker/routes/create-checkout.js

import { jsonResponse } from "../utils/response.js";
import { requireType } from "../config/types.js";

const PRICES = {
  debt:         4900,
  parking:      1900,
  bill:         2900,
  subscription: 2900,
  quote:        2900,
};

const PRODUCT_NAMES = {
  debt:         "Full analysis + ready-to-send dispute letter",
  parking:      "Full analysis + ready-to-send appeal letter",
  bill:         "Full analysis + ready-to-send dispute letter",
  subscription: "Full analysis + ready-to-send cancellation letter",
  quote:        "Full analysis + ready-to-send response letter",
};

const PRODUCT_DESC = {
  debt:         "Before you pay this debt, make sure you understand it. Get a clear answer and a ready-to-send letter.",
  parking:      "Before you pay this fine, make sure you understand it. Get a clear answer and a ready-to-send appeal.",
  bill:         "Before you pay this bill, make sure you understand it. Get a clear answer and a ready-to-send letter.",
  subscription: "Check this charge before you pay. Get a clear answer and a ready-to-send letter.",
  quote:        "Check this quote before you agree. Get a clear answer and a ready-to-send letter.",
};

export async function handleCreateCheckout(request, env) {
  let body;

  try {
    body = await request.json();
  } catch (_) {
    return jsonResponse({ ok: false, error: "Invalid JSON" }, 400);
  }

  const rawType = String(body.type || "").trim();
  const name    = String(body.name || "").trim();
  const email   = String(body.email || "").trim();
  const freeSessionId = String(body.freeSessionId || "").trim();

  let type;
  try {
    type = requireType(rawType);
  } catch (err) {
    return jsonResponse({ ok: false, error: err.message }, 400);
  }

  if (!name || !email) {
    return jsonResponse({ ok: false, error: "Name and email are required" }, 400);
  }

  const unitAmount = PRICES[type] || 4900;
  const origin     = new URL(request.url).origin;

  const sessionPayload = {
    mode: "payment",
    payment_method_types: ["card"],
    line_items: [
      {
        price_data: {
          currency: "gbp",
          product_data: {
            name:        PRODUCT_NAMES[type] || PRODUCT_NAMES.debt,
            description: PRODUCT_DESC[type]  || PRODUCT_DESC.debt,
          },
          unit_amount: unitAmount,
        },
        quantity: 1,
      },
    ],
    customer_email: email,
    success_url: `${origin}/${type}/thankyou?session_id={CHECKOUT_SESSION_ID}&type=${encodeURIComponent(type)}`,
    cancel_url:  `${origin}/${type}/`,
    metadata: {
      name,
      email,
      type,
      free_session_id: freeSessionId,
    },
  };

  const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization:  `Bearer ${env.STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: encodeStripeParams(sessionPayload),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error("Stripe checkout session error:", err);
    return jsonResponse({ ok: false, error: "Failed to create checkout session" }, 500);
  }

  const session = await res.json();

  return jsonResponse({
    ok:  true,
    url: session.url,
  });
}

function encodeStripeParams(obj, prefix = "") {
  const parts = [];

  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}[${key}]` : key;

    if (value === null || value === undefined) continue;

    if (typeof value === "object" && !Array.isArray(value)) {
      parts.push(encodeStripeParams(value, fullKey));
    } else if (Array.isArray(value)) {
      value.forEach((item, i) => {
        if (typeof item === "object") {
          parts.push(encodeStripeParams(item, `${fullKey}[${i}]`));
        } else {
          parts.push(`${encodeURIComponent(`${fullKey}[${i}]`)}=${encodeURIComponent(item)}`);
        }
      });
    } else {
      parts.push(`${encodeURIComponent(fullKey)}=${encodeURIComponent(value)}`);
    }
  }

  return parts.join("&");
}
