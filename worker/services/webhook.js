export async function handleStripeWebhook(request, env) {
  const body = await request.text();
  const sig = request.headers.get("stripe-signature");

  const event = await verifyWebhook(env, body, sig);

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;

    await env.PAID_SESSIONS.put(
      session.id,
      JSON.stringify({
        paid: true,
        email: session.customer_details?.email || null
      }),
      { expirationTtl: 60 * 60 * 24 * 7 }
    );
  }

  return new Response("ok");
}

async function verifyWebhook(env, body, signatureHeader) {
  const encoder = new TextEncoder();

  const parts = Object.fromEntries(
    signatureHeader.split(",").map(p => p.split("="))
  );

  const payload = `${parts.t}.${body}`;

  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(env.STRIPE_WEBHOOK_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));

  const hex = [...new Uint8Array(sig)]
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");

  if (hex !== parts.v1) {
    throw new Error("Invalid webhook signature");
  }

  return JSON.parse(body);
}
