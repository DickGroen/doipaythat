// worker/services/resend.js — doipaythat

import { escapeHtml } from "../utils/html.js";
import { makeAnalysisRtf, makeLetterRtf, rtfToBase64 } from "../utils/rtf.js";

const FROM = "DoIPayThat <noreply@doipaythat.co.uk>";
const DISCLAIMER =
  "This is informational analysis only and does not constitute legal advice. DoIPayThat does not provide legal representation.";

const TYPE_LABELS = {
  debt: {
    title: "debt letter",
    letter: "dispute letter",
    price: "49",
    filename: "Dispute-Letter.rtf",
    stripe_label: "Full analysis + dispute letter — £49",
  },
  parking: {
    title: "parking fine",
    letter: "appeal letter",
    price: "19",
    filename: "Appeal-Letter.rtf",
    stripe_label: "Full analysis + appeal letter — £19",
  },
  bill: {
    title: "bill",
    letter: "dispute letter",
    price: "29",
    filename: "Dispute-Letter.rtf",
    stripe_label: "Full analysis + dispute letter — £29",
  },
  subscription: {
    title: "subscription charge",
    letter: "cancellation letter",
    price: "29",
    filename: "Cancellation-Letter.rtf",
    stripe_label: "Full analysis + cancellation letter — £29",
  },
  quote: {
    title: "quote or estimate",
    letter: "response letter",
    price: "29",
    filename: "Response-Letter.rtf",
    stripe_label: "Analysis + response letter — £29",
  },
};

async function trackEvent(env, event, data = {}) {
  try {
    const id = crypto.randomUUID();
    const key = `track:${data.type || "unknown"}:${event}:${Date.now()}:${id}`;

    await env.DEBT_QUEUE.put(
      key,
      JSON.stringify({
        event,
        ...data,
        received_at: new Date().toISOString(),
      }),
      { expirationTtl: 60 * 60 * 24 * 90 }
    );
  } catch (err) {
    console.error("Track error:", err.message);
  }
}

async function sendEmail(env, { to, subject, html, attachments = [] }) {
  const body = {
    from: FROM,
    to: Array.isArray(to) ? to : [to],
    subject,
    html,
  };

  if (attachments.length) {
    body.attachments = attachments;
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Resend error: ${err}`);
  }

  return res.json();
}

function capitalizeName(name) {
  const s = String(name || "").trim();
  if (!s) return "there";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function formatMoney(value, symbol = "£") {
  if (value === null || value === undefined || value === "") return null;

  const cleaned = String(value).replace(/[£€$,]/g, "").trim();
  const n = Number(cleaned);

  if (!Number.isFinite(n)) {
    return `${symbol}${escapeHtml(String(value))}`;
  }

  return `${symbol}${n.toLocaleString("en-GB")}`;
}

function formatAmount(triage = {}, type) {
  if (type === "parking") {
    return formatMoney(triage?.amount_claimed ?? triage?.fine_amount);
  }

  return formatMoney(
    triage?.amount_claimed ??
      triage?.fine_amount ??
      triage?.total_price ??
      triage?.annual_cost ??
      triage?.monthly_cost
  );
}

function parkingGrounds(triage = {}) {
  const grounds = [];

  if (triage?.possible_ntk_timing_defect) {
    grounds.push("Notice to Keeper timing may not comply with POFA 2012");
  }

  if (triage?.possible_pofa_keeper_liability_failure) {
    grounds.push(
      "Keeper liability under POFA 2012 may not have been correctly established"
    );
  }

  if (triage?.possible_signage_defect) {
    grounds.push("Signage at the location may not meet the required standard");
  }

  if (triage?.possible_grace_period_failure) {
    grounds.push("The mandatory grace period may not have been applied");
  }

  if (triage?.possible_anpr_timing_issue) {
    grounds.push("ANPR timing or evidence may be worth checking");
  }

  if (triage?.possible_landowner_authority_missing) {
    grounds.push(
      "The operator's authority to issue charges at this location is not confirmed"
    );
  }

  if (triage?.possible_procedural_defect) {
    grounds.push("The notice may be missing required information");
  }

  if (triage?.possible_wrong_vehicle_or_location) {
    grounds.push("Vehicle or location details appear inconsistent");
  }

  if (triage?.possible_disproportionate_charge) {
    grounds.push("The charge amount may be disproportionate for a private fine");
  }

  return grounds;
}

function debtBulletHtml() {
  return `
<ul style="padding-left:20px;margin:8px 0 16px 0;color:#374151;font-size:0.93rem;line-height:1.8;">
  <li>unclear or excessive added fees</li>
  <li>limited supporting evidence for the claimed amount</li>
  <li>balance discrepancies or unexplained charges</li>
  <li>legal escalation or pressure wording</li>
</ul>`;
}

// ── Confirmation email ────────────────────────────────────────────────────────

export async function sendConfirmationEmail(env, { name, email, type }) {
  const labels = TYPE_LABELS[type] || TYPE_LABELS.debt;
  const isParking = type === "parking";
  const safeName = escapeHtml(capitalizeName(name));

  await sendEmail(env, {
    to: email,
    subject: "We've received your document — DoIPayThat",
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1f2937;line-height:1.7;">
  <p style="font-size:1.1rem;font-weight:700;color:#14532d;">✓ We've received your document.</p>

  <p>Hi ${safeName},</p>

  <p>We'll review your ${escapeHtml(labels.title)} carefully and send your first assessment by email by the next working day before 4pm.</p>

  <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:14px;margin:16px 0;">
    <strong style="color:#14532d;">Why this matters:</strong>
    <p style="color:#166534;margin-top:6px;margin-bottom:0;line-height:1.65;">
      ${
        isParking
          ? "Many parking fines contain procedural errors, incorrect timing or unclear signage. Our review helps you understand what to check before deciding how to respond."
          : "Many people only realise there may have been aspects worth questioning after they've already paid. Our review helps you understand what to check before deciding how to respond."
      }
    </p>
  </div>

  <p style="font-size:.9rem;color:#6b7280;">→ Please also check your spam folder if you don't hear from us.</p>

  <p>Best regards,<br><strong>DoIPayThat</strong></p>

  <p style="color:#6b7280;font-size:0.82rem;margin-top:24px;">${escapeHtml(DISCLAIMER)}</p>
</div>`,
  });
}

