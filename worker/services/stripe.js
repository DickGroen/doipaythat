// worker/services/stripe.js

const STRIPE_API = "https://api.stripe.com/v1";

export async function verifySession(env, sessionId) {
  if (!sessionId || (!sessionId.startsWith("cs_live_") && !sessionId.startsWith("cs_test_"))) {
    throw new Error("Invalid session ID");
  }

  const res = await fetch(`${STRIPE_API}/checkout/sessions/${sessionId}`, {
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`
    }
  });

  if (!res.ok) {
    throw new Error(await res.text());
  }

  const session = await res.json();

  if (session.payment_status !== "paid") {
    throw new Error("Payment not completed");
  }

  return {
    session,
    email: session.customer_details?.email || null
  };
}

export async function verifyPaidSession(env, sessionId) {
  const record = await env.PAID_SESSIONS.get(sessionId, "json");

  if (!record || !record.paid) {
    throw new Error("Payment not verified");
  }

  return record;
}

export function getStripeLink(env, type) {
  const key = `STRIPE_LINK_${String(type).toUpperCase()}`;

  // Use env secret if set, otherwise fall back to type-specific page
  if (env[key]) return env[key];

  const pages = {
    debt:         'https://doipaythat.co.uk/debt/#free-check',
    parking:      'https://doipaythat.co.uk/parking/#free-check',
    bill:         'https://doipaythat.co.uk/bill/#free-check',
    subscription: 'https://doipaythat.co.uk/subscription/#free-check',
    quote:        'https://doipaythat.co.uk/quote/#free-check',
  };

  return pages[String(type).toLowerCase()] || 'https://doipaythat.co.uk';
}
