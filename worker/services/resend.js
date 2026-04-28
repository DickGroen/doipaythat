import { escapeHtml } from "../utils/files.js";
import { makeAnalysisRtf, makeLetterRtf, rtfToBase64 } from "../utils/rtf.js";

const FROM = "DoIPayThis <noreply@doipaythis.co.uk>";

async function sendEmail(env, { to, subject, html, attachments = [] }) {
  const body = { from: FROM, to: Array.isArray(to) ? to : [to], subject, html };
  if (attachments.length) body.attachments = attachments;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Resend error: ${err}`);
  }
  return res.json();
}

// ── Admin notifications ───────────────────────────────────────────────────────

export async function notifyAdminFree(env, { name, email, type, triage }) {
  await sendEmail(env, {
    to: env.ADMIN_EMAIL,
    subject: `[DoIPayThis] Free check: ${name} (${type})`,
    html: `<div style="font-family:Arial,sans-serif;">
      <p style="background:#f3f4f6;padding:10px;border-radius:6px;font-size:0.85rem;">
        📬 Customer email queued for next day
      </p>
      <h3>Free check — ${escapeHtml(type)}</h3>
      <p><strong>Name:</strong> ${escapeHtml(name)}</p>
      <p><strong>Email:</strong> ${escapeHtml(email)}</p>
      <p><strong>Sender:</strong> ${escapeHtml(triage?.sender || "unknown")}</p>
      <p><strong>Amount:</strong> ${triage?.amount_claimed ? `£${triage.amount_claimed}` : (triage?.fine_amount ? `£${triage.fine_amount}` : "unknown")}</p>
      <p><strong>Risk:</strong> ${escapeHtml(triage?.risk || "")}</p>
    </div>`
  });
}

export async function notifyAdminPaid(env, { name, email, type, triage, analysis }) {
  const analysisRtf = makeAnalysisRtf(analysis, name, email, triage, type);

  await sendEmail(env, {
    to: env.ADMIN_EMAIL,
    subject: `[DoIPayThis] PAID: ${name} (${type})`,
    html: `<div style="font-family:Arial,sans-serif;">
      <p style="background:#f3f4f6;padding:10px;border-radius:6px;font-size:0.85rem;">
        📬 Customer email queued with attachments
      </p>
      <h3>Paid analysis — ${escapeHtml(type)}</h3>
      <p><strong>Name:</strong> ${escapeHtml(name)}</p>
      <p><strong>Email:</strong> ${escapeHtml(email)}</p>
      <p><strong>Sender:</strong> ${escapeHtml(triage?.sender || "unknown")}</p>
      <p><strong>Amount:</strong> ${triage?.amount_claimed ? `£${triage.amount_claimed}` : (triage?.fine_amount ? `£${triage.fine_amount}` : "unknown")}</p>
      <p><strong>Risk:</strong> ${escapeHtml(triage?.risk || "")}</p>
    </div>`,
    attachments: [{ filename: "Analysis.rtf", content: rtfToBase64(analysisRtf) }]
  });
}

// ── Customer emails ───────────────────────────────────────────────────────────

const TYPE_LABELS = {
  debt: { title: "debt letter", letter: "dispute letter", stripe_label: "Full analysis + dispute letter" },
  parking: { title: "parking fine", letter: "appeal letter", stripe_label: "Full analysis + appeal letter" },
  bill: { title: "bill", letter: "dispute letter", stripe_label: "Full analysis + dispute letter" },
  subscription: { title: "subscription", letter: "cancellation letter", stripe_label: "Full analysis + cancellation letter" }
};

export async function sendFreeEmail(env, { name, email, type, triage, stripeLink }) {
  const labels = TYPE_LABELS[type] || TYPE_LABELS.debt;
  const amount = triage?.amount_claimed ? `£${triage.amount_claimed}` : (triage?.fine_amount ? `£${triage.fine_amount}` : "unknown");
  const riskLabel = { low: "Low", medium: "Medium", high: "High" }[triage?.risk] || triage?.risk || "unknown";

  await sendEmail(env, {
    to: email,
    subject: `Your free DoIPayThis assessment — ${labels.title}`,
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1f2937;">
      <h2 style="color:#1d3a6e;">Your free initial assessment</h2>
      <p>Hi ${escapeHtml(name)},</p>
      <p>We've checked your ${escapeHtml(labels.title)} for potential issues.</p>
      <table style="width:100%;border-collapse:collapse;margin:20px 0;">
        <tr style="background:#f3f4f6;"><td style="padding:10px;font-weight:bold;">Sender</td><td style="padding:10px;">${escapeHtml(triage?.sender || "unknown")}</td></tr>
        <tr><td style="padding:10px;font-weight:bold;">Amount</td><td style="padding:10px;font-weight:bold;color:#1d3a6e;">${amount}</td></tr>
        <tr style="background:#f3f4f6;"><td style="padding:10px;font-weight:bold;">Challenge potential</td><td style="padding:10px;">${riskLabel}</td></tr>
      </table>
      <p style="background:#fef9c3;border-left:4px solid #eab308;padding:12px;border-radius:4px;">${escapeHtml(triage?.teaser || "Based on your document, there may be grounds to challenge this.")}</p>
      <p>For a full analysis and ready-to-send ${escapeHtml(labels.letter)}:</p>
      <a href="${stripeLink}" style="display:inline-block;background:#1d3a6e;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">
        ${escapeHtml(labels.stripe_label)} — £29 →
      </a>
      <p style="color:#6b7280;font-size:0.82rem;margin-top:24px;">This is an informational assessment, not legal advice. We do not represent you. For complex cases, contact Citizens Advice or a solicitor.</p>
    </div>`
  });
}

export async function sendPaidEmail(env, { name, email, type, triage, analysis }) {
  const labels = TYPE_LABELS[type] || TYPE_LABELS.debt;
  const analysisRtf = makeAnalysisRtf(analysis, name, email, triage, type);
  const letterRtf = makeLetterRtf(analysis, name, triage, type);
  const letterFilename = { debt: "Dispute-Letter.rtf", parking: "Appeal-Letter.rtf", bill: "Dispute-Letter.rtf", subscription: "Cancellation-Letter.rtf" }[type] || "Letter.rtf";

  await sendEmail(env, {
    to: email,
    subject: `Your DoIPayThis analysis is ready — ${labels.title}`,
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1f2937;">
      <h2 style="color:#1d3a6e;">Your analysis is ready</h2>
      <p>Hi ${escapeHtml(name)},</p>
      <p>Two files are attached:</p>
      <ul style="line-height:1.9;">
        <li><strong>DoIPayThis-Analysis.rtf</strong> — full analysis with findings and next steps</li>
        <li><strong>${escapeHtml(letterFilename)}</strong> — ready-to-send ${escapeHtml(labels.letter)}</li>
      </ul>
      <p style="background:#f0fdf4;border-left:4px solid #22c55e;padding:12px;border-radius:4px;font-size:0.9rem;">
        💡 Send the letter by recorded post or email with read receipt. Keep proof of sending.
      </p>
      <p style="color:#6b7280;font-size:0.82rem;margin-top:24px;">This is an informational analysis and not legal advice. We do not represent you.</p>
    </div>`,
    attachments: [
      { filename: "DoIPayThis-Analysis.rtf", content: rtfToBase64(analysisRtf) },
      { filename: letterFilename, content: rtfToBase64(letterRtf) }
    ]
  });
}