// ── Admin emails ──────────────────────────────────────────────────────────────

export async function notifyAdminFree(env, { name, email, type, triage, stripeLink }) {
  const labels = TYPE_LABELS[type] || TYPE_LABELS.debt;
  const amount = formatAmount(triage, type) || "unknown";
  const riskLbl =
    { low: "Low", medium: "Medium", high: "High" }[triage?.risk] ||
    triage?.risk ||
    "unknown";
  const tier = triage?.tier
    ? triage.tier.charAt(0).toUpperCase() + triage.tier.slice(1)
    : "unknown";
  const route = triage?.route || "unknown";
  const isParking = type === "parking";

  const grounds = isParking ? parkingGrounds(triage) : [];
  const groundsHtml = grounds.length
    ? grounds.map((g) => `<li>${escapeHtml(g)}</li>`).join("")
    : "";

  await sendEmail(env, {
    to: env.ADMIN_EMAIL,
    subject: `[DoIPayThat] Free check: ${name} (${type})`,
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;">
  <p style="background:#f3f4f6;padding:10px;border-radius:6px;font-size:0.85rem;">
    📬 Free lead — recovery sequence queued for <strong>${escapeHtml(email)}</strong>
  </p>

  <h3>Free check — ${escapeHtml(labels.title)}</h3>

  <table style="width:100%;border-collapse:collapse;font-size:0.9rem;">
    <tr><td style="padding:6px 10px;font-weight:bold;width:40%;">Name</td><td style="padding:6px 10px;">${escapeHtml(name)}</td></tr>
    <tr style="background:#f9fafb;"><td style="padding:6px 10px;font-weight:bold;">Email</td><td style="padding:6px 10px;">${escapeHtml(email)}</td></tr>
    <tr><td style="padding:6px 10px;font-weight:bold;">Sender</td><td style="padding:6px 10px;">${escapeHtml(triage?.sender || "unknown")}</td></tr>
    <tr style="background:#f9fafb;"><td style="padding:6px 10px;font-weight:bold;">Amount</td><td style="padding:6px 10px;font-weight:bold;color:#1d3a6e;">${escapeHtml(String(amount))}</td></tr>
    <tr><td style="padding:6px 10px;font-weight:bold;">Risk</td><td style="padding:6px 10px;">${escapeHtml(riskLbl)}</td></tr>
    <tr style="background:#f9fafb;"><td style="padding:6px 10px;font-weight:bold;">Chance</td><td style="padding:6px 10px;">${escapeHtml(String(triage?.chance ?? "?"))}%</td></tr>
    <tr><td style="padding:6px 10px;font-weight:bold;">Flag count</td><td style="padding:6px 10px;">${escapeHtml(String(triage?.flagCount ?? "?"))}</td></tr>
    <tr style="background:#f9fafb;"><td style="padding:6px 10px;font-weight:bold;">Email type</td><td style="padding:6px 10px;">${escapeHtml(triage?.emailType || "unknown")}</td></tr>
    <tr><td style="padding:6px 10px;font-weight:bold;">Tier</td><td style="padding:6px 10px;">${escapeHtml(tier)}</td></tr>
    <tr style="background:#f9fafb;"><td style="padding:6px 10px;font-weight:bold;">Route</td><td style="padding:6px 10px;">${escapeHtml(route)}</td></tr>

    ${
      isParking
        ? `<tr><td style="padding:6px 10px;font-weight:bold;">Operator type</td><td style="padding:6px 10px;">${escapeHtml(triage?.operator_type || "unknown")}</td></tr>
           <tr style="background:#f9fafb;"><td style="padding:6px 10px;font-weight:bold;">Vehicle</td><td style="padding:6px 10px;">${escapeHtml(triage?.vehicle_registration || "unknown")}</td></tr>`
        : ""
    }

    ${
      stripeLink
        ? `<tr><td style="padding:6px 10px;font-weight:bold;">Stripe</td><td style="padding:6px 10px;"><a href="${escapeHtml(stripeLink)}">${escapeHtml(stripeLink)}</a></td></tr>`
        : ""
    }
  </table>

  ${
    groundsHtml
      ? `<p style="margin-top:16px;"><strong>Parking grounds identified:</strong></p><ul style="font-size:0.9rem;">${groundsHtml}</ul>`
      : ""
  }
</div>`,
  });
}

export async function notifyAdminPaid(env, { name, email, type, triage, analysis }) {
  const labels = TYPE_LABELS[type] || TYPE_LABELS.debt;
  const analysisRtf = makeAnalysisRtf(analysis, name, email, triage, type);
  const riskLbl =
    { low: "Low", medium: "Medium", high: "High" }[triage?.risk] ||
    triage?.risk ||
    "unknown";

  await sendEmail(env, {
    to: env.ADMIN_EMAIL,
    subject: `[DoIPayThat] PAID: ${name} (${type})`,
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;">
  <p style="background:#f3f4f6;padding:10px;border-radius:6px;font-size:0.85rem;">
    💰 Paid customer — recovery sequence stopped
  </p>

  <h3>Paid analysis — ${escapeHtml(labels.title)}</h3>

  <table style="width:100%;border-collapse:collapse;font-size:0.9rem;">
    <tr><td style="padding:6px 10px;font-weight:bold;width:40%;">Name</td><td style="padding:6px 10px;">${escapeHtml(name)}</td></tr>
    <tr style="background:#f9fafb;"><td style="padding:6px 10px;font-weight:bold;">Email</td><td style="padding:6px 10px;">${escapeHtml(email)}</td></tr>
    <tr><td style="padding:6px 10px;font-weight:bold;">Sender</td><td style="padding:6px 10px;">${escapeHtml(triage?.sender || "unknown")}</td></tr>
    <tr style="background:#f9fafb;"><td style="padding:6px 10px;font-weight:bold;">Amount</td><td style="padding:6px 10px;font-weight:bold;color:#1d3a6e;">${escapeHtml(String(formatAmount(triage, type) || "unknown"))}</td></tr>
    <tr><td style="padding:6px 10px;font-weight:bold;">Risk</td><td style="padding:6px 10px;">${escapeHtml(riskLbl)}</td></tr>
    <tr style="background:#f9fafb;"><td style="padding:6px 10px;font-weight:bold;">Tier</td><td style="padding:6px 10px;">${escapeHtml(String(triage?.tier || "unknown"))}</td></tr>
  </table>
</div>`,
    attachments: [
      {
        filename: "Analysis.rtf",
        content: rtfToBase64(analysisRtf),
      },
    ],
  });
}

