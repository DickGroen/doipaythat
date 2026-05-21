// worker/utils/docx.js
// DOCX generation without external dependencies.
// DOCX = ZIP containing OOXML files. We build the ZIP manually using
// a minimal implementation that works in Cloudflare Workers.

import { extractTaggedSection } from "./files.js";

// ── ZIP builder (no dependencies) ────────────────────────────────────────────

function crc32(buf) {
  const table = [];
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c;
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function uint16LE(n) { return [n & 0xff, (n >> 8) & 0xff]; }
function uint32LE(n) { return [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff]; }

function deflateRaw(data) {
  // Store method (no compression) — universally compatible
  const chunks = [];
  let offset = 0;
  while (offset < data.length) {
    const end = Math.min(offset + 65535, data.length);
    const block = data.slice(offset, end);
    const isLast = end === data.length ? 1 : 0;
    const len = block.length;
    const nlen = (~len) & 0xffff;
    chunks.push(
      isLast,
      len & 0xff, (len >> 8) & 0xff,
      nlen & 0xff, (nlen >> 8) & 0xff,
      ...block
    );
    offset = end;
  }
  // zlib header (CM=8, CINFO=7, FCHECK computed)
  const adler = adler32(data);
  const header = [0x78, 0x01];
  const trailer = [(adler >> 24) & 0xff, (adler >> 16) & 0xff, (adler >> 8) & 0xff, adler & 0xff];
  return new Uint8Array([...header, ...chunks, ...trailer]);
}

function adler32(buf) {
  let s1 = 1, s2 = 0;
  for (let i = 0; i < buf.length; i++) {
    s1 = (s1 + buf[i]) % 65521;
    s2 = (s2 + s1) % 65521;
  }
  return (s2 << 16) | s1;
}

function buildZip(files) {
  // files: [{name, data: Uint8Array}]
  const enc = new TextEncoder();
  const entries = [];
  let offset = 0;

  for (const { name, data } of files) {
    const nameBytes = enc.encode(name);
    const compressed = deflateRaw(data);
    const crc = crc32(data);

    const local = new Uint8Array([
      0x50, 0x4b, 0x03, 0x04, // signature
      0x14, 0x00,             // version needed
      0x00, 0x00,             // flags
      0x08, 0x00,             // deflate
      0x00, 0x00, 0x00, 0x00, // mod time/date
      ...uint32LE(crc),
      ...uint32LE(compressed.length),
      ...uint32LE(data.length),
      ...uint16LE(nameBytes.length),
      0x00, 0x00,             // extra length
      ...nameBytes,
      ...compressed,
    ]);

    entries.push({ nameBytes, crc, compSize: compressed.length, origSize: data.length, offset });
    offset += local.length;

    const existing = entries._bytes || [];
    entries._bytes = [...existing, ...local];
  }

  const centralDir = [];
  let centralSize = 0;
  const centralOffset = offset;

  for (const { nameBytes, crc, compSize, origSize, offset: entryOffset } of entries) {
    const cd = new Uint8Array([
      0x50, 0x4b, 0x01, 0x02,
      0x14, 0x00, 0x14, 0x00,
      0x00, 0x00,
      0x08, 0x00,
      0x00, 0x00, 0x00, 0x00,
      ...uint32LE(crc),
      ...uint32LE(compSize),
      ...uint32LE(origSize),
      ...uint16LE(nameBytes.length),
      0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00,
      ...uint32LE(entryOffset),
      ...nameBytes,
    ]);
    centralDir.push(...cd);
    centralSize += cd.length;
  }

  const eocd = new Uint8Array([
    0x50, 0x4b, 0x05, 0x06,
    0x00, 0x00, 0x00, 0x00,
    ...uint16LE(entries.length),
    ...uint16LE(entries.length),
    ...uint32LE(centralSize),
    ...uint32LE(centralOffset),
    0x00, 0x00,
  ]);

  const allBytes = entries._bytes || [];
  return new Uint8Array([...allBytes, ...centralDir, ...eocd]);
}

// ── OOXML helpers ─────────────────────────────────────────────────────────────

function xmlEsc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function para(text, opts = {}) {
  const { bold, size, spaceAfter, heading } = opts;
  const styleId = heading ? `Heading${heading}` : 'Normal';
  const rPr = [
    bold ? '<w:b/>' : '',
    size ? `<w:sz w:val="${size}"/><w:szCs w:val="${size}"/>` : '',
  ].join('');
  const pPr = [
    `<w:pStyle w:val="${styleId}"/>`,
    spaceAfter ? `<w:spacing w:after="${spaceAfter}"/>` : '',
  ].join('');

  if (!text) return `<w:p><w:pPr>${pPr}</w:pPr></w:p>`;

  return `<w:p>
    <w:pPr>${pPr}</w:pPr>
    <w:r><w:rPr>${rPr}</w:rPr><w:t xml:space="preserve">${xmlEsc(text)}</w:t></w:r>
  </w:p>`;
}

function hrPara() {
  return `<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="CCCCCC"/></w:pBdr></w:pPr></w:p>`;
}

function buildDocx(paragraphs) {
  const enc = new TextEncoder();

  const bodyXml = paragraphs.join('\n');

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:wpc="http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas"
  xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:body>
    ${bodyXml}
    <w:sectPr>
      <w:pgSz w:w="12240" w:h="15840"/>
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/>
    </w:sectPr>
  </w:body>
</w:document>`;

  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:styleId="Normal">
    <w:name w:val="Normal"/>
    <w:rPr><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading1">
    <w:name w:val="heading 1"/>
    <w:pPr><w:spacing w:after="120"/></w:pPr>
    <w:rPr><w:b/><w:sz w:val="32"/><w:szCs w:val="32"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading2">
    <w:name w:val="heading 2"/>
    <w:pPr><w:spacing w:after="80"/></w:pPr>
    <w:rPr><w:b/><w:sz w:val="26"/><w:szCs w:val="26"/></w:rPr>
  </w:style>
</w:styles>`;

  const relsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

  const appXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">
  <Application>DoIPayThat</Application>
</Properties>`;

  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`;

  const packageRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/app.xml"/>
</Relationships>`;

  return buildZip([
    { name: '[Content_Types].xml',    data: enc.encode(contentTypesXml) },
    { name: '_rels/.rels',            data: enc.encode(packageRelsXml) },
    { name: 'word/document.xml',      data: enc.encode(documentXml) },
    { name: 'word/styles.xml',        data: enc.encode(stylesXml) },
    { name: 'word/_rels/document.xml.rels', data: enc.encode(relsXml) },
    { name: 'docProps/app.xml',       data: enc.encode(appXml) },
  ]);
}

// ── Text parsing ──────────────────────────────────────────────────────────────

function parseAnalysisText(text) {
  const lines = text.split('\n');
  const paras = [];

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { paras.push(para('')); continue; }

    // Section headings in ALL CAPS or starting with [
    if (line.startsWith('[') && line.endsWith(']')) {
      // Skip XML-style tags
      continue;
    }

    // Detect heading-like lines (short, no period at end, all caps words)
    if (line.length < 60 && line === line.toUpperCase() && /[A-Z]/.test(line)) {
      paras.push(para(line, { heading: 2 }));
      continue;
    }

    // Bold label lines (ending with colon)
    if (line.endsWith(':') && line.length < 80) {
      paras.push(para(line, { bold: true, spaceAfter: 40 }));
      continue;
    }

    paras.push(para(line, { spaceAfter: 80 }));
  }

  return paras;
}

// ── Public API ────────────────────────────────────────────────────────────────

export function makeAnalysisDocx(analysis, name, email, triage, type) {
  const title = extractTaggedSection(analysis, 'TITLE') || 'Document Analysis';
  const intro = extractTaggedSection(analysis, 'INTRO') || '';

  // Remove XML tags from full text
  const cleanText = analysis
    .replace(/\[\/?\w+\]/g, '')
    .replace(/\[TITLE\][\s\S]*?\[\/TITLE\]/g, '')
    .trim();

  const date = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

  const paras = [
    para(title, { heading: 1 }),
    para(''),
    para(`Prepared for: ${name}`, { spaceAfter: 40 }),
    para(`Date: ${date}`, { spaceAfter: 40 }),
    triage?.sender ? para(`Sender: ${triage.sender}`, { spaceAfter: 40 }) : null,
    triage?.amount_claimed ? para(`Amount: £${triage.amount_claimed}`, { spaceAfter: 80 }) : null,
    para(''),
    hrPara(),
    para(''),
    ...parseAnalysisText(cleanText),
    para(''),
    hrPara(),
    para('This document is for informational purposes only and does not constitute legal advice. DoIPayThat does not provide legal representation.', { spaceAfter: 0 }),
  ].filter(Boolean);

  return buildDocx(paras);
}

export function makeLetterDocx(analysis, name, triage, type) {
  const letterTagMap = {
    debt:         'LETTER',
    parking:      'LETTER',
    bill:         'LETTER',
    subscription: 'LETTER',
    quote:        'LETTER',
  };

  const tag = letterTagMap[type] || 'LETTER';
  const letterBody = extractTaggedSection(analysis, tag) || analysis;

  const date = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

  const lines = letterBody.split('\n').map(l => l.trim()).filter(l => l);
  const paras = [
    para(`${name}`, { spaceAfter: 40 }),
    para(date, { spaceAfter: 160 }),
    para(''),
    ...lines.map(l => para(l, { spaceAfter: 120 })),
    para(''),
    hrPara(),
    para('This is a draft for informational purposes only and does not constitute legal advice.', { spaceAfter: 0 }),
  ];

  return buildDocx(paras);
}

export function docxToBase64(buffer) {
  // Convert Uint8Array to base64
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function makePlainText(analysis, name, triage) {
  const clean = analysis
    .replace(/\[\/?\w+\]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  const date = new Date().toLocaleDateString('en-GB');
  return `Document Analysis\nPrepared for: ${name}\nDate: ${date}\n\n${'─'.repeat(60)}\n\n${clean}\n\n${'─'.repeat(60)}\n\nThis document is for informational purposes only and does not constitute legal advice.`;
}
