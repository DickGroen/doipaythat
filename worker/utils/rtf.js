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

// Merge short/empty sections — avoid forced structure
function buildSections(summary, issues, assessment, nextSteps) {
  const body = [summary, issues, assessment].filter(s => s && s.length > 40);
  const sections = [];

  if (body.length <= 1) {
    const text = body[0] || summary || issues || assessment || "No details available.";
    sections.push({ title: "Analysis", text });
  } else {
    if (summary)    sections.push({ title: "What We Found",     text: summary });
    if (issues)     sections.push({ title: "Issues Identified", text: issues });
    if (assessment) sections.push({ title: "Assessment",        text: assessment });
  }

  if (nextSteps) sections.push({ title: "What To Do Next", text: nextSteps });

  return sections;
}

// ── Analysis RTF ─────────────────────────────────────────────────────────────

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

  // Case summary rows
  const summaryRows = [
    amount ? `{\\pard\\sb0\\sa80\\fi-2400\\li2400\\f1\\fs20 \\b Claimed amount:\\b0   ${esc(amount)}\\par}` : null,
    `{\\pard\\sb0\\sa80\\fi-2400\\li2400\\f1\\fs20 \\b Concern level:\\b0   ${esc(risk)}\\par}`,
    sender ? `{\\pard\\sb0\\sa80\\fi-2400\\li2400\\f1\\fs20 \\b Sender:\\b0   ${esc(sender)}\\par}` : null,
    `{\\pard\\sb0\\sa80\\fi-2400\\li2400\\f1\\fs20 \\b Recommended action:\\b0   Request written evidence before paying\\par}`,
  ].filter(Boolean).join("\n");

  // Body sections
  const sections = buildSections(summary, issues, assessment, nextSteps);

  const sectionsRtf = sections.map(s =>
    `{\\pard\\sb300\\sa120\\f1\\fs24\\b ${esc(s.title)}\\par}\n` +
    `{\\pard\\sa200\\f1\\fs22 ${esc(s.text)}\\par}`
  ).join("\n");

  return `{\\rtf1\\ansi\\deff0
{\\fonttbl{\\f0\\froman\\fcharset0 Times New Roman;}{\\f1\\fswiss\\fcharset0 Arial;}}
{\\colortbl;\\red27\\green58\\blue140;\\red153\\green26\\blue26;\\red34\\green139\\blue34;\\red200\\green160\\blue0;}
\\paperw11906\\paperh16838\\margl1800\\margr1800\\margt1440\\margb1440\\f1\\fs22

{\\pard\\sb400\\sa200\\f1\\fs32\\b\\cf1 ${esc(title)}\\par}
{\\pard\\sb0\\sa100\\f1\\fs20\\cf0 ${esc(name)} (${esc(email)})\\par}
{\\pard\\sb0\\sa200\\f1\\fs20\\cf0 Type: ${esc(type)} | Date: ${esc(dateStr)}\\par}

{\\pard\\sb300\\sa120\\f1\\fs24\\b\\cf1 Case Summary\\b0\\cf0\\par}
${summaryRows}

{\\pard\\sb300\\sa80\\f1\\fs20\\cf4\\i Before taking any action, read this review carefully. Send the letter on its own \\emdash  do not include this analysis.\\i0\\cf0\\par}

${sectionsRtf}

{\\pard\\sb400\\sa0\\brdrb\\brdrs\\brdrw5\\brsp60\\f1\\fs18\\cf0\\par}
{\\pard\\sb80\\sa0\\f1\\fs16\\i This document is for informational purposes only and does not constitute legal advice. DoIPayThat does not provide legal representation.\\i0\\par}
}`;
}

// ── Letter RTF ───────────────────────────────────────────────────────────────

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
  const sender  = triage.sender || null;
  const dateStr = new Date().toLocaleDateString("en-GB");

  return `{\\rtf1\\ansi\\deff0
{\\fonttbl{\\f0\\froman\\fcharset0 Times New Roman;}{\\f1\\fswiss\\fcharset0 Arial;}}
{\\colortbl;\\red27\\green58\\blue140;\\red153\\green26\\blue26;\\red34\\green139\\blue34;\\red200\\green160\\blue0;}
\\paperw11906\\paperh16838\\margl1800\\margr1800\\margt1440\\margb1440\\f1\\fs22

{\\pard\\sb400\\sa200\\f1\\fs28\\b\\cf2 ${esc(title)}\\par}
{\\pard\\sb0\\sa80\\f1\\fs20\\cf0 Prepared for: ${esc(name)}${sender ? ` | Sender: ${esc(sender)}` : ""}\\par}
{\\pard\\sb0\\sa300\\f1\\fs20\\cf4\\i Fill in your personal details where shown, check the letter before sending, and send it on its own without this document.\\i0\\par}

{\\pard\\sb300\\sa200\\f1\\fs22\\cf0
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
[Your address]\\par
[Date]\\par}

{\\pard\\sb400\\sa0\\brdrb\\brdrs\\brdrw5\\brsp60\\f1\\fs18\\cf0\\par}
{\\pard\\sb80\\sa0\\f1\\fs16\\i This is a draft for informational purposes only. Not legal advice.\\i0\\par}
}`;
}