// ── Free email: tiered recovery sequence ─────────────────────────────────────

export async function sendFreeEmail(env, { name, email, type, triage, stripeLink, stage = 1 }) {
  const labels = TYPE_LABELS[type] || TYPE_LABELS.debt;
  const amount = formatAmount(triage, type);
  const stageNumber = Number(stage) || 1;
  const emailType = triage?.emailType || "strong";
  const isParking = type === "parking";
  const isDebt = type === "debt";
  const safeName = escapeHtml(capitalizeName(name));

  if (stageNumber === 1) {
    const senderPart = triage?.sender ? ` from ${escapeHtml(triage.sender)}` : "";
    const amountStr = amount ? escapeHtml(amount) : "";

    if (isParking) {
      return await sendParkingFreeStage1(env, {
        name: safeName,
        email,
        labels,
        triage,
        stripeLink,
        amountStr,
        senderPart,
        emailType,
        type,
      });
    }

    const subject =
      emailType === "trust"
        ? amountStr
          ? `Your ${escapeHtml(labels.title)} review — a few things worth checking`
          : `Your ${escapeHtml(labels.title)} review — some points worth checking`
        : amountStr
          ? `Before you pay ${amountStr} — check this first`
          : "Before you pay — check this first";

    let bodyHtml;

    if (isDebt && ["stark", "strong", "soft"].includes(emailType)) {
      bodyHtml = `
        <p>Hi ${safeName},</p>
        <p>We've taken a first look at your debt letter${senderPart}${amountStr ? ` regarding a claimed balance of ${amountStr}` : ""}.</p>
        <p>Our initial review suggests there may be points worth checking carefully before deciding whether payment is appropriate.</p>
        <p>Debt collection letters can sometimes include:</p>
        ${debtBulletHtml()}
        <p>A full review can help clarify whether the claim appears properly supported and whether any points may be worth challenging.</p>
        <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;">
        ${
          stripeLink
            ? `<p style="margin:20px 0;"><a href="${escapeHtml(stripeLink)}" style="display:inline-block;background:#1d3a6e;color:#fff;padding:14px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">Check before you pay — full review + ready-to-send ${escapeHtml(labels.letter)} for £${escapeHtml(labels.price)} →</a></p>`
            : ""
        }`;
    } else if (emailType === "stark" || emailType === "strong") {
      bodyHtml = `
        <p>Hi ${safeName},</p>
        <p>We checked your ${escapeHtml(labels.title)}${senderPart}${amountStr ? ` regarding the claimed amount of ${amountStr}` : ""}.</p>
        <p>There are signs you could be paying more than you should.</p>
        <p>Many people only realise this after they've already paid unnecessary charges or costs.</p>
        <p><strong>What we noticed:</strong><br>${escapeHtml(triage?.teaser || "There may be aspects of this claim worth checking, including possible additional charges or unclear parts of the demand.")}</p>
        <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;">
        <p>If you want to know exactly what to do next, you can get a full analysis and a ready-to-send ${escapeHtml(labels.letter)}:</p>
        <ul style="padding-left:20px;margin:8px 0 16px 0;list-style:none;">
          <li>✓ Clear explanation of your situation</li>
          <li>✓ Specific points worth checking</li>
          <li>✓ A ready-to-send ${escapeHtml(labels.letter)} you can use immediately</li>
        </ul>
        ${
          stripeLink
            ? `<p style="margin:20px 0;"><a href="${escapeHtml(stripeLink)}" style="display:inline-block;background:#1d3a6e;color:#fff;padding:14px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">Full analysis + ${escapeHtml(labels.letter)} — £${escapeHtml(labels.price)} →</a></p>`
            : ""
        }
        <p style="font-size:0.9rem;color:#374151;">Most people prefer to understand what they're being asked to pay — before they pay it.</p>`;
    } else if (emailType === "soft") {
      bodyHtml = `
        <p>Hi ${safeName},</p>
        <p>We've taken a first look at your ${escapeHtml(labels.title)}${senderPart}${amountStr ? ` for ${amountStr}` : ""}.</p>
        <p>There may be aspects worth checking before you proceed with payment.</p>
        <p>${escapeHtml(triage?.teaser || "There may be aspects of this claim worth checking before you pay.")}</p>
        <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;">
        <p>If you'd like a clearer picture, you can get a full analysis and a ready-to-send ${escapeHtml(labels.letter)}:</p>
        ${
          stripeLink
            ? `<p style="margin:20px 0;"><a href="${escapeHtml(stripeLink)}" style="display:inline-block;background:#1d3a6e;color:#fff;padding:14px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">Check before you pay — £${escapeHtml(labels.price)} →</a></p>`
            : ""
        }`;
    } else {
      // trust / tier-3 — concrete language, no generic uncertainty stacking, CTA always present
      const trustTeaser = triage?.teaser
        ? escapeHtml(triage.teaser)
        : `It may still be useful to verify how the ${escapeHtml(labels.title === "debt letter" ? "balance has been calculated and whether all supporting details are clearly documented" : "amount has been calculated and whether the supporting details fully match your records")}.`;

      bodyHtml = `
        <p>Hi ${safeName},</p>
        <p>We've reviewed your ${escapeHtml(labels.title)}${senderPart}${amountStr ? ` for ${amountStr}` : ""}.</p>
        <p>The correspondence appears professionally presented and generally consistent — but it is still worth checking carefully before you pay or respond.</p>
        <p>${trustTeaser}</p>
        <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;">
        <p>A full review confirms exactly what the claim covers and gives you a ready-to-send ${escapeHtml(labels.letter)} if you decide to respond in writing:</p>
        <p style="margin:20px 0;"><a href="${stripeLink ? escapeHtml(stripeLink) : "#"}" style="display:inline-block;background:#1d3a6e;color:#fff;padding:14px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">Review the full details before responding — £${escapeHtml(labels.price)} →</a></p>
        <p style="font-size:0.9rem;color:#374151;">Most people prefer to understand what they are being asked to pay — before they pay it.</p>`;
    }

    await sendEmail(env, {
      to: email,
      subject,
      html: wrapCustomerEmail(bodyHtml),
    });

    await trackEvent(env, "email_sent", { type, stage: 1, kind: "free", emailType });
    return;
  }

  if (stageNumber === 2) {
    return await sendFreeStage2(env, {
      name: safeName,
      email,
      type,
      labels,
      triage,
      stripeLink,
      emailType,
      isParking,
    });
  }

  return await sendFreeStage3(env, {
    name: safeName,
    email,
    type,
    labels,
    triage,
    stripeLink,
    emailType,
    isParking,
  });
}

