// worker/utils/files.js

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

const ALLOWED_MEDIA_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

function normalizeMediaType(type = "") {
  const mediaType = String(type || "").trim().toLowerCase();

  if (ALLOWED_MEDIA_TYPES.has(mediaType)) {
    return mediaType;
  }

  return "application/pdf";
}

function stripMarkdownFences(value = "") {
  return String(value)
    .replace(/^```(?:json|javascript|js)?\s*/i, "")
    .replace(/```$/i, "")
    .trim();
}

function removeBom(value = "") {
  return String(value).replace(/^\uFEFF/, "").trim();
}

function extractFirstJsonObject(value = "") {
  const text = String(value || "");
  const start = text.indexOf("{");

  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escapeNext = false;

  for (let i = start; i < text.length; i++) {
    const char = text[i];

    if (escapeNext) {
      escapeNext = false;
      continue;
    }

    if (char === "\\") {
      escapeNext = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (char === "{") depth++;
    if (char === "}") depth--;

    if (depth === 0) {
      return text.slice(start, i + 1);
    }
  }

  return null;
}

export async function fileToBase64(file) {
  if (!file || typeof file.arrayBuffer !== "function") {
    throw new Error("Invalid file upload");
  }

  if (typeof file.size === "number" && file.size <= 0) {
    throw new Error("Uploaded file is empty");
  }

  if (typeof file.size === "number" && file.size > MAX_FILE_SIZE_BYTES) {
    throw new Error("Uploaded file is too large");
  }

  const mediaType = normalizeMediaType(file.type);
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);

  if (!bytes.byteLength) {
    throw new Error("Uploaded file is empty");
  }

  let binary = "";
  const chunkSize = 0x8000;

  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(
      null,
      bytes.subarray(i, i + chunkSize)
    );
  }

  return {
    base64: btoa(binary),
    mediaType,
  };
}

export function safeJsonParse(input) {
  if (input === null || input === undefined) return null;

  const cleaned = removeBom(stripMarkdownFences(input));

  try {
    return JSON.parse(cleaned);
  } catch {
    // continue
  }

  try {
    const json = extractFirstJsonObject(cleaned);
    return json ? JSON.parse(json) : null;
  } catch {
    return null;
  }
}

export function extractTaggedSection(text, tag) {
  const safeTag = String(tag || "").trim();

  if (!safeTag) return "";

  const regex = new RegExp(
    `\\[${safeTag}\\]([\\s\\S]*?)\\[\\/${safeTag}\\]`,
    "i"
  );

  const match = String(text || "").match(regex);

  return match ? match[1].trim() : "";
}

export function extractFirstTaggedSection(text, tags = []) {
  for (const tag of tags) {
    const found = extractTaggedSection(text, tag);
    if (found) return found;
  }

  return "";
}

export function stripTags(text = "") {
  return String(text || "")
    .replace(/\[\/?[A-Z_ ]+\]/gi, "")
    .trim();
}

export function escapeHtml(str) {
  return String(str || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
