// worker/services/stripe.js
// Stripe session validation and payment link helpers for DoIPayThat.

const STRIPE_API = "https://api.stripe.com/v1";

const FALLBACK_PAGES = {
  debt: "https://doipaythat.co.uk/debt/#free-check",
  parking: "https://doipaythat.co.uk/parking/#free-check",
  bill: "https://doipaythat.co.uk/bill/#free-check",
  subscription: "https://doipaythat.co.uk/subscription/#free-check",
  quote: "https://doipaythat.co.uk/quote/#free-check",
};

function normalizeSessionId(sessionId) {
  return String(sessionId || "").trim();
}

function isValidCheckoutSessionId(sessionId) {
  return (
    sessionId.startsWith("cs_live_") ||
    sessionId.startsWith("cs_test_")
  );
}

function normalizeType(type) {
  return String(type || "debt").trim().toLowerCase();
}

function normalizeCurrency(value) {
  return String(value || "gbp").trim().toUpperCase();
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

async function stripeGet(env, path) {
  if (!env?.STRIPE_SECRET_KEY) {
    throw new Error("Missing STRIPE_SECRET_KEY");
  }

  const res = await fetch(`${STRIPE_API}${path}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
    },
  });

  let data;

  try {
    data = await res.json();
  } catch {
    const text = await res.text();
    throw new Error(`Stripe returned invalid response: ${text}`);
  }

  if (!res.ok) {
    const message =
      data?.error?.message ||
      data?.message ||
      JSON.stringify(data);

    throw new Error(`Stripe API error: ${message}`);
  }

  return data;
}

export async function verifySession(env, sessionId) {
  const id = normalizeSessionId(sessionId);

  if (!isValidCheckoutSessionId(id)) {
    throw new Error("Invalid session ID");
  }

  const session = await stripeGet(
    env,
    `/checkout/sessions/${encodeURIComponent(id)}`
  );

  if (session.payment_status !== "paid") {
    throw new Error(
      `Payment not completed. Current status: ${session.payment_status || "unknown"}`
    );
  }

  return session;
}

export async function verifyStripeSession(env, sessionId) {
  return verifySession(env, sessionId);
}

export async function verifyPaidSession(env, sessionId) {
  const session = await verifySession(env, sessionId);

  return {
    paid: true,
    session,
    sessionId: session.id,
    email:
      normalizeEmail(session.customer_details?.email) ||
      normalizeEmail(session.customer_email) ||
      null,
    name:
      session.metadata?.name ||
      session.customer_details?.name ||
      null,
    type:
      normalizeType(session.metadata?.type || session.metadata?.product || "debt"),
    amount:
      typeof session.amount_total === "number"
        ? session.amount_total / 100
        : null,
    currency: normalizeCurrency(session.currency),
    payment_status: session.payment_status,
  };
}

export function getStripeLink(env, type) {
  const normalizedType = normalizeType(type);
  const key = `STRIPE_LINK_${normalizedType.toUpperCase()}`;

  if (env?.[key]) {
    return env[key];
  }

  if (env?.STRIPE_PAYMENT_LINK) {
    return env.STRIPE_PAYMENT_LINK;
  }

  if (env?.STRIPE_LINK_DEBT) {
    return env.STRIPE_LINK_DEBT;
  }

  return FALLBACK_PAGES[normalizedType] || "https://doipaythat.co.uk";
}
