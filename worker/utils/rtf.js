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

  for (const b of bytes) {
    binary += String.fromCharCode(b);
  }

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
    .replace(/\n/g, "\\par\n");
}

function getBlock(text, block) {
  const regex = new RegExp(`\\[${block}\\]([\\s\\S]*?)\\[\\/${block}\\]`, "i");
  const match = String(text).match(regex);

  return match ? match[1].trim() : "";
}

function cleanHeadingMarkdown(text = "") {
  return String(text).replace(/\*\*/g, "").trim();
}

function riskLabel(risk) {
  if (risk === "high") return "High";
  if (risk === "low") return "Low";
  return "Moderate";
}

function formatAmount(triage = {}) {
  if (triage.amount_claimed) return `£${triage.amount_claimed}`;
  if (triage.fine_amount) return `£${triage.fine_amount}`;
  return null;
}

// ── ANALYSIS ────────────────────────────────────────────────────────────────

export function makeAnalysisRtf(
  analysis,
  name = "",
  email = "",
  triage = {},
  type = "debt"
) {
  const title = getBlock(analysis, "TITLE") || "Document Analysis";

  let summary    = getBlock(analysis, "SUMMARY") || "";
  let issues     = getBlock(analysis, "ISSUES") || "";
  let assessment = getBlock(analysis, "ASSESSMENT") || "";
  let nextSteps  = getBlock(analysis, "NEXT_STEPS") || "";

  issues = cleanHeadingMarkdown(issues);

  const amount  = formatAmount(triage);
  const risk    = riskLabel(triage.risk);
  const sender  = triage.sender || null;
  const dateStr = new Date().toLocaleDateString("en-GB");

  return `{\\rtf1\\ansi\\ansicpg1252\\deff0

{\\fonttbl
{\\f0 Arial;}
}

\\paperw11906
\\paperh16838
\\margl1440
\\margr1440
\\margt1440
\\margb1440

\\viewkind4
\\uc1
\\pard

{\\pard\\sb240\\sa120\\fs34\\b
${esc(title)}
\\b0\\par}

{\\pard\\sb0\\sa60\\fs20
${esc(name)} — ${esc(email)}
\\par}

{\\pard\\sb0\\sa260\\fs20
${esc(type)} review – ${esc(dateStr)}
\\par}

{\\pard\\sb260\\sa120\\fs26\\b
Case Summary
\\b0\\par}

${amount ? `
{\\pard\\sb0\\sa80\\fs20
\\b Claimed amount:\\b0 ${esc(amount)}
\\par}
` : ""}

{\\pard\\sb0\\sa80\\fs20
\\b Concern level:\\b0 ${esc(risk)}
\\par}

${sender ? `
{\\pard\\sb0\\sa80\\fs20
\\b Sender:\\b0 ${esc(sender)}
\\par}
` : ""}

{\\pard\\sb0\\sa260\\fs20
\\b Recommended action:\\b0 Request written evidence before paying
\\par}

{\\pard\\sb160\\sa260\\fs20\\i
Before taking any action, read this review carefully. Send the letter on its own — do not include this analysis.
\\i0\\par}

{\\pard\\sb260\\sa120\\fs26\\b
What We Found
\\b0\\par}

{\\pard\\sb0\\sa240\\fs22
${esc(summary)}
\\par}

{\\pard\\sb260\\sa120\\fs26\\b
Issues Identified
\\b0\\par}

{\\pard\\sb0\\sa240\\fs22
${esc(issues)}
\\par}

{\\pard\\sb260\\sa120\\fs26\\b
Assessment
\\b0\\par}

{\\pard\\sb0\\sa240\\fs22
${esc(assessment)}
\\par}

{\\pard\\sb260\\sa120\\fs26\\b
What To Do Next
\\b0\\par}

{\\pard\\sb0\\sa240\\fs22
${esc(nextSteps)}
\\par}

{\\pard\\sb400\\sa0\\brdrb\\brdrs\\brdrw5\\brsp60\\par}

{\\pard\\sb100\\sa0\\fs16\\i
This document is for informational purposes only and does not constitute legal advice. DoIPayThat does not provide legal representation.
\\i0\\par}

}`;
}

