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
    .replace(/\n/g, "\\par\n");
}

function stripBlocks(text = "") {
  return String(text).replace(/\[\/?[A-Z_]+\]/g, "").trim();
}

function getBlock(text, block) {
  const regex = new RegExp(`\\[${block}\\]([\\s\\S]*?)\\[\\/${block}\\]`, "i");
  const match = String(text).match(regex);
  return match ? match[1].trim() : "";
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

function buildSections(summary, issues, assessment, nextSteps) {
  const body = [summary, issues, assessment].filter(s => s && s.length > 60);
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

// ── Analysis RTF ─────────────────────────────────────────────────────────────

export function makeAnalysisRtf(analysis, name = "", email = "", triage = {}, type = "debt") {
  const title = getBlock(analysis, "TITLE") || "Document Analysis";
  const summary = getBlock(analysis, "SUMMARY") || "";
  const issues = getBlock(analysis, "ISSUES") || "";
  const assessment = getBlock(analysis, "ASSESSMENT") || "";
  const nextSteps = getBlock(analysis, "NEXT_STEPS") || "";

  const amount = formatAmount(triage);
  const risk = riskLabel(triage.risk);
  const sender = triage.sender || null;
  const dateStr = new Date().toLocaleDateString("en-GB");

  const summaryLines = [
    amount ? `\\pard\\sb0\\sa100\\f1\\fs22 \\b Claimed amount:\\b0\\tab ${esc(amount)}\\par` : null,
    `\\pard\\sb0\\sa100\\f1\\fs22 \\b Concern level:\\b0\\tab ${esc(risk)}\\par`,
    sender ? `\\pard\\sb0\\sa100\\f1\\fs22 \\b Sender:\\b0\\tab ${esc(sender)}\\par` : null,
    `\\pard\\sb0\\sa100\\f1\\fs22 \\b Recommended action:\\b0\\tab Request written evidence before paying\\par`,
  ].filter(Boolean).join("\n");

  const sections = buildSections(summary, issues, assessment, nextSteps);

  const sectionsRtf = sections.map(s =>
    `{\\pard\\sb400\\sa160\\f1\\fs26\\b\\cf1 ${esc(s.title)}\\b0\\cf0\\par}\n` +
    `{\\pard\\sb0\\sa200\\f1\\fs22\\cf0 ${esc(s.text)}\\par}`
  ).join("\n");

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

{\\pard\\sb200\\sa300\\f1\\fs20\\cf4\\i Before taking any action, read this review carefully. Send the letter on its own \\emdash  do not include this analysis.\\i0\\cf0\\par}

${sectionsRtf}

{\\pard\\sb500\\sa0\\brdrb\\brdrs\\brdrw5\\brsp60\\f1\\fs18\\cf0\\par}
{\\pard\\sb100\\sa0\\f1\\fs16\\cf0\\i This document is for informational purposes only and does not constitute legal advice. DoIPayThat does not provide legal representation.\\i0\\par}
}`;
}

// ── Letter RTF ───────────────────────────────────────────────────────────────

export function makeLetterRtf(analysis, name = "", triage = {}, type = "debt") {
  const titleMap = {
    debt: "Dispute Letter",
    parking: "Appeal Letter",
    bill: "Dispute Letter",
    subscription: "Cancellation Letter",
    quote: "Response Letter",
  };

  const title = titleMap[type] || "Letter";
  const sender = triage.sender || "Creditor";
  const amount = formatAmount(triage);
  const dateStr = new Date().toLocaleDateString("en-GB");

  return `{\\rtf1\\ansi\\ansicpg1252\\deff0
{\\fonttbl{\\f0\\froman\\fcharset0 Times New Roman;}{\\f1\\fswiss\\fcharset0 Arial;}}
{\\colortbl;\\red27\\green58\\blue140;\\red153\\green26\\blue26;\\red34\\green139\\blue34;\\red180\\green140\\blue0;}
\\paperw11906\\paperh16838\\margl1800\\margr1800\\margt1440\\margb1440\\f1\\fs22

{\\pard\\sb400\\sa160\\f1\\fs30\\b\\cf2 ${esc(title)}\\b0\\cf0\\par}

{\\pard\\sb0\\sa80\\f1\\fs20\\cf0 ${esc(name || "[Your Name]")}\\par}
{\\pard\\sb0\\sa80\\f1\\fs20\\cf0 [Your Address]\\par}
{\\pard\\sb0\\sa260\\f1\\fs20\\cf0 [Postcode]\\par}

{\\pard\\sb0\\sa80\\f1\\fs20\\cf0 ${esc(sender)}\\par}
{\\pard\\sb0\\sa260\\f1\\fs20\\cf0 [Company Address]\\par}

{\\pard\\sb0\\sa300\\f1\\fs20\\cf0 ${esc(dateStr)}\\par}

{\\pard\\sb0\\sa220\\f1\\fs24\\b\\cf0 Re: Request for clarification regarding claimed amount\\b0\\par}
${amount ? `{\\pard\\sb0\\sa260\\f1\\fs20\\cf0 Claimed amount: ${esc(amount)}\\par}` : ""}

{\\pard\\sb120\\sa180\\f1\\fs22\\cf0 Dear Sir or Madam,\\par}

{\\pard\\sb120\\sa180\\f1\\fs22\\cf0 I am writing regarding the above claim.\\par}

{\\pard\\sb120\\sa180\\f1\\fs22\\cf0 At this stage, I do not acknowledge liability for the amount claimed.\\par}

{\\pard\\sb120\\sa180\\f1\\fs22\\cf0 Before any payment can be considered, I request full written clarification and supporting evidence relating to this claim, including details of any fees, charges, or additional costs that have been added.\\par}

{\\pard\\sb120\\sa180\\f1\\fs22\\cf0 Please also provide copies of any documents or agreements you rely upon in support of this claim.\\par}

{\\pard\\sb120\\sa180\\f1\\fs22\\cf0 Until this information has been provided and reviewed, I am unable to assess the validity of the amount claimed.\\par}

{\\pard\\sb240\\sa180\\f1\\fs22\\cf0 I look forward to your response.\\par}

{\\pard\\sb320\\sa120\\f1\\fs22\\cf0 Yours faithfully,\\par}

{\\pard\\sb420\\sa80\\f1\\fs22\\b\\cf0 ${esc(name || "[Your Name]")}\\b0\\par}

{\\pard\\sb500\\sa0\\brdrb\\brdrs\\brdrw5\\brsp60\\f1\\fs18\\cf0\\par}
{\\pard\\sb100\\sa0\\f1\\fs16\\cf0\\i This is a draft for informational purposes only and is not legal advice.\\i0\\par}
}`;
}