async function sendParkingFreeStage1(env, { name, email, labels, triage, stripeLink, amountStr, senderPart, emailType, type }) {
  const grounds = parkingGrounds(triage);
  const groundsHtml = grounds.length
    ? `<ul style="padding-left:20px;margin:8px 0 16px 0;">
        ${grounds.map((g) => `<li style="margin-bottom:6px;">${escapeHtml(g)}</li>`).join("")}
       </ul>`
    : "";

  const subject =
    emailType === "trust"
      ? amountStr
        ? `Your parking fine review — a few things worth checking before you pay ${amountStr}`
        : "Your parking fine review — some points worth checking first"
      : amountStr
        ? `Before you pay ${amountStr} — your parking fine check`
        : "Before you pay that parking fine — check this first";

  let bodyHtml;

  if (emailType === "stark" || emailType === "strong") {
    bodyHtml = `
      <p>Hi ${name},</p>
      <p>We've taken a first look at your parking fine${senderPart}${amountStr ? ` for ${amountStr}` : ""}.</p>
      <p><strong>There may be appeal points worth checking before you pay.</strong></p>
      <p>Many people pay parking charges too quickly — often because the fine looks official and the deadline feels urgent. But paying without checking means giving up your right to appeal.</p>
      <p><strong>What we noticed:</strong><br>${escapeHtml(triage?.teaser || "There may be aspects of this fine worth checking before you pay anything.")}</p>
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
      ${
        stripeLink
          ? `<p style="margin:20px 0;"><a href="${escapeHtml(stripeLink)}" style="display:inline-block;background:#1d3a6e;color:#fff;padding:14px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">Full analysis + appeal letter — £${escapeHtml(labels.price)} →</a></p>`
          : ""
      }
      <p style="font-size:0.9rem;color:#374151;">Most people prefer to check before they pay — especially when there may be grounds to challenge.</p>`;
  } else if (emailType === "soft") {
    bodyHtml = `
      <p>Hi ${name},</p>
      <p>We've taken a first look at your parking fine${senderPart}${amountStr ? ` for ${amountStr}` : ""}.</p>
      <p>There may be aspects worth checking before you pay. Many people pay parking charges without realising they could have appealed successfully.</p>
      <p>${escapeHtml(triage?.teaser || "There may be aspects of this fine worth checking before you pay.")}</p>
      ${groundsHtml ? `<p>Some possible areas to look at:</p>${groundsHtml}` : ""}
      <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;">
      <p>If you'd like a clearer picture, a full review and appeal letter is available for £19:</p>
      ${
        stripeLink
          ? `<p style="margin:20px 0;"><a href="${escapeHtml(stripeLink)}" style="display:inline-block;background:#1d3a6e;color:#fff;padding:14px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">Check before you pay — £${escapeHtml(labels.price)} →</a></p>`
          : ""
      }`;
  } else {
    // trust / tier-3 parking — improved
    bodyHtml = `
      <p>Hi ${name},</p>
      <p>We've reviewed your parking fine${senderPart}${amountStr ? ` for ${amountStr}` : ""}.</p>
      <p>The fine appears to have been issued through the correct channels, but there are still some procedural points worth checking before you pay.</p>
      <p>${escapeHtml(triage?.teaser || "Some aspects of how the charge was issued may be worth a closer look before deciding whether to pay.")}</p>
      ${groundsHtml ? `<p>Some areas that may be worth checking:</p>${groundsHtml}` : ""}
      <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;">
      <p>A full review confirms whether the correct process was followed — and includes a ready-to-send appeal letter if you decide to challenge:</p>
      ${
        stripeLink
          ? `<p style="margin:20px 0;"><a href="${escapeHtml(stripeLink)}" style="display:inline-block;background:#1d3a6e;color:#fff;padding:14px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">Review the full details before paying — £${escapeHtml(labels.price)} →</a></p>`
          : ""
      }
      <p style="font-size:0.9rem;color:#374151;">Checking first takes minutes. Paying without checking is permanent.</p>`;
  }

  await sendEmail(env, {
    to: email,
    subject,
    html: wrapCustomerEmail(bodyHtml),
  });

  await trackEvent(env, "email_sent", { type, stage: 1, kind: "free", emailType });
}

