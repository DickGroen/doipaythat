// worker/services/resend.js — doipaythat (tiered email)

import { escapeHtml } from "../utils/html.js";
import { makeAnalysisRtf, makeLetterRtf, rtfToBase64 } from "../utils/rtf.js";

const FROM = "DoIPayThat <noreply@doipaythat.co.uk>";

const DISCLAIMER = "This is informational analysis only and does not constitute legal advice. DoIPayThat does not provide legal representation.";

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

const TYPE_LABELS = {
  debt: {
    title: "debt letter",
    letter: "dispute letter",
    price: "49",
    filename: "Dispute-Letter.rtf"
  },
  parking: {
    title: "parking fine",
    letter: "appeal letter",
    price: "19",
    filename: "Appeal-Letter.rtf"
  },
  bill: {
    title: "bill",
    letter: "dispute letter",
    price: "29",
    filename: "Dispute-Letter.rtf"
  },
  subscription: {
    title: "subscription charge",
    letter: "cancellation letter",
    price: "29",
    filename: "Cancellation-Letter.rtf"
  },
  quote: {
    title: "quote or estimate",
    letter: "response letter",
    price: "29",
    filename: "Response-Letter.rtf"
  }
};

async function sendEmail(env, { to, subject, html, attachments = [] }) {
  const body = {
    from: FROM,
    to: Array.isArray(to) ? to : [to],
    subject,
    html
  };

  if (attachments.length) body.attachments = attachments;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Resend error: ${err}`);
  }

  return res.json();
}

function formatAmount(triage) {
  if (triage?.amount_claimed) return `£${triage.amount_claimed}`;
  if (triage?.fine_amount)    return `£${triage.fine_amount}`;
  return "unknown";
}

// ── Confirmation email ───────────────────────────────────────────────────────

export async function sendConfirmationEmail(env, { name, email, type }) {
  const labels = TYPE_LABELS[type] || TYPE_LABELS.debt;

  await sendEmail(env, {
    to: email,
    subject: "We've received your document — DoIPayThat",
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1f2937;line-height:1.7;">
      <p style="font-size:1.1rem;font-weight:700;color:#14532d;">✓ We've received your document.</p>
      <p>Hi ${escapeHtml(name)},</p>
      <p>We'll review your ${escapeHtml(labels.title)} carefully and send your first check by email by the next working day before 4pm.</p>
      <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:14px;margin:16px 0;">
        <strong style="color:#14532d;">Why this matters:</strong>
        <p style="color:#166534;margin-top:6px;margin-bottom:0;line-height:1.65;">
          Our review helps you understand what to check before paying. Many people only realise they could have questioned the claim after they've already paid.
        </p>
      </div>
      <p style="font-size:.9rem;color:#6b7280;">→ Please also check your spam folder if you don't hear from us.</p>
      <p>Best regards,<br><strong>DoIPayThat</strong></p>
      <p style="color:#6b7280;font-size:0.82rem;margin-top:24px;">${escapeHtml(DISCLAIMER)}</p>
    </div>`
  });
}

// ── Admin emails ─────────────────────────────────────────────────────────────

export async function notifyAdminFree(env, { name, email, type, triage, stripeLink }) {
  const amount = formatAmount(triage);

  await sendEmail(env, {
    to: env.ADMIN_EMAIL,
    subject: `[DoIPayThat] Free check: ${name} (${type})`,
    html: `<div style="font-family:Arial,sans-serif;">
      <p style="background:#f3f4f6;padding:10px;border-radius:6px;font-size:0.85rem;">
        📬 Free lead — recovery sequence queued for <strong>${escapeHtml(email)}</strong>
      </p>
      <h3>Free check — ${escapeHtml(type)}</h3>
      <p><strong>Name:</strong> ${escapeHtml(name)}</p>
      <p><strong>Email:</strong> ${escapeHtml(email)}</p>
      <p><strong>Sender:</strong> ${escapeHtml(triage?.sender || "unknown")}</p>
      <p><strong>Amount:</strong> ${escapeHtml(amount)}</p>
      <p><strong>Risk:</strong> ${escapeHtml(triage?.risk || "")}</p>
      <p><strong>Chance:</strong> ${escapeHtml(String(triage?.chance ?? "unknown"))}</p>
      <p><strong>Flags:</strong> ${escapeHtml(String(triage?.flagCount ?? "unknown"))}</p>
      <p><strong>Tier:</strong> ${escapeHtml(triage?.tier || "unknown")}</p>
      <p><strong>Email type:</strong> ${escapeHtml(triage?.emailType || "unknown")}</p>
      <p><strong>Stripe link:</strong> ${stripeLink ? "YES" : "NO"}</p>
    </div>`
  });
}

