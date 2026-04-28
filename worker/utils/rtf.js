import { extractTaggedSection } from "./files.js";

export function rtfEscape(str) {
  return String(str || "")
    .replace(/\\/g, "\\\\").replace(/\{/g, "\\{").replace(/\}/g, "\\}")
    .replace(/\n/g, "\\par\n")
    .replace(/[^\x00-\x7F]/g, c => `\\u${c.charCodeAt(0)}?`);
}

export function rtfToBase64(rtfString) {
  const bytes = new TextEncoder().encode(rtfString);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function bulletLines(text) {
  return String(text || "").split("\n").map(l => l.trim()).filter(Boolean)
    .map(l => `{\\pard\\sb0\\sa200\\fi-300\\li300\\f1\\fs22 \\bullet  ${rtfEscape(l.replace(/^- /, ""))}\\par}`)
    .join("\n");
}

// The analysis section tag varies by type (OBJECTION / DISPUTE_LETTER / APPEAL_LETTER)
const LETTER_TAG = { debt: "DISPUTE_LETTER", parking: "APPEAL_LETTER", bill: "DISPUTE_LETTER", subscription: "CANCELLATION_LETTER" };

export function makeAnalysisRtf(analysis, customerName, customerEmail, triage, type) {
  const title = extractTaggedSection(analysis, "TITLE") || "DoIPayThis Analysis";
  const amount = triage?.amount_claimed ? `\\u163?${triage.amount_claimed}` : (triage?.fine_amount ? `\\u163?${triage.fine_amount}` : "unknown");

  return `{\\rtf1\\ansi\\deff0
{\\fonttbl{\\f0\\froman\\fcharset0 Times New Roman;}{\\f1\\fswiss\\fcharset0 Arial;}}
{\\colortbl;\\red27\\green58\\blue140;\\red153\\green26\\blue26;}
\\paperw11906\\paperh16838\\margl1800\\margr1800\\margt1440\\margb1440\\f1\\fs22
{\\pard\\sb400\\sa200\\f1\\fs32\\b\\cf1 ${rtfEscape(title)}\\par}
{\\pard\\sb0\\sa100\\f1\\fs20\\cf0 Name: ${rtfEscape(customerName || "")} (${rtfEscape(customerEmail || "")})\\par}
{\\pard\\sb0\\sa200\\f1\\fs20\\cf0 Type: ${rtfEscape(type || "")} | Amount: ${amount} | Risk: ${rtfEscape(triage?.risk || "")}\\par}
{\\pard\\sb300\\sa120\\f1\\fs24\\b Summary\\par}
{\\pard\\sa200\\f1\\fs22 ${rtfEscape(extractTaggedSection(analysis, "SUMMARY"))}\\par}
{\\pard\\sb300\\sa120\\f1\\fs24\\b Findings\\par}
${bulletLines(extractTaggedSection(analysis, "ISSUES"))}
{\\pard\\sb300\\sa120\\f1\\fs24\\b Assessment\\par}
{\\pard\\sa200\\f1\\fs22 ${rtfEscape(extractTaggedSection(analysis, "ASSESSMENT"))}\\par}
{\\pard\\sb300\\sa120\\f1\\fs24\\b Next Steps\\par}
${bulletLines(extractTaggedSection(analysis, "NEXT_STEPS"))}
{\\pard\\sb400\\sa100\\f1\\fs18\\cf0\\i Note: This is an informational analysis and not legal advice. We do not represent you. For complex cases, contact Citizens Advice or a solicitor.\\par}
}`;
}

export function makeLetterRtf(analysis, customerName, triage, type) {
  const tag = LETTER_TAG[type] || "DISPUTE_LETTER";
  const letterTitle = {
    debt: "Dispute Letter",
    parking: "Appeal Letter",
    bill: "Dispute Letter",
    subscription: "Cancellation Letter"
  }[type] || "Letter";

  return `{\\rtf1\\ansi\\deff0
{\\fonttbl{\\f0\\froman\\fcharset0 Times New Roman;}{\\f1\\fswiss\\fcharset0 Arial;}}
{\\colortbl;\\red27\\green58\\blue140;\\red153\\green26\\blue26;}
\\paperw11906\\paperh16838\\margl1800\\margr1800\\margt1440\\margb1440\\f1\\fs22
{\\pard\\sb400\\sa200\\f1\\fs28\\b\\cf2 ${rtfEscape(letterTitle)}\\par}
{\\pard\\sb0\\sa200\\f1\\fs20\\cf0 Prepared for: ${rtfEscape(customerName || "")}\\par}
{\\pard\\sb300\\sa200\\f1\\fs22\\cf0 ${rtfEscape(extractTaggedSection(analysis, tag))}\\par}
{\\pard\\sb400\\sa100\\f1\\fs18\\cf0\\i Note: This is a draft letter and not legal advice. DoIPayThis is not liable for the outcome.\\par}
}`;
}