async function sendFreeStage2(env, { name, email, type, labels, triage, stripeLink, emailType, isParking }) {
  if (!stripeLink) return;

  const subject = isParking
    ? "Your parking fine — still worth checking before you pay"
    : "Before you pay — a quick reminder";

  const bodyHtml = isParking
    ? `<p>Hi ${name},</p>
       <p>Just a reminder about your parking fine.</p>
       <p>Many people pay parking charges without checking — and later discover they had valid grounds to appeal. Once you pay, that option is gone.</p>
       ${
         parkingGrounds(triage)[0]
           ? `<p style="background:#fef3c7;border:1px solid #fbbf24;padding:12px;border-radius:6px;font-size:0.9rem;"><strong>Worth noting:</strong> ${escapeHtml(parkingGrounds(triage)[0])}</p>`
           : ""
       }
       <p>A full review and ready-to-send appeal letter is still available for £${escapeHtml(labels.price)}:</p>`
    : `<p>Hi ${name},</p>
       <p>Just a quick reminder about your ${escapeHtml(labels.title)}.</p>
       <p>Some aspects may still require clarification before deciding how to respond — and it is easier to check now than after you have already paid.</p>
       ${
         triage?.teaser
           ? `<p style="background:#fef3c7;border:1px solid #fbbf24;padding:12px;border-radius:6px;font-size:0.9rem;"><strong>From your initial review:</strong> ${escapeHtml(triage.teaser)}</p>`
           : ""
       }
       <p>You've already taken the first step — now you can see exactly what to do next.</p>`;

  const cta = `
<p style="margin:20px 0;">
  <a href="${escapeHtml(stripeLink)}" style="display:inline-block;background:#1d3a6e;color:#fff;padding:14px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">
    ${isParking ? `Appeal before you pay — £${escapeHtml(labels.price)} →` : `Get the full review before you respond — £${escapeHtml(labels.price)} →`}
  </a>
</p>
<p style="font-size:0.9rem;color:#374151;">
  ${isParking ? "Checking first takes minutes. Paying without checking is permanent." : "A short check now can save you money — and stress — later."}
</p>`;

  await sendEmail(env, {
    to: email,
    subject,
    html: wrapCustomerEmail(`${bodyHtml}<hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;">${cta}`),
  });

  await trackEvent(env, "email_sent", { type, stage: 2, kind: "free", emailType });
}

