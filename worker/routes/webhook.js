import { json } from "../utils/response.js";

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
    return json(
      {
        ok: false,
        error: "Invalid webhook signature"
      },
      400
    );
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;

        console.log("Payment completed:", {
          sessionId: session.id,
          customerEmail: session.customer_details?.email,
          amountTotal: session.amount_total,
          currency: session.currency,
          metadata: session.metadata
        });

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

    return json(
      {
        ok: false,
        error: "Webhook processing failed"
      },
      500
    );
  }
}

async function verifyStripeWebhook(rawBody, signatureHeader, webhookSecret) {
  if (!webhookSecret) {
    throw new Error("Missing STRIPE_WEBHOOK_SECRET");
  }

  const parts = signatureHeader.split(",");
  const timestampPart = parts.find((part) => part.startsWith("t="));
  const signaturePart = parts.find((part) => part.startsWith("v1="));

  if (!timestampPart || !signaturePart) {
    throw new Error("Invalid Stripe signature header");
  }

  const timestamp = timestampPart.replace("t=", "");
  const signature = signaturePart.replace("v1=", "");

  const signedPayload = `${timestamp}.${rawBody}`;

  const encoder = new TextEncoder();

  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(webhookSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signed = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(signedPayload)
  );

  const expectedSignature = bufferToHex(signed);

  if (!secureCompare(expectedSignature, signature)) {
    throw new Error("Webhook signature mismatch");
  }

  return JSON.parse(rawBody);
}

function bufferToHex(buffer) {
  return [...new Uint8Array(buffer)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function secureCompare(a, b) {
  if (a.length !== b.length) return false;

  let result = 0;

  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }

  return result === 0;
}
