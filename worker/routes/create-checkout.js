// worker/routes/create-checkout.js — mussichzahlen

import { jsonResponse } from "../utils/response.js";
import { requireType } from "../config/types.js";

const PRICES = {
  mahnung:    1900,
  parkstrafe: 1900,
  rechnung:   2900,
  vertrag:    2900,
  angebot:    1900,
};

const PRODUCT_NAMES = {
  mahnung:    "Vollständige Analyse + fertiges Widerspruchsschreiben",
  parkstrafe: "Vollständige Analyse + fertiges Einspruchsschreiben",
  rechnung:   "Vollständige Analyse + fertiges Widerspruchsschreiben",
  vertrag:    "Vollständige Analyse + fertiges Kündigungsschreiben",
  angebot:    "Vollständige Analyse + fertige Verhandlungsnachricht",
};

const PRODUCT_DESC = {
  mahnung:
    "Prüfe die Forderung bevor du reagierst. Inkl. vollständiger Analyse und fertigem Widerspruchsschreiben.",
  parkstrafe:
    "Prüfe den Bescheid bevor du zahlst. Inkl. vollständiger Analyse und fertigem Einspruchsschreiben.",
  rechnung:
    "Prüfe die Rechnung bevor du zahlst. Inkl. vollständiger Analyse und fertigem Widerspruchsschreiben.",
  vertrag:
    "Prüfe deinen Vertrag bevor du weiter zahlst. Inkl. vollständiger Analyse und fertigem Kündigungsschreiben.",
  angebot:
    "Prüfe das Angebot bevor du unterschreibst. Inkl. vollständiger Analyse und fertiger Verhandlungsnachricht.",
};

const SUCCESS_PATH = {
  mahnung:    "mahnung",
  parkstrafe: "parkstrafe",
  rechnung:   "rechnung",
  vertrag:    "vertrag",
  angebot:    "angebot",
};

async function trackEvent(env, event, data = {}) {
  try {
    const id  = crypto.randomUUID();
    const key = `track:${data.type || "unknown"}:${event}:${Date.now()}:${id}`;

    await env.SESSIONS_KV.put(
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
    return jsonResponse({ ok: false, error: "Ungültiges JSON" }, 400);
  }

  const rawType       = String(body.type          || "").trim();
  const name          = String(body.name          || "").trim();
  const email         = String(body.email         || "").trim().toLowerCase();
  const freeSessionId = String(body.freeSessionId || body.free_session_id || "").trim();
  const tier          = String(body.tier          || "").trim();
  const source        = String(body.source        || "free_result").trim();

  let type;

  try {
    type = requireType(rawType);
  } catch (err) {
    return jsonResponse({ ok: false, error: err.message }, 400);
  }

  if (!name || !email) {
    return jsonResponse(
      { ok: false, error: "Name und E-Mail sind erforderlich." },
      400
    );
  }

  if (!env.STRIPE_SECRET_KEY) {
    console.error("Missing STRIPE_SECRET_KEY");
    return jsonResponse(
      { ok: false, error: "Checkout ist vorübergehend nicht verfügbar." },
      500
    );
  }

  const unitAmount = PRICES[type] || PRICES.mahnung;
  const origin     = env.SITE_URL || new URL(request.url).origin;
  const path       = SUCCESS_PATH[type] || type;

  const successUrl =
    `${origin}/${path}/danke` +
    `?session_id={CHECKOUT_SESSION_ID}` +
    `&type=${encodeURIComponent(type)}`;

  const cancelUrl = `${origin}/${path}/`;

  const sessionPayload = {
    mode:                 "payment",
    payment_method_types: ["card"],
    line_items: [
      {
        price_data: {
          currency: "eur",
          product_data: {
            name:        PRODUCT_NAMES[type] || PRODUCT_NAMES.mahnung,
            description: PRODUCT_DESC[type]  || PRODUCT_DESC.mahnung,
          },
          unit_amount: unitAmount,
        },
        quantity: 1,
      },
    ],
    customer_email: email,
    success_url:    successUrl,
    cancel_url:     cancelUrl,
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
      method:  "POST",
      headers: {
        Authorization:  `Bearer ${env.STRIPE_SECRET_KEY}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: encodeStripeParams(sessionPayload),
    });
  } catch (err) {
    console.error("Stripe checkout fetch fehlgeschlagen:", err.message);
    return jsonResponse(
      { ok: false, error: "Verbindung zum Checkout fehlgeschlagen." },
      500
    );
  }

  if (!res.ok) {
    const errText = await res.text();
    console.error("Stripe checkout session Fehler:", errText);

    await trackEvent(env, "checkout_session_failed", {
      type,
      email,
      value:    unitAmount / 100,
      currency: "EUR",
      reason:   "stripe_error",
    });

    return jsonResponse(
      { ok: false, error: "Checkout-Sitzung konnte nicht erstellt werden." },
      500
    );
  }

  const session = await res.json();

  await trackEvent(env, "checkout_session_created", {
    type,
    email,
    tier:       tier || null,
    value:      unitAmount / 100,
    currency:   "EUR",
    session_id: session.id || null,
  });

  return jsonResponse({
    ok:        true,
    url:       session.url,
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
