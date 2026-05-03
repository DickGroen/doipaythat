import { escapeHtml } from "../utils/html.js";
import { makeAnalysisRtf, makeLetterRtf, rtfToBase64 } from "../utils/rtf.js";

const FROM = "DoIPayThat <noreply@doipaythat.co.uk>";

const DISCLAIMER = "This is informational analysis only and does not constitute legal advice. DoIPayThat does not provide legal representation.";

const TYPE_LABELS = {
  debt: {
    title: "debt letter",
    letter: "dispute letter",
    stripe_label: "Full analysis + dispute letter",
    price: "49",
    filename: "Dispute-Letter.rtf"
  },
  parking: {
    title: "parking fine",
    letter: "appeal letter",
    stripe_label: "Full analysis + appeal letter",
    price: "19",
    filename: "Appeal-Letter.rtf"
  },
  bill: {
    title: "bill",
    letter: "dispute letter",
    stripe_label: "Full analysis + dispute letter",
    price: "29",
    filename: "Dispute-Letter.rtf"
  },
  subscription: {
    title: "subscription charge",
    letter: "cancellation letter",
    stripe_label: "Full analysis + cancellation letter",
    price: "29",
    filename: "Cancellation-Letter.rtf"
  },
  quote: {
    title: "quote or estimate",
    letter: "response letter",
    stripe_label: "Full analysis + response letter",
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

  if (attachments.length) {
    body.attachments = attachments;
  }

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

function riskSentence(risk) {
  return {
    high:   "Based on this initial check, there are signs this claim may not be fully straightforward. You could be asked to pay more than you should.",
    medium: "Based on this initial check, there may be aspects of this claim worth verifying before you pay.",
    low:    "The claim appears relatively straightforward, but it may still be worth confirming a few details before paying."
  }[risk] || "There may be aspects of this claim worth checking before you pay.";
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

// ── Free email: recovery sequence ────────────────────────────────────────────

export async function sendFreeEmail(env, { name, email, type, triage, stripeLink, stage = 1 }) {
  const labels      = TYPE_LABELS[type] || TYPE_LABELS.debt;
  const amount      = formatAmount(triage);
  const stageNumber = Number(stage) || 1;

  if (stageNumber === 1) {
    const senderPart = triage?.sender ? ` from ${escapeHtml(triage.sender)}` : "";
    const amountPart = amount !== "unknown" ? ` for ${escapeHtml(amount)}` : "";

    await sendEmail(env, {
      to: email,
      subject: `Your free check — are you being asked to pay more than you should?`,
      html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1f2937;line-height:1.7;">

        <p>Hi ${escapeHtml(name)},</p>

        <p>We've checked your ${escapeHtml(labels.title)}${senderPart}${amountPart} — and there are signs you could be paying more than you should.</p>

        <p><strong>Before you pay — here's what we found:</strong><br>
        ${escapeHtml(riskSentence(triage?.risk))}</p>

        <p><strong>What we noticed:</strong><br>
        ${escapeHtml(triage?.teaser || "There may be aspects of this claim worth checking before you pay.")}</p>

        <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;">

        <p>If you want to know exactly what to do, get the full analysis and a ready-to-send response letter:</p>

        <ul style="padding-left:20px;margin:8px 0 16px 0;list-style:none;">
          <li>✓ Clear assessment of your situation</li>
          <li>✓ Specific points to check</li>
          <li>✓ Ready-to-send ${escapeHtml(labels.letter)}</li>
        </ul>

        <p style="margin:20px 0;">
          <a href="${escapeHtml(stripeLink)}"
             style="display:inline-block;background:#1d3a6e;color:#fff;padding:13px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">
            Get your answer before you pay — £${escapeHtml(labels.price)} →
          </a>
        </p>

        <p style="font-size:0.85rem;color:#6b7280;">One-off £${escapeHtml(labels.price)} · no subscription · secure payment via Stripe</p>

        <p style="font-size:0.85rem;color:#6b7280;background:#f9fafb;padding:10px;border-radius:4px;">
          Most people prefer to understand what they're being asked to pay — before they pay it.
        </p>

        <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;">

        <p>If you have any questions, just reply to this email.</p>

        <p>Best regards<br><strong>DoIPayThat</strong></p>

        <p style="color:#6b7280;font-size:0.82rem;margin-top:24px;">${escapeHtml(DISCLAIMER)}</p>
      </div>`
    });

    return;
  }

  // ── Stage 2 & 3 ───────────────────────────────────────────────────────────

  const subjects = {
    2: `Before you pay — a quick reminder`,
    3: `Final check before you pay this`,
  };

  const intros = {
    2: `<p>You still have time to check whether you're being asked to pay more than you should. Many people pay without checking — and later wish they hadn't.</p>`,
    3: `<p>This is your final reminder. If you pay without checking first, you may not get the chance to challenge it afterwards.</p>`,
  };

  await sendEmail(env, {
    to: email,
    subject: subjects[stageNumber] || subjects[2],
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1f2937;line-height:1.7;">
      <p>Hi ${escapeHtml(name)},</p>
      ${intros[stageNumber] || intros[2]}

      <table style="width:100%;border-collapse:collapse;margin:20px 0;border:1px solid #e5e7eb;">
        <tr style="background:#f3f4f6;">
          <td style="padding:10px;font-weight:bold;">Document</td>
          <td style="padding:10px;">${escapeHtml(labels.title)}</td>
        </tr>
        <tr>
          <td style="padding:10px;font-weight:bold;">Sender</td>
          <td style="padding:10px;">${escapeHtml(triage?.sender || "unknown")}</td>
        </tr>
        <tr style="background:#f3f4f6;">
          <td style="padding:10px;font-weight:bold;">Amount</td>
          <td style="padding:10px;font-weight:bold;color:#1d3a6e;">${escapeHtml(amount)}</td>
        </tr>
      </table>

      <p style="margin:20px 0;">
        <a href="${escapeHtml(stripeLink)}"
           style="display:inline-block;background:#1d3a6e;color:#fff;padding:13px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">
          Get your answer before you pay — £${escapeHtml(labels.price)} →
        </a>
      </p>

      <p style="font-size:0.85rem;color:#6b7280;">One-off £${escapeHtml(labels.price)} · no subscription</p>
      <p style="color:#6b7280;font-size:0.82rem;margin-top:24px;">${escapeHtml(DISCLAIMER)}</p>
    </div>`
  });
}

// ── Paid email ────────────────────────────────────────────────────────────────

export async function sendPaidEmail(env, { name, email, type, triage, analysis }) {
  const labels      = TYPE_LABELS[type] || TYPE_LABELS.debt;
  const analysisRtf = makeAnalysisRtf(analysis, name, email, triage, type);
  const letterRtf   = makeLetterRtf(analysis, name, triage, type);

  await sendEmail(env, {
    to: email,
    subject: `Your analysis is ready — ${labels.title}`,
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1f2937;">
      <h2 style="color:#1d3a6e;">Your analysis is ready</h2>
      <p>Hi ${escapeHtml(name)},</p>
      <p>Please find attached two files:</p>
      <ul style="line-height:1.9;">
        <li><strong>Analysis.rtf</strong> — full breakdown with findings and next steps</li>
        <li><strong>${escapeHtml(labels.filename)}</strong> — ready-to-send ${escapeHtml(labels.letter)}</li>
      </ul>
      <p style="background:#f0fdf4;border-left:4px solid #22c55e;padding:12px;border-radius:4px;font-size:0.9rem;">
        You now have everything you need to respond with confidence.
      </p>
      <p style="font-size:0.9rem;color:#374151;">💡 Tip: Send the letter by recorded post and keep proof of postage.</p>
      <p style="color:#6b7280;font-size:0.82rem;margin-top:24px;">${escapeHtml(DISCLAIMER)}</p>
    </div>`,
    attachments: [
      { filename: "Analysis.rtf",          content: rtfToBase64(analysisRtf) },
      { filename: labels.filename,          content: rtfToBase64(letterRtf)  }
    ]
  });
}