async function sendFreeStage3(env, { name, email, type, labels, triage, stripeLink, emailType, isParking }) {
  if (!stripeLink) return;

  const subject = isParking
    ? "Final reminder — check your parking fine before you pay"
    : "Our final reminder — before you pay";

  const bodyHtml = isParking
    ? `<p>Hi ${name},</p>
       <p>This is our final reminder about your parking fine.</p>
       <p>If you haven't checked yet, it's still worth a look before you pay. Many fines that appear legitimate on the surface contain procedural errors that make them worth challenging.</p>
       ${
         parkingGrounds(triage)[0]
           ? `<p style="background:#fef3c7;border:1px solid #fbbf24;padding:12px;border-radius:6px;font-size:0.9rem;"><strong>Worth noting:</strong> ${escapeHtml(parkingGrounds(triage)[0])}</p>`
           : ""
       }`
    : `<p>Hi ${name},</p>
       <p>This is our final reminder before we close this follow-up.</p>
       <p>If you haven't had a chance to review the claim yet, it's still worth checking before you pay or respond. Some details in correspondence like this are not always as clear as they appear.</p>
       ${
         triage?.teaser
           ? `<p style="background:#fef3c7;border:1px solid #fbbf24;padding:12px;border-radius:6px;font-size:0.9rem;"><strong>From your initial review:</strong> ${escapeHtml(triage.teaser)}</p>`
           : ""
       }`;

  const cta = `
<hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;">
<p style="margin:20px 0;">
  <a href="${escapeHtml(stripeLink)}" style="display:inline-block;background:#1d3a6e;color:#fff;padding:14px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">
    See your options before you pay — £${escapeHtml(labels.price)} →
  </a>
</p>
<p style="font-size:0.9rem;color:#374151;">This takes just a few minutes — and gives you clarity before you decide.</p>`;

  await sendEmail(env, {
    to: email,
    subject,
    html: wrapCustomerEmail(`${bodyHtml}${cta}`),
  });

  await trackEvent(env, "email_sent", { type, stage: 3, kind: "free", emailType });
}

