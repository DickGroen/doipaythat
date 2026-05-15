// worker/utils/rtf.js

export function rtfToBase64(rtf) {
  const bytes = [];

  for (let i = 0; i < rtf.length; i++) {
    const code = rtf.charCodeAt(i);

    if (code < 128) {
      bytes.push(code);
    } else {
      const escaped = `\\u${code}?`;
      for (let j = 0; j < escaped.length; j++) {
        bytes.push(escaped.charCodeAt(j));
      }
    }
  }

  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);

  return btoa(binary);
}

function esc(value = "") {
  return String(value)
    .replace(/\\/g, "\\\\")
    .replace(/{/g, "\\{")
    .replace(/}/g, "\\}")
    .replace(/\u2014/g, "\\emdash ")
    .replace(/\u2013/g, "\\endash ")
    .replace(/\u2018/g, "\\'91")
    .replace(/\u2019/g, "\\'92")
    .replace(/\u201c/g, "\\'93")
    .replace(/\u201d/g, "\\'94")
    .replace(/\u00a3/g, "\\'a3")
    .replace(/\u20ac/g, "\\'80")
    .replace(/\*/g, "")
    .replace(/\n/g, "\\par\n");
}

function stripBlocks(text = "") {
  return String(text).replace(/\[\/?\w+\]/g, "").trim();
}

function stripTrailingDisclaimer(text = "") {
  // Remove trailing disclaimer lines that Claude may append to the letter content
  return String(text)
    .replace(/\n*(This (content|document|letter) is (informational|for informational purposes)[^\n]*\n?)+$/i, "")
    .replace(/\n*(This is a draft[^\n]*\n?)+$/i, "")
    .replace(/\n*Please direct all future correspondence[^\n]*\n?/gi, "")
    .trim();
}

function getBlock(text, block) {
  const regex = new RegExp(`\\[${block}\\]([\\s\\S]*?)\\[\\/${block}\\]`, "i");
  const match = String(text).match(regex);
  return match ? match[1].trim() : "";
}

function hasStrongIdentityConcern(triage = {}) {
  return Boolean(
    triage.possible_wrong_person ||
      triage.possible_identity_mismatch ||
      triage.possible_wrong_address ||
      triage.possible_recipient_mismatch ||
      triage.possible_account_mismatch
  );
}

function hasEvidenceConcern(triage = {}) {
  return Boolean(
    triage.possible_no_proof ||
      triage.possible_missing_evidence ||
      triage.possible_no_breakdown ||
      triage.possible_missing_breakdown ||
      triage.possible_excessive_fees ||
      triage.possible_pressure_language
  );
}

function concernLabel(triage = {}, type = "debt") {
  if (type === "parking") {
    if (triage.risk === "high") return "High";
    if (triage.risk === "low") return "Low";
    if (
      triage.possible_ntk_timing_defect ||
      triage.possible_pofa_keeper_liability_failure ||
      triage.possible_signage_defect ||
      triage.possible_grace_period_failure ||
      triage.possible_landowner_authority_missing
    ) {
      return "Elevated";
    }
    return "Moderate";
  }

  if (triage.risk === "high") return "High";
  if (triage.risk === "low") return "Low";

  if (hasStrongIdentityConcern(triage)) return "Elevated";
  if (hasEvidenceConcern(triage) && Number(triage.flagCount || 0) >= 2) return "Elevated";

  return "Moderate";
}

