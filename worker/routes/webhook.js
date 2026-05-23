// worker/routes/webhook.js

import { json } from "../utils/response.js";
import { getFreeCase, markPaid, enqueuePaid } from "../services/queue.js";
import { requireType } from "../config/types.js";

const ALLOWED_TYPES = ["debt", "parking", "bill", "subscription", "quote"];

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

async function hasAnalysisBeenSent(env, sessionId) {
  if (!sessionId) return false;

  const key = `analysis_sent:${sessionId}`;
  const val = await env.DEBT_QUEUE.get(key);

  return val === "1";
}

async function markAnalysisSent(env, sessionId) {
  if (!sessionId) return;

  const key = `analysis_sent:${sessionId}`;

  await env.DEBT_QUEUE.put(key, "1", {
    expirationTtl: 60 * 60 * 24 * 30,
  });
}

async function findFreeCase(env, email, preferredType = null) {
  if (!email) {
    return { saved: null, type: null };
  }

  const orderedTypes = [];

  if (preferredType) {
    orderedTypes.push(preferredType);
  }

  for (const type of ALLOWED_TYPES) {
    if (!orderedTypes.includes(type)) {
      orderedTypes.push(type);
    }
  }

  // Stap 1: exacte lookup op email+type
  for (const type of orderedTypes) {
    const saved = await getFreeCase(env, { type, email });
    if (saved) {
      console.log(`FREE CASE FOUND (exact): type=${type}, email=${email}`);
      return { saved, type };
    }
  }

  // Stap 2: fallback via KV list scan — Stripe email kan afwijken van formulier email
  console.warn(`Exact lookup failed for ${email} — fallback to KV list scan`);
  try {
    const normalizedEmail = String(email || "").trim().toLowerCase();
    let cursor;
    do {
      const list = await env.DEBT_QUEUE.list(cursor
        ? { prefix: "free_case:", cursor }
        : { prefix: "free_case:" }
      );
      cursor = list.cursor;

      for (const key of list.keys) {
        try {
          const raw = await env.DEBT_QUEUE.get(key.name);
          if (!raw) continue;
          const entry = JSON.parse(raw);
          if (!entry?.file_base64 || !entry?.triage) continue;
          const storedEmail = String(entry.email || "").trim().toLowerCase();
          if (storedEmail !== normalizedEmail) continue;
          const type = entry.type || key.name.split(":")[1];
          if (!ALLOWED_TYPES.includes(type)) continue;
          console.log(`FREE CASE FOUND (list scan): key=${key.name}, email=${storedEmail}`);
          return { saved: entry, type };
        } catch (_) {}
      }
    } while (cursor);
  } catch (err) {
    console.error("KV list scan failed:", err.message);
  }

  console.warn(`NO FREE CASE FOUND for email=${email}`);
  return { saved: null, type: null };
}

