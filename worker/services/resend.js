// worker/services/resend.js — doipaythat

import { escapeHtml } from "../utils/html.js";
import { makeAnalysisRtf, makeLetterRtf, rtfToBase64 } from "../utils/rtf.js";
import { makeAnalysisDocx, makeLetterDocx, docxToBase64 } from "../utils/docx.js";

const FROM       = "DoIPayThat Support <support@doipaythat.co.uk>";
const REPLY_TO   = "support@doipaythat.co.uk";
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
    title:        "debt letter",
    letter:       "dispute letter",
    price:        "49",
    filename:     "Response-Letter.docx",
    stripe_label: "Full analysis + dispute letter — £49"
  },
  parking: {
    title:        "parking charge notice",
    letter:       "appeal letter",
    price:        "19",
    filename:     "Response-Letter.docx",
    stripe_label: "Full analysis + appeal letter — £19"
  },
  bill: {
    title:        "bill",
    letter:       "dispute letter",
    price:        "29",
    filename:     "Response-Letter.docx",
    stripe_label: "Full analysis + dispute letter — £29"
  },
  subscription: {
    title:        "subscription charge",
    letter:       "cancellation letter",
    price:        "29",
    filename:     "Response-Letter.docx",
    stripe_label: "Full analysis + cancellation letter — £29"
  },
  quote: {
    title:        "quote or estimate",
    letter:       "response letter",
    price:        "29",
    filename:     "Response-Letter.docx",
    stripe_label: "Analysis + response letter — £29"
  }
};

// ── Core send ─────────────────────────────────────────────────────────────────