function wrapCustomerEmail(bodyHtml) {
  return `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1f2937;line-height:1.7;">
  ${bodyHtml}
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;">
  <p>If you have any questions, simply reply to this email.</p>
  <p>Best regards,<br><strong>DoIPayThat</strong></p>
  <p style="font-size:0.8rem;color:#6b7280;margin-top:24px;">${escapeHtml(DISCLAIMER)}</p>
</div>`;
}

// ── Paid email ────────────────────────────────────────────────────────────────

export async function sendPaidEmail(env, { name, email, type, triage, analysis }) {
  const labels = TYPE_LABELS[type] || TYPE_LABELS.debt;
  const analysisRtf = makeAnalysisRtf(analysis, name, email, triage, type);
  const letterRtf = makeLetterRtf(analysis, name, triage, type);
  const isParking = type === "parking";
  const safeName = escapeHtml(capitalizeName(name));

  const subject = isParking
    ? "Your appeal letter is ready — DoIPayThat"
    : "Your analysis is ready — here's what to do next";

  const tip = isParking
    ? "Send the appeal letter by first class post and keep proof of postage. Do not include the analysis document — send the letter on its own."
    : "Send the letter by recorded post and keep proof of postage. Send the letter on its own — do not include the analysis document.";

  await sendEmail(env, {
    to: email,
    subject,
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1f2937;line-height:1.7;">
  <p>Hi ${safeName},</p>

  <p>Your ${isParking ? "parking fine review" : "analysis"} is ready.</p>

  <p>You now have everything you need to ${isParking ? "decide whether to appeal and how" : "understand the situation and respond with confidence"}.</p>

  <p>Please find attached:</p>

  <ul style="padding-left:20px;margin:8px 0 16px 0;list-style:none;">
    <li>✓ <strong>Analysis.rtf</strong> — full breakdown with findings and next steps</li>
    <li>✓ <strong>${escapeHtml(labels.filename)}</strong> — ready-to-send ${escapeHtml(labels.letter)}</li>
  </ul>

  <p><strong>Important:</strong> Please read the analysis before sending the letter.</p>

  <p style="font-size:0.9rem;color:#6b7280;">
    The attached RTF files can be opened in Microsoft Word, LibreOffice or similar word processors.
  </p>

  <p style="background:#f0fdf4;border-left:4px solid #22c55e;padding:12px;border-radius:4px;font-size:0.9rem;">
    💡 Tip: ${escapeHtml(tip)}
  </p>

  ${
    isParking
      ? `<p style="font-size:0.9rem;color:#374151;">If your appeal is rejected: the letter includes information on escalating to POPLA for BPA members or IAS for IPC members.</p>`
      : ""
  }

  <p>If anything is unclear, you can simply reply to this email.</p>

  <p>Best regards,<br><strong>DoIPayThat</strong></p>

  <p style="font-size:0.8rem;color:#6b7280;margin-top:24px;">${escapeHtml(DISCLAIMER)}</p>
</div>`,
    attachments: [
      { filename: "Analysis.rtf", content: rtfToBase64(analysisRtf) },
      { filename: labels.filename, content: rtfToBase64(letterRtf) },
    ],
  });

  await trackEvent(env, "email_sent", { type, kind: "paid" });
}

// ── Abandoned checkout emails ─────────────────────────────────────────────────

export async function sendAbandonedEmail(env, { name, email, type, amount, stripeLink, stage = 1 }) {
  if (!stripeLink) return;

  const labels = TYPE_LABELS[type] || TYPE_LABELS.debt;
  const stageNumber = Number(stage) || 1;
  const isParking = type === "parking";
  const safeName = escapeHtml(capitalizeName(name));
  const amountText = formatMoney(amount);

  const amountPhrase = amountText
    ? isParking
      ? ` — the fine is ${amountText}`
      : ` — especially when ${amountText} is involved`
    : "";

  let subject;
  let bodyHtml;

  if (stageNumber === 1) {
    subject = isParking
      ? "You started checking your parking fine — it's worth finishing"
      : "Quick check before you pay";

    bodyHtml = isParking
      ? `<p>Hi ${safeName},</p>
         <p>You started reviewing your parking fine but didn't complete it.</p>
         <p>Before you pay${amountPhrase}, it's worth knowing whether there are grounds to appeal. Many fines contain errors in timing, signage or procedure that make them worth challenging.</p>
         <p>You can continue here:</p>`
      : `<p>Hi ${safeName},</p>
         <p>You started checking your ${escapeHtml(labels.title)} but didn't complete it.</p>
         <p>Before you pay, it's often worth taking a closer look${amountPhrase}.</p>
         <p>You can continue here:</p>`;
  } else if (stageNumber === 2) {
    subject = isParking
      ? "Your parking fine — still worth checking"
      : "Before you pay — one more look";

    bodyHtml = isParking
      ? `<p>Hi ${safeName},</p>
         <p>Just a reminder — many parking fines that get paid didn't have to be.</p>
         <p>If the operator didn't follow the correct process, the charge may be worth challenging. It only takes a few minutes to find out.</p>`
      : `<p>Hi ${safeName},</p>
         <p>Just a quick reminder.</p>
         <p>Many people only realise they could have challenged a claim after they've already paid.</p>
         <p>If you're unsure, it's safer to check first.</p>`;
  } else {
    subject = isParking
      ? amountPhrase
        ? `Final reminder — your parking fine${amountPhrase}`
        : "Final reminder — your parking fine"
      : amountText && Number(String(amount).replace(/[£€$,]/g, "")) > 500
        ? `Before you pay ${amountText} — check this first`
        : "Final check before you pay";

    bodyHtml = isParking
      ? `<p>Hi ${safeName},</p>
         <p>This is our final reminder about your parking fine.</p>
         <p>If you pay without checking, you lose your right to appeal. If the fine had grounds worth challenging, that money is gone.</p>`
      : `<p>Hi ${safeName},</p>
         <p>If you don't check this now, you may end up paying unnecessarily.</p>
         <p>This is our final reminder before we close this follow-up.</p>`;
  }

  await sendEmail(env, {
    to: email,
    subject,
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1f2937;line-height:1.7;">
  ${bodyHtml}

  <p style="margin:20px 0;">
    <a href="${escapeHtml(stripeLink)}" style="display:inline-block;background:#1d3a6e;color:#fff;padding:14px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">
      ${isParking ? `Appeal before you pay — £${escapeHtml(labels.price)} →` : `Continue — £${escapeHtml(labels.price)} →`}
    </a>
  </p>

  <p style="font-size:0.9rem;color:#374151;">
    ${isParking ? "A few minutes now could save you the full amount." : "Most people prefer to check first rather than risk paying too much."}
  </p>

  <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;">

  <p>Best regards,<br><strong>DoIPayThat</strong></p>

  <p style="font-size:0.8rem;color:#6b7280;margin-top:24px;">${escapeHtml(DISCLAIMER)}</p>
</div>`,
  });

  await trackEvent(env, "email_sent", {
    type,
    stage: stageNumber,
    kind: "abandoned",
  });
}