function formatMoney(value, symbol = "\u00a3") {
  if (value === null || value === undefined || value === "") return null;

  const cleaned = String(value).replace(/[£€$,]/g, "").trim();
  const n = Number(cleaned);

  if (!Number.isFinite(n)) return `${symbol}${value}`;

  return `${symbol}${n.toLocaleString("en-GB", {
    minimumFractionDigits: n % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatAmount(triage = {}) {
  return (
    formatMoney(triage.amount_claimed) ||
    formatMoney(triage.fine_amount) ||
    formatMoney(triage.total_price) ||
    formatMoney(triage.annual_cost) ||
    formatMoney(triage.monthly_cost) ||
    null
  );
}

function recommendedAction(triage = {}, type = "debt") {
  if (type === "parking") {
    return "Do not pay before reviewing appeal grounds";
  }

  if (hasStrongIdentityConcern(triage)) {
    return "Request written evidence and clarification before paying";
  }

  if (hasEvidenceConcern(triage)) {
    return "Request written evidence before paying";
  }

  return "Review the supporting details before paying";
}

function priorityNote(triage = {}, type = "debt") {
  if (type === "parking") {
    return "Before taking any action, read this review carefully. Send the appeal letter on its own — do not include this analysis document.";
  }

  if (hasStrongIdentityConcern(triage)) {
    return "Before taking any action, read this review carefully. The recipient or account details may need clarification before any payment or acknowledgement is considered. Send the letter on its own — do not include this analysis.";
  }

  return "Before taking any action, read this review carefully. Send the letter on its own — do not include this analysis.";
}

function buildSections(summary, issues, assessment, nextSteps) {
  const body = [summary, issues, assessment].filter((s) => s && s.length > 60);
  const sections = [];

  if (body.length <= 1) {
    const text = body[0] || summary || issues || assessment || "No details available.";
    sections.push({ title: "Analysis", text });
  } else {
    if (summary) sections.push({ title: "What We Found", text: summary });
    if (issues) sections.push({ title: "Issues Identified", text: issues });
    if (assessment) sections.push({ title: "Assessment", text: assessment });
  }

  if (nextSteps) sections.push({ title: "What To Do Next", text: nextSteps });

  return sections;
}

// ── Analysis RTF ──────────────────────────────────────────────────────────────

export function makeAnalysisRtf(
  analysis,
  name = "",
  email = "",
  triage = {},
  type = "debt"
) {
  const title = getBlock(analysis, "TITLE") || "Document Analysis";
  const summary = getBlock(analysis, "SUMMARY") || "";
  const issues = getBlock(analysis, "ISSUES") || "";
  const assessment = getBlock(analysis, "ASSESSMENT") || "";
  const nextSteps = getBlock(analysis, "NEXT_STEPS") || "";

  const amount = formatAmount(triage);
  const concern = concernLabel(triage, type);
  const sender = triage.sender || null;
  const dateStr = new Date().toLocaleDateString("en-GB");
  const isParking = type === "parking";

  const summaryLines = [
    amount
      ? `\\pard\\sb0\\sa100\\f1\\fs22 \\b ${
          isParking ? "Fine amount" : "Claimed amount"
        }:\\b0\\tab ${esc(amount)}\\par`
      : null,

    `\\pard\\sb0\\sa100\\f1\\fs22 \\b Concern level:\\b0\\tab ${esc(concern)}\\par`,

    sender
      ? `\\pard\\sb0\\sa100\\f1\\fs22 \\b ${
          isParking ? "Operator" : "Sender"
        }:\\b0\\tab ${esc(sender)}\\par`
      : null,

    isParking && triage.vehicle_registration
      ? `\\pard\\sb0\\sa100\\f1\\fs22 \\b Vehicle:\\b0\\tab ${esc(
          triage.vehicle_registration
        )}\\par`
      : null,

    isParking && triage.operator_type
      ? `\\pard\\sb0\\sa100\\f1\\fs22 \\b Operator type:\\b0\\tab ${esc(
          triage.operator_type === "private"
            ? "Private parking company"
            : triage.operator_type === "council"
              ? "Council / local authority"
              : triage.operator_type
        )}\\par`
      : null,

    `\\pard\\sb0\\sa100\\f1\\fs22 \\b Recommended action:\\b0\\tab ${esc(
      recommendedAction(triage, type)
    )}\\par`,
  ]
    .filter(Boolean)
    .join("\n");

  const sections = buildSections(summary, issues, assessment, nextSteps);

  const sectionsRtf = sections
    .map(
      (s) =>
        `{\\pard\\sb400\\sa160\\f1\\fs26\\b\\cf1 ${esc(
          s.title
        )}\\b0\\cf0\\par}\n` +
        `{\\pard\\sb0\\sa200\\f1\\fs22\\cf0 ${esc(s.text)}\\par}`
    )
    .join("\n");

  return `{\\rtf1\\ansi\\ansicpg1252\\deff0
{\\fonttbl{\\f0\\froman\\fcharset0 Times New Roman;}{\\f1\\fswiss\\fcharset0 Arial;}}
{\\colortbl;\\red27\\green58\\blue140;\\red153\\green26\\blue26;\\red34\\green139\\blue34;\\red180\\green140\\blue0;}
\\paperw11906\\paperh16838\\margl1800\\margr1800\\margt1440\\margb1440\\f1\\fs22

{\\pard\\sb400\\sa120\\f1\\fs34\\b\\cf1 ${esc(title)}\\b0\\cf0\\par}
{\\pard\\sb0\\sa60\\f1\\fs20\\cf0 ${esc(name)} \\emdash  ${esc(email)}\\par}
{\\pard\\sb0\\sa300\\f1\\fs20\\cf0 ${esc(type)} review \\endash  ${esc(dateStr)}\\par}

{\\pard\\sb300\\sa80\\f1\\fs24\\b\\cf1 Case Summary\\b0\\cf0\\par}
{\\pard\\sb0\\sa0\\shading800\\cbpat2\\box\\brdrs\\brdrw8\\brsp80
${summaryLines}
\\pard\\par}

{\\pard\\sb200\\sa300\\f1\\fs20\\cf4\\i ${esc(priorityNote(triage, type))}\\i0\\cf0\\par}

${sectionsRtf}

{\\pard\\sb500\\sa0\\brdrb\\brdrs\\brdrw5\\brsp60\\f1\\fs18\\cf0\\par}
{\\pard\\sb100\\sa0\\f1\\fs16\\cf0\\i This document is for informational purposes only and does not constitute legal advice. DoIPayThat does not provide legal representation.\\i0\\par}
}`;
}

// ── Letter RTF ────────────────────────────────────────────────────────────────

export function makeLetterRtf(analysis, name = "", triage = {}, type = "debt") {
  let letter = "";

  if (type === "parking") {
    letter = getBlock(analysis, "LETTER") || getBlock(analysis, "APPEAL_LETTER") || "";
    if (!letter) letter = parkingFallbackLetter(triage);
  } else {
    letter =
      getBlock(analysis, "LETTER") ||
      getBlock(analysis, "DISPUTE_LETTER") ||
      getBlock(analysis, "CANCELLATION_LETTER") ||
      getBlock(analysis, "RESPONSE_LETTER") ||
      stripBlocks(analysis);
  }

  // Strip any trailing disclaimer lines Claude may have appended to the letter
  letter = stripTrailingDisclaimer(letter);

  const titleMap = {
    debt: "Dispute Letter",
    parking: "Appeal Letter",
    bill: "Dispute Letter",
    subscription: "Cancellation Letter",
    quote: "Response Letter",
  };

  const title = titleMap[type] || "Letter";
  const sender = triage.sender || null;
  const dateStr = new Date().toLocaleDateString("en-GB");
  const isParking = type === "parking";

  // Pre-fill company name when sender is known — user only needs to fill address
  const companyNameLine = isParking
    ? "[Parking Operator Name]"
    : sender
      ? esc(sender)
      : "[Company Name]";

  const instrText = isParking
    ? "Complete the fields marked in brackets before sending. Send this letter on its own — do not include the analysis. Keep a copy for your records. Send by first class post and retain proof of postage."
    : "Complete the fields marked in brackets before sending. Send this letter on its own — do not include the analysis. Keep a copy for your records.";

  return `{\\rtf1\\ansi\\ansicpg1252\\deff0
{\\fonttbl{\\f0\\froman\\fcharset0 Times New Roman;}{\\f1\\fswiss\\fcharset0 Arial;}}
{\\colortbl;\\red27\\green58\\blue140;\\red153\\green26\\blue26;\\red34\\green139\\blue34;\\red180\\green140\\blue0;}
\\paperw11906\\paperh16838\\margl1800\\margr1800\\margt1440\\margb1440\\f1\\fs22

{\\pard\\sb400\\sa160\\f1\\fs30\\b\\cf2 ${esc(title)}\\b0\\cf0\\par}
{\\pard\\sb0\\sa80\\f1\\fs20\\cf0 Prepared for: ${esc(name)}${
    sender ? ` \\emdash  ${isParking ? "Operator" : "Sender"}: ${esc(sender)}` : ""
  }\\par}
{\\pard\\sb0\\sa300\\f1\\fs20\\cf4\\i ${esc(instrText)}\\i0\\cf0\\par}

{\\pard\\sb300\\sa200\\f1\\fs22\\cf0
[Your Name]\\par
[Your Address]\\par
[Postcode]\\par
\\par
${companyNameLine}\\par[Company Address]\\par
\\par
${esc(dateStr)}\\par
\\par
${esc(letter)}\\par
}

{\\pard\\sb500\\sa0\\brdrb\\brdrs\\brdrw5\\brsp60\\f1\\fs18\\cf0\\par}
{\\pard\\sb100\\sa0\\f1\\fs16\\cf0\\i This is a draft for informational purposes only and does not constitute legal advice.\\i0\\par}
}`;
}

// ── Parking fallback letter ───────────────────────────────────────────────────

function parkingFallbackLetter(triage = {}) {
  const isCouncil = triage.operator_type === "council";
  const reg = triage.vehicle_registration || "[Vehicle registration]";
  const conDate = triage.contravention_date || "[date of alleged contravention]";
  const sender = triage.sender || "[operator name]";

  if (isCouncil) {
    return `Dear Sir or Madam,

RE: Formal Representation — Penalty Charge Notice
Vehicle: ${reg}
Date of alleged contravention: ${conDate}

I write to formally represent against the above Penalty Charge Notice issued by your authority.

I do not accept that the alleged contravention took place as described, and I request that the PCN be cancelled.

In support of this representation, I request the following information in writing:

1. Full details of the alleged contravention, including the specific contravention code and the statutory basis for the charge.
2. Copies of any photographic or CCTV evidence relied upon, including clear timestamped images.
3. Confirmation that the notice was correctly served in accordance with the Traffic Management Act 2004 and the relevant statutory regulations.
4. Confirmation of the observation period recorded, where applicable.

I reserve the right to appeal to the Traffic Penalty Tribunal (or London Tribunals) if this representation is rejected.

This letter does not constitute an admission of liability.

Yours faithfully,

[Your full name]
[Your address]
[Date]`;
  }

  return `Dear Sir or Madam,

RE: Formal Appeal — Parking Charge Notice
Vehicle registration: ${reg}
Date of alleged contravention: ${conDate}
Operator: ${sender}

I write to formally appeal the above Parking Charge Notice.

I do not accept that this charge is valid or enforceable, and I request that it be cancelled immediately.

In support of this appeal, I request the following information in writing within 14 days:

1. Full timestamped photographic evidence of the alleged contravention, including clear images of the vehicle entering and leaving the location.
2. Confirmation of the exact date the original Parking Charge Notice was issued to the vehicle and the exact date this Notice to Keeper was sent, to allow me to assess compliance with Schedule 4 of the Protection of Freedoms Act 2012.
3. Photographs of the signage in place at the location on the date of the alleged contravention, showing the terms and conditions clearly displayed at the point of entry, in compliance with the BPA or IPC Code of Practice.
4. A copy of the current landowner authority contract confirming your organisation's right to issue parking charges at this specific location.
5. Confirmation of your BPA or IPC membership number and compliance scheme.

Until the above information is received and this appeal has been formally considered, I will not be making any payment.

If this appeal is rejected, I will escalate to POPLA (BPA members) or the Independent Appeals Service (IPC members) as appropriate.

This letter does not constitute an admission of liability.

Yours faithfully,

[Your full name]
[Your address]
[Date]`;
}