// ── LETTER ──────────────────────────────────────────────────────────────────

export function makeLetterRtf(
  analysis,
  name = "",
  triage = {},
  type = "debt"
) {
  const today = new Date().toLocaleDateString("en-GB");

  const sender = triage?.sender || "Creditor";

  const amount =
    triage?.amount_claimed ||
    triage?.fine_amount ||
    "";

  return `{\\rtf1\\ansi\\ansicpg1252\\deff0

{\\fonttbl
{\\f0 Arial;}
}

\\paperw11906
\\paperh16838
\\margl1440
\\margr1440
\\margt1440
\\margb1440

\\viewkind4
\\uc1
\\pard

{\\pard\\sb120\\sa80\\fs20
${esc(name)}
\\par}

{\\pard\\sb0\\sa80\\fs20
[Your Address]
\\par}

{\\pard\\sb0\\sa260\\fs20
[Postcode]
\\par}

{\\pard\\sb0\\sa80\\fs20
${esc(sender)}
\\par}

{\\pard\\sb0\\sa260\\fs20
[Company Address]
\\par}

{\\pard\\sb0\\sa260\\fs20
${esc(today)}
\\par}

{\\pard\\sb120\\sa220\\fs26\\b
Request for clarification regarding claimed amount
\\b0\\par}

${amount ? `
{\\pard\\sb0\\sa240\\fs20
Claimed amount: ${esc(String(amount))}
\\par}
` : ""}

{\\pard\\sb120\\sa180\\fs22
Dear Sir or Madam,
\\par}

{\\pard\\sb120\\sa180\\fs22
I am writing regarding your letter about the above claim.
\\par}

{\\pard\\sb120\\sa180\\fs22
At this stage, I do not acknowledge liability for the amount claimed.
\\par}

{\\pard\\sb120\\sa180\\fs22
Before any payment can be considered, please provide full written evidence of the claim, including:
\\par}

{\\pard\\li720\\sb0\\sa120\\fs22
1. A copy of the original agreement, contract or invoices relied upon.
\\par}

{\\pard\\li720\\sb0\\sa120\\fs22
2. A full itemised breakdown of the amount claimed.
\\par}

{\\pard\\li720\\sb0\\sa120\\fs22
3. An explanation of how the collection fees and reminder costs have been calculated.
\\par}

{\\pard\\li720\\sb0\\sa120\\fs22
4. Written confirmation of your authority to collect this debt on behalf of the original creditor.
\\par}

{\\pard\\li720\\sb0\\sa120\\fs22
5. Confirmation of the date on which the debt first became due and the date of any original default.
\\par}

{\\pard\\sb120\\sa180\\fs22
The contract reference appears to relate to an older claim. For that reason, please also confirm whether any payments, acknowledgements or other events have occurred since then which you say affect the enforceability of the claim.
\\par}

{\\pard\\sb120\\sa180\\fs22
Until the requested documents have been provided and reviewed, I am unable to assess the validity of the amount claimed.
\\par}

{\\pard\\sb120\\sa180\\fs22
Please pause collection activity and any escalation while this request for evidence is outstanding.
\\par}

{\\pard\\sb120\\sa180\\fs22
This letter does not constitute an admission of liability.
\\par}

{\\pard\\sb120\\sa240\\fs22
Please respond in writing.
\\par}

{\\pard\\sb260\\sa120\\fs22
Yours faithfully,
\\par}

{\\pard\\sb420\\sa80\\b\\fs22
${esc(name)}
\\b0\\par}

{\\pard\\sb400\\sa0\\brdrb\\brdrs\\brdrw5\\brsp60\\par}

{\\pard\\sb100\\sa0\\fs16\\i
This is a draft for informational purposes only and is not legal advice.
\\i0\\par}

}`;
}