export async function notifyAdminPaid(env, { name, email, type, triage, analysis }) {
  const analysisRtf = makeAnalysisRtf(analysis, name, email, triage, type);

  await sendEmail(env, {
    to: env.ADMIN_EMAIL,
    subject: `[DoIPayThat] PAID: ${name} (${type})`,
    html: `<div style="font-family:Arial,sans-serif;">
      <p style="background:#f3f4f6;padding:10px;border-radius:6px;font-size:0.85rem;">
        💰 Paid customer — recovery sequence stopped
      </p>
      <h3>Paid analysis — ${escapeHtml(type)}</h3>
      <p><strong>Name:</strong> ${escapeHtml(name)}</p>
      <p><strong>Email:</strong> ${escapeHtml(email)}</p>
      <p><strong>Sender:</strong> ${escapeHtml(triage?.sender || "unknown")}</p>
      <p><strong>Amount:</strong> ${escapeHtml(formatAmount(triage))}</p>
      <p><strong>Risk:</strong> ${escapeHtml(triage?.risk || "")}</p>
    </div>`,
    attachments: [
      { filename: "Analysis.rtf", content: rtfToBase64(analysisRtf) }
    ]
  });
}

// ── Free email: tiered recovery sequence ────────────────────────────────────

export async function sendFreeEmail(env, { name, email, type, triage, stripeLink, stage = 1 }) {
  const labels      = TYPE_LABELS[type] || TYPE_LABELS.debt;
  const amount      = formatAmount(triage);
  const stageNumber = Number(stage) || 1;
  const emailType   = triage?.emailType || "strong";

  if (stageNumber === 1) {
    const subject = emailType === "trust"
      ? `Your document has been reviewed`
      : emailType === "soft"
        ? `You may want to check this before paying`
        : `Before you pay — check this first`;

    const senderPart = triage?.sender ? ` from ${escapeHtml(triage.sender)}` : "";
    const amountPart = amount !== "unknown" ? ` for ${escapeHtml(amount)}` : "";

    let bodyHtml;

    if (emailType === "strong") {
      bodyHtml = `
        <p>Hi ${escapeHtml(name)},</p>
        <p>We've checked your ${escapeHtml(labels.title)}${senderPart}${amountPart} — and there are signs you could be paying more than you should.</p>
        <p>Before you pay anything, it's worth taking a closer look.</p>
        <p><strong>What we noticed:</strong><br>
        ${escapeHtml(triage?.teaser || "There may be aspects of this claim worth checking before you pay.")}</p>
        <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;">
        <p>If you want to know exactly what to do next, you can get a full analysis and a ready-to-send ${escapeHtml(labels.letter)}:</p>
        <ul style="padding-left:20px;margin:8px 0 16px 0;list-style:none;">
          <li>✓ Clear explanation of your situation</li>
          <li>✓ What to check (and why)</li>
          <li>✓ A ready-to-send ${escapeHtml(labels.letter)} you can use immediately</li>
        </ul>
        ${stripeLink ? `<p style="margin:20px 0;"><a href="${escapeHtml(stripeLink)}" style="display:inline-block;background:#1d3a6e;color:#fff;padding:14px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">See exactly what to do — £${escapeHtml(labels.price)} →</a></p><p style="font-size:0.9rem;color:#374151;">Most people prefer to understand what they're being asked to pay — before they pay it.</p>` : ""}`;
    } else if (emailType === "soft") {
      bodyHtml = `
        <p>Hi ${escapeHtml(name)},</p>
        <p>We've taken a first look at your ${escapeHtml(labels.title)}${senderPart}${amountPart}.</p>
        <p>There may be aspects worth checking before you proceed with payment.</p>
        <p>${escapeHtml(triage?.teaser || "There may be aspects of this claim worth checking before you pay.")}</p>
        <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;">
        <p>If you'd like a clearer picture, you can get a full analysis and a ready-to-send ${escapeHtml(labels.letter)}:</p>
        <p style="margin:20px 0;">
          <a href="${escapeHtml(stripeLink)}"
             style="display:inline-block;background:#1d3a6e;color:#fff;padding:14px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">
            Check before you pay — £${escapeHtml(labels.price)} →
          </a>
        </p>`;
    } else {
      // trust — no hard sell, no Stripe link
      bodyHtml = `
        <p>Hi ${escapeHtml(name)},</p>
        <p>We've reviewed your ${escapeHtml(labels.title)}${senderPart}.</p>
        <p>At first glance, everything appears relatively clear — but it can still be useful to review the details carefully before taking action.</p>
        <p>${escapeHtml(triage?.teaser || "Some details may be worth a closer look.")}</p>
        <p>If you'd like a full breakdown, you can still request a full analysis.</p>
        ${stripeLink ? `<p style="margin:20px 0;"><a href="${escapeHtml(stripeLink)}" style="display:inline-block;background:#1d3a6e;color:#fff;padding:14px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">Get full analysis — £${escapeHtml(labels.price)} →</a></p>` : ""}`;
    }

    await sendEmail(env, {
      to: email,
      subject,
      html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1f2937;line-height:1.7;">
        ${bodyHtml}
        <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;">
        <p>If you have any questions, just reply to this email.</p>
        <p>Best regards,<br><strong>DoIPayThat</strong></p>
        <p style="font-size:0.8rem;color:#6b7280;margin-top:24px;">${escapeHtml(DISCLAIMER)}</p>
      </div>`
    });

    await trackEvent(env, "email_sent", { type, stage: 1, kind: "free", emailType });
    return;
  }

  if (stageNumber === 2) {
    if (!stripeLink) return; // No follow-up for tier3

    await sendEmail(env, {
      to: email,
      subject: `Before you pay — a quick reminder`,
      html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1f2937;line-height:1.7;">
        <p>Hi ${escapeHtml(name)},</p>
        <p>Just a quick reminder about your ${escapeHtml(labels.title)}.</p>
        <p>Many people end up paying more than they should simply because they don't check first.</p>
        <p>You've already taken the first step — now you can see exactly what to do next.</p>
        <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;">
        <p style="margin:20px 0;">
          <a href="${escapeHtml(stripeLink)}"
             style="display:inline-block;background:#1d3a6e;color:#fff;padding:14px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">
            Check this before you pay — £${escapeHtml(labels.price)} →
          </a>
        </p>
        <p style="font-size:0.9rem;color:#374151;">A short check now can save you money — and stress — later.</p>
        <p>Best regards,<br><strong>DoIPayThat</strong></p>
        <p style="font-size:0.8rem;color:#6b7280;margin-top:24px;">${escapeHtml(DISCLAIMER)}</p>
      </div>`
    });

    await trackEvent(env, "email_sent", { type, stage: 2, kind: "free", emailType });
    return;
  }

  // Stage 3
  if (!stripeLink) return; // No follow-up for tier3

  await sendEmail(env, {
    to: email,
    subject: `Final check before you pay this`,
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1f2937;line-height:1.7;">
      <p>Hi ${escapeHtml(name)},</p>
      <p>This is your final reminder about your ${escapeHtml(labels.title)}.</p>
      <p>If you don't check the claim before paying, you could miss the chance to question it.</p>
      <p>In many cases, once payment is made, it's much harder to challenge.</p>
      <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;">
      <p style="margin:20px 0;">
        <a href="${escapeHtml(stripeLink)}"
           style="display:inline-block;background:#1d3a6e;color:#fff;padding:14px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">
          See your options before you pay — £${escapeHtml(labels.price)} →
        </a>
      </p>
      <p style="font-size:0.9rem;color:#374151;">This takes just a few minutes — and gives you clarity before you decide.</p>
      <p>Best regards,<br><strong>DoIPayThat</strong></p>
      <p style="font-size:0.8rem;color:#6b7280;margin-top:24px;">${escapeHtml(DISCLAIMER)}</p>
    </div>`
  });

  await trackEvent(env, "email_sent", { type, stage: 3, kind: "free", emailType });
}

// ── Paid email ────────────────────────────────────────────────────────────────

export async function sendPaidEmail(env, { name, email, type, triage, analysis }) {
  const labels      = TYPE_LABELS[type] || TYPE_LABELS.debt;
  const analysisRtf = makeAnalysisRtf(analysis, name, email, triage, type);
  const letterRtf   = makeLetterRtf(analysis, name, triage, type);

  await sendEmail(env, {
    to: email,
    subject: `Your analysis is ready — here's what to do next`,
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1f2937;line-height:1.7;">
      <p>Hi ${escapeHtml(name)},</p>
      <p>Your analysis is ready.</p>
      <p>You now have everything you need to understand the situation — and respond with confidence.</p>
      <p>Please find attached:</p>
      <ul style="padding-left:20px;margin:8px 0 16px 0;list-style:none;">
        <li>✓ <strong>Analysis.rtf</strong> — full breakdown with findings and next steps</li>
        <li>✓ <strong>${escapeHtml(labels.filename)}</strong> — ready-to-send ${escapeHtml(labels.letter)}</li>
      </ul>
      <p style="background:#f0fdf4;border-left:4px solid #22c55e;padding:12px;border-radius:4px;font-size:0.9rem;">
        💡 Tip: Send the letter by recorded post and keep proof of postage. Send the letter on its own — do not include the analysis document.
      </p>
      <p>If anything is unclear, you can simply reply to this email.</p>
      <p>Best regards,<br><strong>DoIPayThat</strong></p>
      <p style="font-size:0.8rem;color:#6b7280;margin-top:24px;">${escapeHtml(DISCLAIMER)}</p>
    </div>`,
    attachments: [
      { filename: "Analysis.rtf",  content: rtfToBase64(analysisRtf) },
      { filename: labels.filename, content: rtfToBase64(letterRtf)   }
    ]
  });

  await trackEvent(env, "email_sent", { type, kind: "paid" });
}

// ── Abandoned checkout emails ─────────────────────────────────────────────────

export async function sendAbandonedEmail(env, { name, email, type, amount, stripeLink, stage = 1 }) {
  const labels      = TYPE_LABELS[type] || TYPE_LABELS.debt;
  const stageNumber = Number(stage) || 1;
  const amountPart  = amount ? ` £${amount}` : "";

  let subject, bodyHtml;

  if (stageNumber === 1) {
    subject = `Quick check before you pay`;
    bodyHtml = `
      <p>Hi ${escapeHtml(name)},</p>
      <p>You started checking your ${escapeHtml(labels.title)} but didn't complete it.</p>
      <p>Before you pay, it's often worth taking a closer look — especially when the amount${escapeHtml(amountPart)} is involved.</p>
      <p>You can continue here:</p>
      <p style="margin:20px 0;">
        <a href="${escapeHtml(stripeLink)}"
           style="display:inline-block;background:#1d3a6e;color:#fff;padding:14px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">
          Continue — £${escapeHtml(labels.price)} →
        </a>
      </p>
      <p style="font-size:0.9rem;color:#374151;">Most people prefer to check first rather than risk paying too much.</p>`;

  } else if (stageNumber === 2) {
    subject = `Before you pay — one more look`;
    bodyHtml = `
      <p>Hi ${escapeHtml(name)},</p>
      <p>Just a quick reminder.</p>
      <p>Many people only realise they could have challenged a claim after they've already paid.</p>
      <p>If you're unsure, it's safer to check first.</p>
      <p style="margin:20px 0;">
        <a href="${escapeHtml(stripeLink)}"
           style="display:inline-block;background:#1d3a6e;color:#fff;padding:14px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">
          Check before you pay — £${escapeHtml(labels.price)} →
        </a>
      </p>`;

  } else {
    subject = amount && Number(amount) > 500
      ? `Before you pay £${amount} — check this first`
      : `Final check before you pay`;
    bodyHtml = `
      <p>Hi ${escapeHtml(name)},</p>
      <p>If you don't check this now, you may end up paying unnecessarily.</p>
      <p>This is your last chance to review everything clearly before making a decision.</p>
      <p style="margin:20px 0;">
        <a href="${escapeHtml(stripeLink)}"
           style="display:inline-block;background:#1d3a6e;color:#fff;padding:14px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">
          See your options — £${escapeHtml(labels.price)} →
        </a>
      </p>`;
  }

  await sendEmail(env, {
    to: email,
    subject,
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1f2937;line-height:1.7;">
      ${bodyHtml}
      <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;">
      <p>Best regards,<br><strong>DoIPayThat</strong></p>
      <p style="font-size:0.8rem;color:#6b7280;margin-top:24px;">${escapeHtml(DISCLAIMER)}</p>
    </div>`
  });

  await trackEvent(env, "email_sent", { type, stage: stageNumber, kind: "abandoned" });
}