async function sendEmail(env, { to, subject, html, attachments = [] }) {
  const body = {
    from: FROM,
    reply_to: REPLY_TO,
    to:   Array.isArray(to) ? to : [to],
    subject,
    html
  };

  if (attachments.length) body.attachments = attachments;

  const res = await fetch("https://api.resend.com/emails", {
    method:  "POST",
    headers: {
      Authorization:  `Bearer ${env.RESEND_API_KEY}`,
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

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatAmount(triage, type) {
  const symbol = "£";
  if (type === "parking") {
    if (triage?.amount_claimed) return `${symbol}${triage.amount_claimed}`;
    if (triage?.fine_amount)    return `${symbol}${triage.fine_amount}`;
    return null;
  }
  if (triage?.amount_claimed) return `${symbol}${triage.amount_claimed}`;
  if (triage?.fine_amount)    return `${symbol}${triage.fine_amount}`;
  return null;
}

function parkingGrounds(triage) {
  const grounds = [];
  if (triage?.possible_ntk_timing_defect)           grounds.push("Notice to Keeper timing may not comply with POFA 2012");
  if (triage?.possible_pofa_keeper_liability_failure) grounds.push("Keeper liability under POFA 2012 may not have been correctly established");
  if (triage?.possible_signage_defect)               grounds.push("Signage at the location may not meet the required standard");
  if (triage?.possible_grace_period_failure)         grounds.push("The mandatory grace period may not have been applied");
  if (triage?.possible_anpr_timing_issue)            grounds.push("ANPR timing or evidence may be worth checking");
  if (triage?.possible_landowner_authority_missing)  grounds.push("The operator's authority to issue charges at this location is not confirmed");
  if (triage?.possible_procedural_defect)            grounds.push("The notice may be missing required information");
  if (triage?.possible_wrong_vehicle_or_location)    grounds.push("Vehicle or location details appear inconsistent");
  if (triage?.possible_disproportionate_charge)      grounds.push("The charge amount may be disproportionate for a private fine");
  return grounds;
}

// ── Confirmation email ────────────────────────────────────────────────────────

export async function sendConfirmationEmail(env, { name, email, type }) {
  const labels = TYPE_LABELS[type] || TYPE_LABELS.debt;
  const isParking = type === "parking";

  await sendEmail(env, {
    to:      email,
    subject: "We've received your document — DoIPayThat",
    html:    `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1f2937;line-height:1.7;">
      <p style="font-size:1.1rem;font-weight:700;color:#14532d;">✓ We've received your document.</p>
      <p>Hi ${escapeHtml(name)},</p>
      <p>We'll review your ${escapeHtml(labels.title)} and send your first review by email by the next working day before 4pm.</p>
      <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:14px;margin:16px 0;">
        <strong style="color:#14532d;">What happens next?</strong>
        <p style="color:#166534;margin-top:6px;margin-bottom:0;line-height:1.65;">
          ${isParking
            ? "We'll take a look at the notice and help you understand the main points before you decide what to do next."
            : "We'll go through the document and let you know if there are any details worth looking at before you decide whether to pay."}
        </p>
      </div>
      <p style="font-size:.9rem;color:#6b7280;">→ Please also check your spam folder if you don't hear from us.</p>
      <p>Best regards,<br><strong>DoIPayThat</strong></p>
      <p style="color:#6b7280;font-size:0.82rem;margin-top:24px;">${escapeHtml(DISCLAIMER)}</p>
    </div>`
  });
}

// ── Admin emails ──────────────────────────────────────────────────────────────

export async function notifyAdminFree(env, { name, email, type, triage, stripeLink }) {
  const amount = formatAmount(triage, type) || "unknown";

  await sendEmail(env, {
    to:      env.ADMIN_EMAIL,
    subject: `[DoIPayThat] Free check: ${name} (${type})`,
    html:    `<div style="font-family:Arial,sans-serif;">
      <p style="background:#f3f4f6;padding:10px;border-radius:6px;font-size:0.85rem;">
        📬 Free lead — recovery sequence queued for <strong>${escapeHtml(email)}</strong>
      </p>
      <h3>Free check — ${escapeHtml(type)}</h3>
      <p><strong>Name:</strong> ${escapeHtml(name)}</p>
      <p><strong>Email:</strong> ${escapeHtml(email)}</p>
      <p><strong>Sender:</strong> ${escapeHtml(triage?.sender || "unknown")}</p>
      <p><strong>Amount:</strong> ${escapeHtml(String(amount))}</p>
      <p><strong>Risk:</strong> ${escapeHtml(triage?.risk || "")}</p>
      <p><strong>Chance:</strong> ${escapeHtml(String(triage?.chance ?? "unknown"))}</p>
      <p><strong>Flags:</strong> ${escapeHtml(String(triage?.flagCount ?? "unknown"))}</p>
      <p><strong>Email type:</strong> ${escapeHtml(triage?.emailType || "unknown")}</p>
      ${type === "parking" ? `
      <p><strong>Operator type:</strong> ${escapeHtml(triage?.operator_type || "unknown")}</p>
      <p><strong>Vehicle:</strong> ${escapeHtml(triage?.vehicle_registration || "unknown")}</p>
      ` : ""}
      <p><strong>Stripe link:</strong> ${stripeLink ? "YES" : "NO"}</p>
    </div>`
  });
}

export async function notifyAdminPaid(env, { name, email, type, triage, analysis }) {
  const analysisDocx = makeAnalysisDocx(analysis, name, email, triage, type);

  await sendEmail(env, {
    to:      env.ADMIN_EMAIL,
    subject: `[DoIPayThat] PAID: ${name} (${type})`,
    html:    `<div style="font-family:Arial,sans-serif;">
      <p style="background:#f3f4f6;padding:10px;border-radius:6px;font-size:0.85rem;">
        💰 Paid customer — recovery sequence stopped
      </p>
      <h3>Paid analysis — ${escapeHtml(type)}</h3>
      <p><strong>Name:</strong> ${escapeHtml(name)}</p>
      <p><strong>Email:</strong> ${escapeHtml(email)}</p>
      <p><strong>Sender:</strong> ${escapeHtml(triage?.sender || "unknown")}</p>
      <p><strong>Amount:</strong> ${escapeHtml(String(formatAmount(triage, type) || "unknown"))}</p>
      <p><strong>Risk:</strong> ${escapeHtml(triage?.risk || "")}</p>
    </div>`,
    attachments: [
      { filename: "Analysis.docx", content: docxToBase64(analysisDocx) }
    ]
  });
}

// ── Free email: tiered recovery sequence ─────────────────────────────────────

export async function sendFreeEmail(env, { name, email, type, triage, stripeLink, stage = 1 }) {
  const labels      = TYPE_LABELS[type] || TYPE_LABELS.debt;
  const amount      = formatAmount(triage, type);
  const stageNumber = Number(stage) || 1;
  const emailType   = triage?.emailType || "strong";
  const isParking   = type === "parking";

  if (stageNumber === 1) {
    const senderPart = triage?.sender ? ` from ${escapeHtml(triage.sender)}` : "";
    const amountStr  = amount ? escapeHtml(amount) : "";

    // ── Parking-specific stage 1 ──────────────────────────────────────────────
    if (isParking) {
      const grounds  = parkingGrounds(triage);
      const groundsHtml = grounds.length
        ? `<ul style="padding-left:20px;margin:8px 0 16px 0;">
            ${grounds.map(g => `<li style="margin-bottom:6px;">${escapeHtml(g)}</li>`).join("")}
           </ul>`
        : "";

      const subject = emailType === "trust"
        ? "Your parking notice has been reviewed"
        : amountStr
          ? `Before you pay ${amountStr} — your parking notice review`
          : "Before you pay — your parking notice review";

      let bodyHtml;

      if (emailType === "stark") {
        bodyHtml = `
          <p>Hi ${escapeHtml(name)},</p>
          <p>We've taken a first look at the parking notice${senderPart}${amountStr ? ` for ${amountStr}` : ""}.</p>
          <p>At first glance, parts of the notice may look straightforward. Even so, private parking notices are worth checking carefully before paying, especially where evidence, timings or signage are not fully explained.</p>
          <p><strong>What we noticed:</strong><br>
          ${escapeHtml(triage?.teaser || "There may be aspects of this fine worth checking before you pay anything.")}</p>
          ${groundsHtml ? `<p><strong>Possible grounds identified:</strong></p>${groundsHtml}` : ""}
          <p>If the operator has not followed the correct process under POFA 2012 or the relevant Code of Practice, the charge may be worth challenging — even if it looks legitimate at first glance.</p>
          <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;">
          <p>For £19 you get:</p>
          <ul style="padding-left:20px;margin:8px 0 16px 0;list-style:none;">
            <li>✓ Full review of every appeal ground</li>
            <li>✓ POFA 2012 keeper liability check</li>
            <li>✓ Signage, grace period and ANPR analysis</li>
            <li>✓ Ready-to-send appeal letter</li>
            <li>✓ Clear next steps if appeal is rejected</li>
          </ul>
          ${stripeLink ? `<p style="margin:20px 0;"><a href="${escapeHtml(stripeLink)}" style="display:inline-block;background:#1d3a6e;color:#fff;padding:14px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">Review the parking notice in full — £${escapeHtml(labels.price)} →</a></p>` : ""}
          <p style="font-size:0.9rem;color:#374151;">Most people prefer to check before they pay — especially when there may be grounds to challenge.</p>`;

      } else if (emailType === "soft") {
        bodyHtml = `
          <p>Hi ${escapeHtml(name)},</p>
          <p>We've taken a first look at the parking notice${senderPart}${amountStr ? ` for ${amountStr}` : ""}.</p>
          <p>Private parking notices are worth checking before paying, particularly where evidence or signage is not clearly explained.</p>
          <p>${escapeHtml(triage?.teaser || "There may be aspects of this fine worth checking before you pay.")}</p>
          ${groundsHtml ? `<p>Some possible areas to look at:</p>${groundsHtml}` : ""}
          <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;">
          <p>If you'd like a clearer picture, a full review and appeal letter is available for £19:</p>
          ${stripeLink ? `<p style="margin:20px 0;"><a href="${escapeHtml(stripeLink)}" style="display:inline-block;background:#1d3a6e;color:#fff;padding:14px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">Review the parking notice in full — £${escapeHtml(labels.price)} →</a></p>` : ""}`;

      } else {
        // trust — no pressure, no Stripe if showUpsell is false
        bodyHtml = `
          <p>Hi ${escapeHtml(name)},</p>
          <p>We've taken a look at the parking notice${senderPart}.</p>
          <p>At first glance the notice appears relatively straightforward. Even so, it is worth taking a moment to check the main points before deciding whether to pay.</p>
          <p>${escapeHtml(triage?.teaser || "Some aspects may be worth a quick check before you pay.")}</p>
          ${stripeLink ? `<p>If you'd like a full breakdown, a complete review is available:</p>
          <p style="margin:20px 0;"><a href="${escapeHtml(stripeLink)}" style="display:inline-block;background:#1d3a6e;color:#fff;padding:14px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">Get full review — £${escapeHtml(labels.price)} →</a></p>` : ""}`;
      }

      await sendEmail(env, {
        to:      email,
        subject,
        html:    `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1f2937;line-height:1.7;">
          ${bodyHtml}
          <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;">
          <p>If you have any questions, you can reach us at <a href="mailto:support@doipaythat.co.uk">support@doipaythat.co.uk</a>.</p>
          <p>Best regards,<br><strong>DoIPayThat</strong></p>
          <p style="font-size:0.8rem;color:#6b7280;margin-top:24px;">${escapeHtml(DISCLAIMER)}</p>
        </div>`
      });

      await trackEvent(env, "email_sent", { type, stage: 1, kind: "free", emailType });
      return true;
    }

    // ── Non-parking stage 1 ───────────────────────────────────────────────────
    const subject = emailType === "trust"
      ? (type === "bill" ? "Your bill review" : type === "quote" ? "Your quote has been reviewed" : type === "subscription" ? "Your subscription notice" : "Your document has been reviewed")
      : amountStr
        ? `A quick review of your ${escapeHtml(labels.title)}${amountStr ? " — " + amountStr : ""}`
        : `A quick review of your ${escapeHtml(labels.title)}`;

    let bodyHtml;

    if (emailType === "stark" || emailType === "strong") {
      bodyHtml = `
        <p>Hi ${escapeHtml(name)},</p>
        <p>We checked your ${escapeHtml(labels.title)}${senderPart}${amountStr ? ` regarding the claimed amount of ${amountStr}` : ""}.</p>
        <p>${escapeHtml(triage?.teaser || "There may be aspects of this letter worth looking at before you decide whether to pay.")}</p>
        <p style="font-size:.9rem;color:#374151;">For larger balances and added collection fees, many people prefer to understand the detail before deciding what to do next.</p>
        <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;">
        <p>If you'd like a fuller picture of the document and the additional charges, a more detailed review is available:</p>
        <ul style="padding-left:20px;margin:8px 0 16px 0;list-style:none;">
          <li>✓ Plain English explanation of the main points</li>
          <li>✓ Review of any added charges or unclear figures</li>
          <li>✓ A response letter you can use if you decide to write to the company</li>
        </ul>
        ${stripeLink ? `<p style="margin:20px 0;"><a href="${escapeHtml(stripeLink)}" style="display:inline-block;background:#1d3a6e;color:#fff;padding:14px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">${
          type === "debt" ? "Review the claim in full" :
          type === "bill" ? "Review the bill in full" :
          type === "quote" ? "Review the quote in more detail" :
          type === "subscription" ? "Review the contract details" :
          "Full analysis + " + labels.letter
        } — £${escapeHtml(labels.price)} →</a></p>` : ""}
        <p style="font-size:0.9rem;color:#374151;">Most people prefer to understand what they're being asked to pay — before they pay it.</p>`;

    } else if (emailType === "soft") {
      bodyHtml = `
        <p>Hi ${escapeHtml(name)},</p>
        <p>We've taken a first look at your ${escapeHtml(labels.title)}${senderPart}${amountStr ? ` for ${amountStr}` : ""}.</p>
        <p>There may be aspects worth checking before you proceed with payment.</p>
        <p>${escapeHtml(triage?.teaser || "There may be aspects of this claim worth checking before you pay.")}</p>
        <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;">
        <p>If you'd like a clearer picture, you can get a full analysis and a ready-to-send ${escapeHtml(labels.letter)}:</p>
        ${stripeLink ? `<p style="margin:20px 0;"><a href="${escapeHtml(stripeLink)}" style="display:inline-block;background:#1d3a6e;color:#fff;padding:14px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">${
          type === "debt" ? "Review the claim in full" :
          type === "bill" ? "Review the bill in full" :
          type === "quote" ? "Review the quote in more detail" :
          type === "subscription" ? "Review the contract details" :
          "Check before you pay"
        } — £${escapeHtml(labels.price)} →</a></p>` : ""}`;

    } else {
      bodyHtml = `
        <p>Hi ${escapeHtml(name)},</p>
        <p>We've reviewed your ${escapeHtml(labels.title)}${senderPart}.</p>
        <p>At first glance, everything appears relatively clear — but it can still be useful to review the details carefully before taking action.</p>
        <p>${escapeHtml(triage?.teaser || "Some details may be worth a closer look.")}</p>
        ${stripeLink ? `<p>If you'd like a full breakdown, you can still request a full analysis:</p>
        <p style="margin:20px 0;"><a href="${escapeHtml(stripeLink)}" style="display:inline-block;background:#1d3a6e;color:#fff;padding:14px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">Get full analysis — £${escapeHtml(labels.price)} →</a></p>` : ""}`;
    }

    await sendEmail(env, {
      to:      email,
      subject,
      html:    `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1f2937;line-height:1.7;">
        ${bodyHtml}
        <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;">
        <p>If you have any questions, you can reach us at <a href="mailto:support@doipaythat.co.uk">support@doipaythat.co.uk</a>.</p>
        <p>Best regards,<br><strong>DoIPayThat</strong></p>
        <p style="font-size:0.8rem;color:#6b7280;margin-top:24px;">${escapeHtml(DISCLAIMER)}</p>
      </div>`
    });

    await trackEvent(env, "email_sent", { type, stage: 1, kind: "free", emailType });
    return true;
  }

  // ── Stage 2 ───────────────────────────────────────────────────────────────
  if (stageNumber === 2) {
    if (!stripeLink) return;

    const subject = isParking
      ? "Your parking notice — still worth checking before you decide"
      : "Before you pay — a quick reminder";

    const bodyHtml = isParking
      ? `<p>Hi ${escapeHtml(name)},</p>
         <p>Just a quick reminder about the parking notice you uploaded.</p>
         <p>If you are still unsure whether to pay, the full review can help you understand the notice, the evidence and the possible next steps.</p>
         <p>The full review is still available for £${escapeHtml(labels.price)}:</p>`
      : `<p>Hi ${escapeHtml(name)},</p>
         <p>Just a note about the ${escapeHtml(labels.title)} you sent through.</p>
         <p>If you haven't had a chance to look at it yet, the full review can help you understand the main points — including any added charges — before you decide what to do.</p>`;

    await sendEmail(env, {
      to:      email,
      subject,
      html:    `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1f2937;line-height:1.7;">
        ${bodyHtml}
        <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;">
        <p style="margin:20px 0;">
          <a href="${escapeHtml(stripeLink)}" style="display:inline-block;background:#1d3a6e;color:#fff;padding:14px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">
            ${isParking ? `Review the parking notice in full — £${escapeHtml(labels.price)} →` : `Check this before you pay — £${escapeHtml(labels.price)} →`}
          </a>
        </p>
        <p style="font-size:0.9rem;color:#374151;">${isParking ? "If you are still unsure, the review explains the notice in plain English." : "A short check now can save you money — and stress — later."}</p>
        <p>Best regards,<br><strong>DoIPayThat</strong></p>
        <p style="font-size:0.8rem;color:#6b7280;margin-top:24px;">${escapeHtml(DISCLAIMER)}</p>
      </div>`
    });

    await trackEvent(env, "email_sent", { type, stage: 2, kind: "free", emailType });
    return true;
  }

  // ── Stage 3 ───────────────────────────────────────────────────────────────
  if (!stripeLink) return;

  const subject3 = isParking
    ? "Final reminder — your parking notice review"
    : "Our final reminder — before you pay";

  await sendEmail(env, {
    to:      email,
    subject: subject3,
    html:    `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1f2937;line-height:1.7;">
      <p>Hi ${escapeHtml(name)},</p>
      ${isParking
        ? `<p>This is our final reminder about your parking notice review.</p>
           <p>If you still want a clearer view before deciding what to do, the full review is still available below.</p>`
        : `<p>This is our final reminder before we close this follow-up.</p>
           <p>If you haven't had a chance to review the claim yet, it's still worth checking before you pay.</p>`}
      <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;">
      <p style="margin:20px 0;">
        <a href="${escapeHtml(stripeLink)}" style="display:inline-block;background:#1d3a6e;color:#fff;padding:14px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">
          See your options before you pay — £${escapeHtml(labels.price)} →
        </a>
      </p>
      <p style="font-size:0.9rem;color:#374151;">This takes just a few minutes — and gives you clarity before you decide.</p>
      <p>Best regards,<br><strong>DoIPayThat</strong></p>
      <p style="font-size:0.8rem;color:#6b7280;margin-top:24px;">${escapeHtml(DISCLAIMER)}</p>
    </div>`
  });

  await trackEvent(env, "email_sent", { type, stage: 3, kind: "free", emailType });
  return true;
}

// ── Paid email ────────────────────────────────────────────────────────────────

export async function sendPaidEmail(env, { name, email, type, triage, analysis }) {
  const labels      = TYPE_LABELS[type] || TYPE_LABELS.debt;
  const analysisDocx = makeAnalysisDocx(analysis, name, email, triage, type);
  const letterDocx   = makeLetterDocx(analysis, name, triage, type);
  const isParking    = type === "parking";

  const subject = isParking
    ? "Your parking notice review is ready — DoIPayThat"
    : "Your analysis is ready — here's what to do next";

  const tip = isParking
    ? "If you decide to contact the operator in writing, the attached response can be adapted as needed. Keep a copy for your records."
    : "Send the letter by recorded post and keep proof of postage. Send the letter on its own — do not include the analysis document.";

  await sendEmail(env, {
    to:      email,
    subject,
    html:    `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1f2937;line-height:1.7;">
      <p>Hi ${escapeHtml(name)},</p>
      <p>Your ${isParking ? "parking fine review" : "analysis"} is ready.</p>
      <p>You now have everything you need to ${isParking ? "decide whether to appeal and how" : "understand the situation and respond with confidence"}.</p>
      <p>Please find attached:</p>
      <ul style="padding-left:20px;margin:8px 0 16px 0;list-style:none;">
        <li>✓ <strong>Analysis.docx</strong> — full breakdown with findings and next steps</li>
        <li>✓ <strong>${escapeHtml(labels.filename)}</strong> — ready-to-send ${escapeHtml(labels.letter)}</li>
      </ul>
      <p style="background:#f0fdf4;border-left:4px solid #22c55e;padding:12px;border-radius:4px;font-size:0.9rem;">
        💡 Tip: ${escapeHtml(tip)}
      </p>
      ${isParking ? `<p style="font-size:0.9rem;color:#374151;">The assessment also includes some notes on next steps, should you decide to take the matter further.</p>` : ""}
      <p>If anything is unclear, you can contact us at <a href="mailto:support@doipaythat.co.uk">support@doipaythat.co.uk</a>.</p>
      <p>Best regards,<br><strong>DoIPayThat</strong></p>
      <p style="font-size:0.8rem;color:#6b7280;margin-top:24px;">${escapeHtml(DISCLAIMER)}</p>
    </div>`,
    attachments: [
      { filename: "Analysis.docx",  content: docxToBase64(analysisDocx) },
      { filename: labels.filename,  content: docxToBase64(letterDocx) }
    ]
  });

  await trackEvent(env, "email_sent", { type, kind: "paid" });
}

// ── Abandoned checkout emails ─────────────────────────────────────────────────

export async function sendAbandonedEmail(env, { name, email, type, amount, stripeLink, stage = 1 }) {
  if (!stripeLink) return;

  const labels      = TYPE_LABELS[type] || TYPE_LABELS.debt;
  const stageNumber = Number(stage) || 1;
  const isParking   = type === "parking";
  const amountPhrase = amount
    ? isParking
      ? ` — the fine is £${escapeHtml(String(amount))}`
      : ` — especially when £${escapeHtml(String(amount))} is involved`
    : "";

  let subject, bodyHtml;

  if (stageNumber === 1) {
    subject = isParking
      ? "You started checking your parking fine — it's worth finishing"
      : "Quick check before you pay";

    bodyHtml = isParking
      ? `<p>Hi ${escapeHtml(name)},</p>
         <p>You started reviewing your parking notice but didn't complete it.</p>
         <p>If you are still unsure whether to pay, the full review explains the notice, the evidence and the possible next steps in plain English.</p>
         <p>You can continue here:</p>`
      : `<p>Hi ${escapeHtml(name)},</p>
         <p>You started checking your ${escapeHtml(labels.title)} but didn't complete it.</p>
         <p>Before you pay, it's often worth taking a closer look${amountPhrase}.</p>
         <p>You can continue here:</p>`;

  } else if (stageNumber === 2) {
    subject = isParking
      ? "Your parking fine — still worth checking"
      : "Before you pay — one more look";

    bodyHtml = isParking
      ? `<p>Hi ${escapeHtml(name)},</p>
         <p>Just a reminder about the parking notice you uploaded.</p>
         <p>If you are still undecided, the review can help you understand what the notice says, what evidence is included, and what your options are.</p>`
      : `<p>Hi ${escapeHtml(name)},</p>
         <p>Just a quick reminder.</p>
         <p>Many people only realise they could have challenged a claim after they've already paid.</p>
         <p>If you're unsure, it's safer to check first.</p>`;

  } else {
    subject = isParking
      ? amountPhrase ? `Final reminder — your parking fine${amountPhrase}` : "Final reminder — your parking fine"
      : amount && Number(amount) > 500
        ? `Before you pay £${amount} — check this first`
        : "Final check before you pay";

    bodyHtml = isParking
      ? `<p>Hi ${escapeHtml(name)},</p>
         <p>This is our final reminder about your parking notice review.</p>
         <p>If you still want a clearer view before deciding what to do, you can complete the review here.</p>`
      : `<p>Hi ${escapeHtml(name)},</p>
         <p>If you don't check this now, you may end up paying unnecessarily.</p>
         <p>This is our final reminder before we close this follow-up.</p>`;
  }

  await sendEmail(env, {
    to:      email,
    subject,
    html:    `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1f2937;line-height:1.7;">
      ${bodyHtml}
      <p style="margin:20px 0;">
        <a href="${escapeHtml(stripeLink)}" style="display:inline-block;background:#1d3a6e;color:#fff;padding:14px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">
          ${isParking ? `Review the parking notice in full — £${escapeHtml(labels.price)} →` : `Continue — £${escapeHtml(labels.price)} →`}
        </a>
      </p>
      <p style="font-size:0.9rem;color:#374151;">
        ${isParking ? "The review explains the notice in plain English — before you decide what to do." : "Most people prefer to check first rather than risk paying too much."}
      </p>
      <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;">
      <p>Best regards,<br><strong>DoIPayThat</strong></p>
      <p style="font-size:0.8rem;color:#6b7280;margin-top:24px;">${escapeHtml(DISCLAIMER)}</p>
    </div>`
  });

  await trackEvent(env, "email_sent", { type, stage: stageNumber, kind: "abandoned" });
}
