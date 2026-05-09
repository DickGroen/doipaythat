// worker/utils/rtf.js

export function rtfToBase64(rtf) {
  return btoa(unescape(encodeURIComponent(rtf)));
}

function esc(value = "") {
  return String(value)
    .replace(/\\/g, "\\\\")
    .replace(/{/g, "\\{")
    .replace(/}/g, "\\}")
    .replace(/\n/g, "\\par\n");
}

function stripBlocks(text = "") {
  return String(text)
    .replace(/\[\/?[A-Z_]+\]/g, "")
    .trim();
}

function getBlock(text, block) {
  const regex = new RegExp(`\\[${block}\\]([\\s\\S]*?)\\[\\/${block}\\]`, "i");
  const match = String(text).match(regex);
  return match ? match[1].trim() : "";
}

function riskLabel(risk) {
  if (risk === "high") return "High";
  if (risk === "low")  return "Low";
  return "Moderate";
}

function formatAmount(triage = {}) {
  if (triage.amount_claimed) return `\u00a3${triage.amount_claimed}`;
  if (triage.fine_amount)    return `\u00a3${triage.fine_amount}`;
  return null;
}

// Merge short/empty sections to avoid forced structure
function buildAnalysisSections(summary, issues, assessment, nextSteps) {
  const sections = [];

  const combined = [summary, issues, assessment].filter(s => s && s.length > 40);

  if (combined.length <= 1) {
    // All content in one block
    const text = combined[0] || summary || issues || assessment || "No details available.";
    sections.push({ title: "Analysis", text });
  } else {
    if (summary)    sections.push({ title: "What We Found",      text: summary });
    if (issues)     sections.push({ title: "Issues Identified",  text: issues });
    if (assessment) sections.push({ title: "Assessment",         text: assessment });
  }

  if (nextSteps) sections.push({ title: "What To Do Next", text: nextSteps });

  return sections;
}

export function makeAnalysisRtf(analysis, name = "", email = "", triage = {}, type = "debt") {
  const title      = getBlock(analysis, "TITLE")      || "Document Analysis";
  const summary    = getBlock(analysis, "SUMMARY")    || "";
  const issues     = getBlock(analysis, "ISSUES")     || "";
  const assessment = getBlock(analysis, "ASSESSMENT") || "";
  const nextSteps  = getBlock(analysis, "NEXT_STEPS") || "";

  const amount  = formatAmount(triage);
  const risk    = riskLabel(triage.risk);
  const sender  = triage.sender || null;
  const dateStr = new Date().toLocaleDateString("en-GB");

  const summaryLines = [
    amount ? `\\b Claimed amount:\\b0   ${esc(amount)}` : null,
    `\\b Concern level:\\b0   ${esc(risk)}`,
    sender ? `\\b Sender:\\b0   ${esc(sender)}` : null,
    `\\b Action:\\b0   Request written evidence before paying`,
  ].filter(Boolean).join("\\par\n");

  const sections = buildAnalysisSections(summary, issues, assessment, nextSteps);

  const sectionsRtf = sections.map(s => `
\\fs24\\b\\cf3 ${esc(s.title)}\\b0\\cf0\\fs20\\par
\\par
${esc(s.text)}\\par
\\par`).join("\n");

  return `{\\rtf1\\ansi\\deff0
{\\fonttbl{\\f0 Arial;}{\\f1 Georgia;}}
\\paperw11906\\paperh16838\\margl1440\\margr1440\\margt1200\\margb1200
{\\colortbl;\\red0\\green0\\blue0;\\red230\\green235\\blue248;\\red28\\green52\\blue115;}

\\f1\\fs38\\b\\cf3 ${esc(title)}\\b0\\cf0\\par
\\f0\\fs18\\cf0 ${esc(name)}  \\emdash  ${esc(email)}  \\emdash  ${esc(dateStr)}\\par
\\par

\\f0\\fs20
\\pard\\shading2000\\cbpat2
\\fs22\\b CASE SUMMARY\\b0\\par
\\par
${summaryLines}\\par
\\par
\\pard
\\par

${sectionsRtf}

\\brdrb\\brdrs\\brdrw5\\brsp20 \\par
\\fs16\\i This document is for informational purposes only and does not constitute legal advice. DoIPayThat does not provide legal representation.\\i0\\par
}`;
}

export function makeLetterRtf(analysis, name = "", triage = {}, type = "debt") {
  const letter = getBlock(analysis, "DISPUTE_LETTER") || stripBlocks(analysis);

  const titleMap = {
    debt:         "Dispute Letter",
    parking:      "Appeal Letter",
    bill:         "Dispute Letter",
    subscription: "Cancellation Letter",
    quote:        "Response Letter",
  };

  const title   = titleMap[type] || "Letter";
  const dateStr = new Date().toLocaleDateString("en-GB");

  return `{\\rtf1\\ansi\\deff0
{\\fonttbl{\\f0 Arial;}{\\f1 Georgia;}}
\\paperw11906\\paperh16838\\margl1440\\margr1440\\margt1200\\margb1200
{\\colortbl;\\red0\\green0\\blue0;\\red28\\green52\\blue115;}

\\f0\\fs18\\b\\cf2 READY-TO-SEND ${esc(title.toUpperCase())}\\b0\\cf0\\par
\\fs16 Send this letter on its own. Do not include the analysis document. Keep a copy.\\par
\\par

\\f0\\fs20
[Your Name]\\par
[Your Address]\\par
[Postcode]\\par
\\par
[Company Name]\\par
[Company Address]\\par
\\par
${esc(dateStr)}\\par
\\par
${esc(letter)}\\par
\\par
Yours faithfully,\\par
\\par
\\par
${esc(name || "[Your Name]")}\\par
\\par
\\brdrb\\brdrs\\brdrw5\\brsp20 \\par
\\fs16\\i This is a draft for informational purposes only. Not legal advice.\\i0\\par
}`;
}
