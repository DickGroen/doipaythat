// worker/services/queue.js

const PAID_MARKER_TTL_SECONDS     = 60 * 60 * 24 * 30; // 30 days
const FREE_CASE_TTL_SECONDS       = 60 * 60 * 24 * 3;  // 3 days
const PAID_SEND_DELAY_MS          = 0;                  // send immediately after payment
const ABANDONED_TTL_SECONDS       = 60 * 60 * 24 * 7;  // 7 days

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function safeEmailKey(email) {
  return normalizeEmail(email).replace(/[^a-z0-9]/gi, "_");
}

function paidMarkerKey(email) {
  return `paid_marker:${normalizeEmail(email)}`;
}

function freeCaseKey(type, email) {
  return `free_case:${type}:${safeEmailKey(email)}`;
}

function abandonedKey(email, stage) {
  return `abandoned:${safeEmailKey(email)}:stage_${stage}`;
}

// Next business day at 15:00 CET (14:00 UTC)
function nextWorkdayAt15CET(fromMs) {
  const d = new Date(fromMs);
  d.setUTCDate(d.getUTCDate() + 1);
  d.setUTCHours(14, 0, 0, 0);

  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) {
    d.setUTCDate(d.getUTCDate() + 1);
  }

  return d.toISOString();
}

// ── Paid marker ──────────────────────────────────────────────────────────────

export async function markPaid(env, email) {
  const normalized = normalizeEmail(email);
  if (!normalized) return;

  await env.DEBT_QUEUE.put(
    paidMarkerKey(normalized),
    "1",
    { expirationTtl: PAID_MARKER_TTL_SECONDS }
  );
}

export async function hasPaid(env, email) {
  const normalized = normalizeEmail(email);
  if (!normalized) return false;

  const value = await env.DEBT_QUEUE.get(paidMarkerKey(normalized));
  return value === "1";
}

// ── Free case: stores file + triage for automatic analysis after payment ─────

export async function saveFreeCase(env, {
  type, name, email, triage, stripeLink,
  fileBase64, mediaType, fileName, fileSize,
}) {
  const entry = {
    type,
    name,
    email:       normalizeEmail(email),
    triage,
    stripe_link: stripeLink,
    file_base64: fileBase64,
    media_type:  mediaType,
    file_name:   fileName || null,
    file_size:   fileSize || null,
    created_at:  new Date().toISOString(),
  };

  await env.DEBT_QUEUE.put(
    freeCaseKey(type, email),
    JSON.stringify(entry),
    { expirationTtl: FREE_CASE_TTL_SECONDS }
  );

  return entry;
}

export async function getFreeCase(env, { type, email }) {
  const raw = await env.DEBT_QUEUE.get(freeCaseKey(type, email));
  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

// ── Free recovery queue ──────────────────────────────────────────────────────

export async function enqueueFree(env, { type, rawType, name, email, triage, stripeLink }) {
  const createdAt    = Date.now();
  const emailKey     = safeEmailKey(email);
  const baseKey      = `free:${type}:${createdAt}:${emailKey}`;

  const stage1SendAt = new Date(Date.now() + 2 * 60 * 1000).toISOString();
  const stage1Ms     = new Date(stage1SendAt).getTime();

  const sendAts = {
    1: stage1SendAt,
    2: new Date(stage1Ms + 24 * 60 * 60 * 1000).toISOString(),
    3: new Date(stage1Ms + 48 * 60 * 60 * 1000).toISOString(),
  };

  for (const stage of [1, 2, 3]) {
    const key = `${baseKey}:stage_${stage}`;

    const entry = {
      kind:        "free",
      stage,
      type,
      rawType:     rawType || type,
      name,
      email:       normalizeEmail(email),
      triage,
      stripe_link: stripeLink,
      created_at:  new Date(createdAt).toISOString(),
      send_at:     sendAts[stage],
    };

    await env.DEBT_QUEUE.put(key, JSON.stringify(entry), {
      expirationTtl: 60 * 60 * 24 * 7,
    });
  }

  return baseKey;
}

// ── Paid delivery queue ──────────────────────────────────────────────────────

export async function enqueuePaid(env, { type, name, email, triage, analysis }) {
  const key = `paid:${type}:${Date.now()}:${safeEmailKey(email)}`;

  const entry = {
    kind:       "paid",
    type,
    name,
    email:      normalizeEmail(email),
    triage,
    analysis,
    created_at: new Date().toISOString(),
    send_at:    new Date(Date.now() + PAID_SEND_DELAY_MS).toISOString(),
  };

  await env.DEBT_QUEUE.put(key, JSON.stringify(entry));
  return key;
}

// ── Abandoned checkout queue ─────────────────────────────────────────────────

export async function saveAbandoned(env, { email, name, type, amount, stripeLink }) {
  const normalized = normalizeEmail(email);
  if (!normalized) return;

  const now = Date.now();

  const sendAts = {
    1: new Date(now + 1  * 60 * 60 * 1000).toISOString(),  // +1 hour
    2: new Date(now + 24 * 60 * 60 * 1000).toISOString(),  // +24 hours
    3: new Date(now + 48 * 60 * 60 * 1000).toISOString(),  // +48 hours
  };

  for (const stage of [1, 2, 3]) {
    const key = abandonedKey(normalized, stage);

    // Don't overwrite if already exists (prevents duplicate entries on multiple clicks)
    const existing = await env.DEBT_QUEUE.get(key);
    if (existing) continue;

    const entry = {
      kind:        "abandoned",
      stage,
      type,
      name,
      email:       normalized,
      amount:      amount || null,
      stripe_link: stripeLink,
      created_at:  new Date(now).toISOString(),
      send_at:     sendAts[stage],
    };

    await env.DEBT_QUEUE.put(key, JSON.stringify(entry), {
      expirationTtl: ABANDONED_TTL_SECONDS,
    });
  }
}

// ── Cron helpers ─────────────────────────────────────────────────────────────

export async function getDueEntries(env) {
  const now = Date.now();
  const due = [];
  let cursor;

  do {
    const list = await env.DEBT_QUEUE.list(cursor ? { cursor } : undefined);
    cursor = list.cursor;

    for (const key of list.keys) {
      if (key.name.startsWith("paid_marker:")) continue;
      if (key.name.startsWith("free_case:"))   continue;

      try {
        const raw = await env.DEBT_QUEUE.get(key.name);
        if (!raw) continue;

        const entry = JSON.parse(raw);
        if (!entry.send_at) continue;

        if (new Date(entry.send_at).getTime() <= now) {
          due.push({ key: key.name, entry });
        }
      } catch (err) {
        console.error(`Queue read error for ${key.name}:`, err.message);
      }
    }
  } while (cursor);

  return due;
}

export async function deleteEntry(env, key) {
  await env.DEBT_QUEUE.delete(key);
}
