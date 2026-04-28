const STRIPE_API = "https://api.stripe.com/v1";

/**
 * Retrieve a Checkout Session from Stripe and verify it is paid.
 * Returns the session object or throws if invalid.
 */
export async function verifySession(env, sessionId) {
  if (!sessionId || (!sessionId.startsWith("cs_live_") && !sessionId.startsWith("cs_test_"))) {
    throw new Error("Invalid session ID");
  }

  const res = await fetch(`${STRIPE_API}/checkout/sessions/${sessionId}`, {
    headers: { "Authorization": `Bearer ${env.STRIPE_SECRET_KEY}` }
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Stripe API error: ${err}`);
  }

  const session = await res.json();

  if (session.payment_status !== "paid") {
    throw new Error(`Payment not completed (status: ${session.payment_status})`);
  }

  return session;
}

/**
 * Get the correct Stripe payment link for a given type.
 * Falls back to STRIPE_LINK_DEBT if type-specific link is missing.
 */
export function getStripeLink(env, type) {
  const key = `STRIPE_LINK_${type.toUpperCase()}`;
  return env[key] || env.STRIPE_LINK_DEBT || "https://doipaythis.co.uk";
}
