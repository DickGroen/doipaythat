// utils/rtf.js

function rtfEscape(str = "") {
  return String(str)
    .replace(/\\/g, "\\\\")
    .replace(/{/g, "\\{")
    .replace(/}/g, "\\}")
    .replace(/\u2014/g, "\\emdash ")
    .replace(/\u2013/g, "\\endash ")
    .replace(/[^\x00-\x7F]/g, c => `\\u${c.charCodeAt(0)}?`);
}

function cleanParagraphs(text = "") {
  return String(text)
    .split(/\n\s*\n/)
    .map(p => p.trim())
    .filter(Boolean);
}

function renderParagraphs(text = "") {
  const paragraphs = cleanParagraphs(text);

  return paragraphs.map(p => `
{\\pard\\sb120\\sa140\\fs20
${rtfEscape(p)}
\\par}
`).join("\n");
}

function renderSubHeading(title = "") {
  return `
{\\pard\\sb240\\sa80\\b\\fs22
${rtfEscape(title)}
\\b0\\fs20\\par}
`;
}

function renderBulletList(items = []) {
  return items.map(item => `
{\\pard\\li420\\fi-220\\sb80\\sa80\\fs20
\\bullet\\tab ${rtfEscape(item)}
\\par}
`).join("\n");
}

export function makeAnalysisRtf(analysis, name, email, triage, type) {
  const sender = triage?.sender || "Unknown";
  const amount =
    triage?.amount_claimed ||
    triage?.fine_amount ||
    "Unknown";

  const risk = triage?.risk || "Moderate";

  const today = new Date().toLocaleDateString("en-GB");

  const sections = analysis?.sections || {};

  const whatWeFound = sections.whatWeFound || analysis?.whatWeFound || "";
  const assessment = sections.assessment || analysis?.assessment || "";

  const issues = sections.issues || analysis?.issues || [];

  const nextSteps = analysis?.nextSteps || [
    "Keep the original letter and all related documents.",
    "Do not admit liability until the claim has been verified.",
    "Request written evidence before making payment.",
    "Keep all communication in writing."
  ];

  const summaryRows = `
{\\pard\\sb20\\sa20\\fs20\\b Claimed amount:\\b0 ${rtfEscape(String(amount))}\\par}
{\\pard\\sb20\\sa20\\fs20\\b Concern level:\\b0 ${rtfEscape(risk)}\\par}
{\\pard\\sb20\\sa20\\fs20\\b Sender:\\b0 ${rtfEscape(sender)}\\par}
{\\pard\\sb20\\sa20\\fs20\\b Recommended action:\\b0 Request written evidence before paying\\par}
`;

  const renderedIssues = issues.map(issue => `
${renderSubHeading(issue.title || "Issue")}

${renderParagraphs(issue.text || "")}
`).join("\n");

  return `
{\\rtf1\\ansi\\ansicpg1252\\deff0

{\\fonttbl
{\\f0 Arial;}
}

\\viewkind4
\\uc1
\\pard

{\\pard\\sb120\\sa80\\qc\\b\\fs34
${rtfEscape(type)} claim review
\\par}

{\\pard\\sb60\\sa220\\qc\\fs20
${rtfEscape(name)} — ${rtfEscape(email)}
\\par}

{\\pard\\sb60\\sa320\\qc\\i\\fs18
${rtfEscape(type)} review – ${rtfEscape(today)}
\\par}

{\\pard\\sb160\\sa140\\b\\fs28
Case Summary
\\b0\\par}

{\\pard\\sb0\\sa0\\shading800\\cbpat2\\box\\brdrs\\brdrw8\\brsp80
${summaryRows}
\\pard\\par}

{\\pard\\sb220\\sa180\\fs19
Before taking any action, read this review carefully. Send the letter on its own — do not include this analysis.
\\par}

{\\pard\\sb320\\sa120\\b\\fs26
What We Found
\\b0\\par}

${renderParagraphs(whatWeFound)}

{\\pard\\sb320\\sa120\\b\\fs26
Issues Identified
\\b0\\par}

${renderedIssues}

{\\pard\\sb320\\sa120\\b\\fs26
Assessment
\\b0\\par}

${renderParagraphs(assessment)}

{\\pard\\sb320\\sa120\\b\\fs26
What To Do Next
\\b0\\par}

${renderBulletList(nextSteps)}

{\\pard\\sb320\\sa120\\fs18\\i
This document is for informational purposes only and does not constitute legal advice. DoIPayThat does not provide legal representation.
\\i0\\par}

}
`;
}
