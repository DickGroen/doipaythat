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

export function makeAnalysisRtf(analysis, name = "", email = "", triage = {}, type = "debt") {
  const title = getBlock(analysis, "TITLE") || "Document Analysis";
  const summary = getBlock(analysis, "SUMMARY");
  const issues = getBlock(analysis, "ISSUES");
  const assessment = getBlock(analysis, "ASSESSMENT");
  const nextSteps = getBlock(analysis, "NEXT_STEPS");

  return `{\\rtf1\\ansi\\deff0
{\\fonttbl{\\f0 Arial;}{\\f1 Georgia;}}
\\paperw11906\\paperh16838\\margl1440\\margr1440\\margt1200\\margb1200

\\f1\\fs34\\b ${esc(title)}\\b0\\par
\\f0\\fs20\\cf0
\\par
\\b Customer:\\b0 ${esc(name)}\\par
\\b Email:\\b0 ${esc(email)}\\par
\\b Type:\\b0 ${esc(type)}\\par
\\b Date:\\b0 ${esc(new Date().toLocaleDateString("en-GB"))}\\par

\\par\\line

\\fs26\\b Summary\\b0\\fs20\\par
${esc(summary || "No summary available.")}\\par

\\par
\\fs26\\b Potential Issues\\b0\\fs20\\par
${esc(issues || "No specific issues identified.")}\\par

\\par
\\fs26\\b Assessment\\b0\\fs20\\par
${esc(assessment || "No assessment available.")}\\par

\\par
\\fs26\\b Recommended Next Steps\\b0\\fs20\\par
${esc(nextSteps || "No next steps available.")}\\par

\\par\\line
\\fs18\\i This document is an informational analysis only and is not legal advice. We do not represent you legally.\\i0\\par
}`;
}

export function makeLetterRtf(analysis, name = "", triage = {}, type = "debt") {
  const letter = getBlock(analysis, "DISPUTE_LETTER") || stripBlocks(analysis);

  const titleMap = {
    debt: "Dispute Letter",
    parking: "Appeal Letter",
    bill: "Dispute Letter",
    subscription: "Cancellation Letter"
  };

  const title = titleMap[type] || "Letter";

  return `{\\rtf1\\ansi\\deff0
{\\fonttbl{\\f0 Arial;}{\\f1 Georgia;}}
\\paperw11906\\paperh16838\\margl1440\\margr1440\\margt1200\\margb1200

\\f1\\fs32\\b ${esc(title)}\\b0\\par
\\f0\\fs20
\\par

[Your Name]\\par
[Your Address]\\par
[Postcode]\\par
\\par
[Company Name]\\par
[Company Address]\\par
\\par
${esc(new Date().toLocaleDateString("en-GB"))}\\par
\\par

\\b Re: ${esc(title)}\\b0\\par
\\b Reference:\\b0 [Reference Number]\\par

\\par
${esc(letter)}\\par

\\par
Yours faithfully,\\par
\\par
${esc(name || "[Your Name]")}\\par

\\par\\line
\\fs18\\i This letter is a draft template for informational purposes only and is not legal advice.\\i0\\par
}`;
}