export async function handleStripeWebhook(request, env, ctx) {
  const signature = request.headers.get("stripe-signature");

  if (!signature) {
    return json({ ok: false, error: "Missing Stripe signature" }, 400);
  }

  let rawBody;

  try {
    rawBody = await request.text();
  } catch {
    return json({ ok: false, error: "Unable to read webhook body" }, 400);
  }

  let event;

  try {
    event = await verifyStripeWebhook(
      rawBody,
      signature,
      env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error("Invalid webhook signature:", err.message);
    return json({ ok: false, error: "Invalid webhook signature" }, 400);
  }

  const work = handleStripeEvent(event, env).catch((err) => {
    console.error("Webhook background processing failed:", err.message, err.stack);
  });

  if (ctx?.waitUntil) {
    ctx.waitUntil(work);
  } else {
    await work;
  }

  return json({ ok: true });
}

async function handleStripeEvent(event, env) {
  if (event.type !== "checkout.session.completed") {
    console.log("Webhook event skipped:", event.type);
    return;
  }

  const session = event.data.object;

  if (session.payment_status !== "paid") {
    console.log("Session not paid yet:", session.id);
    return;
  }

  if (await hasAnalysisBeenSent(env, session.id)) {
    console.log("Duplicate webhook — already processed:", session.id);
    return;
  }

  const email =
    session.metadata?.email ||
    session.customer_details?.email ||
    session.customer_email ||
    null;

  const name =
    session.metadata?.name ||
    session.customer_details?.name ||
    "Customer";

  const rawType =
    session.metadata?.type ||
    session.metadata?.product ||
    null;

  let preferredType = null;

  if (rawType) {
    try {
      preferredType = requireType(rawType);
    } catch {
      preferredType = null;
    }
  }

  const currency = String(session.currency || "gbp").toUpperCase();
  const value = Number(session.amount_total || 0) / 100;

  console.log("WEBHOOK PAID:", {
    session_id: session.id,
    email,
    payment_status: session.payment_status,
    preferredType,
    value,
    currency,
  });

  if (!email) {
    console.error("No email found in webhook session:", session.id);

    await env.DEBT_QUEUE.put(
      `paid_missing_email:${session.id}:${Date.now()}`,
      JSON.stringify({
        session_id: session.id,
        reason: "paid_but_no_email_found",
        received_at: new Date().toISOString(),
      }),
      { expirationTtl: 60 * 60 * 24 * 30 }
    );

    return;
  }

  await markPaid(env, email);

  await trackEvent(env, "payment_success", {
    type: preferredType || "unknown",
    email,
    value,
    currency,
    session_id: session.id,
  });

  const { saved, type } = await findFreeCase(env, email, preferredType);

  if (!saved?.file_base64 || !saved?.media_type || !saved?.triage) {
    console.error("NO USABLE FREE CASE FOUND:", {
      email,
      session_id: session.id,
      preferredType,
    });

    await env.DEBT_QUEUE.put(
      `paid_missing_free_case:${email}:${Date.now()}`,
      JSON.stringify({
        name,
        email,
        preferredType,
        session_id: session.id,
        value,
        currency,
        reason: "paid_but_no_saved_free_case",
        received_at: new Date().toISOString(),
      }),
      { expirationTtl: 60 * 60 * 24 * 30 }
    );

    return;
  }

  const customerName = saved.name || name;
  const finalType = type || preferredType || saved.type || "debt";

  await enqueuePaid(env, {
    type: finalType,
    rawType: rawType || finalType,
    name: customerName,
    email,
    sessionId: session.id,
    payment: {
      sessionId: session.id,
      value,
      currency,
      payment_status: session.payment_status,
    },
    triage: saved.triage,
    analysis: null,
    file_base64: saved.file_base64,
    media_type: saved.media_type,
    fileName: saved.fileName || saved.file_name || null,
    fileSize: saved.fileSize || saved.file_size || null,
  });

  console.log("PAID QUEUED FOR CRON:", {
    email,
    type: finalType,
    session_id: session.id,
  });

  await markAnalysisSent(env, session.id);
}

async function verifyStripeWebhook(rawBody, signatureHeader, webhookSecret) {
  if (!webhookSecret) {
    throw new Error("Missing STRIPE_WEBHOOK_SECRET");
  }

  const parts = signatureHeader.split(",");
  const timestampPart = parts.find((p) => p.startsWith("t="));
  const signatureParts = parts
    .filter((p) => p.startsWith("v1="))
    .map((p) => p.replace("v1=", ""));

  if (!timestampPart || signatureParts.length === 0) {
    throw new Error("Invalid Stripe signature header");
  }

  const timestamp = timestampPart.replace("t=", "");
  const signed = `${timestamp}.${rawBody}`;
  const encoder = new TextEncoder();

  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(webhookSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const result = await crypto.subtle.sign("HMAC", key, encoder.encode(signed));

  const expected = [...new Uint8Array(result)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  const matched = signatureParts.some((signature) =>
    secureCompare(expected, signature)
  );

  if (!matched) {
    throw new Error("Webhook signature mismatch");
  }

  return JSON.parse(rawBody);
}

function secureCompare(a, b) {
  if (!a || !b || a.length !== b.length) {
    return false;
  }

  let result = 0;

  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }

  return result === 0;
}
