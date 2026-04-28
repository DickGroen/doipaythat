export async function handleStripeWebhook(request, env) {
  const body = await request.text();
  const sig = request.headers.get("stripe-signature");

  if (!sig) {
    return new Response("Missing Stripe signature", { status: 400 });
  }

  const event = await verifyWebhook(env, body, sig);

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;

    await env.PAID_SESSIONS.put(
      session.id,
      JSON.stringify({
        paid: true,
        email: session.customer_details?.email || null,
        amount: session.amount_total || null,
        currency: session.currency || null,
        created_at: new Date().toISOString()
      }),
      { expirationTtl: 60 * 60 * 24 * 7 }
    );
  }

  return new Response("ok", { status: 200 });
}
