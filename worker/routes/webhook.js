// worker/routes/webhook.js

import { json } from "../utils/response.js";
import { getFreeCase, markPaid, enqueuePaid } from "../services/queue.js";
import { notifyAdminPaid } from "../services/resend.js";
import { runAnalysis } from "../services/claude.js";
import { loadPrompts } from "../config/prompts.js";
import { requireType } from "../config/types.js";

async function trackEvent(env, event, data = {}) {
  try {
    const id  = crypto.randomUUID();
    const key = `track:${data.type || "unknown"}:${event}:${Date.now()}:${id}`;
    await env.DEBT_QUEUE.put(key, JSON.stringify({
      event,
      ...data,
      received_at: new Date().toISOString(),
    }), { expirationTtl: 60 * 60 * 24 * 90 });
  } catch (err) {
    console.error("Track error:", err.message);
  }
}

export async function handleStripeWebhook(request, env) {
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
    event = await verifyStripeWebhook(rawBody, signature, env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return json({ ok: false, error: "Invalid webhook signature" }, 400);
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;

        if (session.payment_status !== "paid") {
          console.log("Session not paid yet:", session.id);
          break;
        }

        const email   = session.metadata?.email || session.customer_details?.email || null;
        const name    = session.metadata?.name  || session.customer_details?.name  || "Customer";
        const rawType = session.metadata?.type  || "debt";

        let type;
        try {
          type = requireType(rawType);
        } catch {
          type = "debt";
        }

        console.log("Payment completed:", { sessionId: session.id, email, type });

        // Track payment success
        await trackEvent(env, "payment_success", {
          type,
          email,
          value:    (session.amount_total || 4900) / 100,
          currency: session.currency || "gbp",
          session_id: session.id,
        });

        // Mark as paid — stops recovery sequence
        if (email) {
          await markPaid(env, email);
        }

        // Try to find free case for automatic analysis
        const saved = email ? await getFreeCase(env, { type, email }) : null;

        if (saved?.file_base64 && saved?.media_type && saved?.triage) {
          console.log("Free case found — running analysis automatically");

          try {
            const prompts  = await loadPrompts(type);
            const triage   = saved.triage;

            const analysis = await runAnalysis(env, {
              fileBase64:   saved.file_base64,
              mediaType:    saved.media_type,
              route:        triage.route || "SONNET",
              haikuPrompt:  prompts.haiku,
              sonnetPrompt: prompts.sonnet,
            });

            await enqueuePaid(env, {
              type,
              name:  saved.name || name,
              email,
              triage,
              analysis,
            });

            await notifyAdminPaid(env, {
              name:  saved.name || name,
              email,
              type,
              triage,
              analysis,
            });

            console.log("Analysis queued for:", email);
          } catch (err) {
            console.error("Auto analysis failed:", err.message);
          }
        } else {
          console.log("No free case found — fallback upload needed for:", email);
        }

        break;
      }

      case "payment_intent.succeeded": {
        console.log("Payment intent succeeded:", event.data.object.id);
        break;
      }

      default: {
        console.log("Unhandled Stripe event:", event.type);
      }
    }

    return json({ ok: true });
  } catch (err) {
    console.error("Webhook processing error:", err);
    return json({ ok: false, error: "Webhook processing failed" }, 500);
  }
}

async function verifyStripeWebhook(rawBody, signatureHeader, webhookSecret) {
  if (!webhookSecret) {
    throw new Error("Missing STRIPE_WEBHOOK_SECRET");
  }

  const parts         = signatureHeader.split(",");
  const timestampPart = parts.find(p => p.startsWith("t="));
  const signaturePart = parts.find(p => p.startsWith("v1="));

  if (!timestampPart || !signaturePart) {
    throw new Error("Invalid Stripe signature header");
  }

  const timestamp = timestampPart.replace("t=", "");
  const signature = signaturePart.replace("v1=", "");
  const signed    = `${timestamp}.${rawBody}`;

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
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");

  if (!secureCompare(expected, signature)) {
    throw new Error("Webhook signature mismatch");
  }

  return JSON.parse(rawBody);
}

function secureCompare(a, b) {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}
