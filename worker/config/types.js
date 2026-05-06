// worker/config/types.js

const ALLOWED_TYPES = ["debt", "parking", "bill", "subscription", "quote"];

export function requireType(raw) {
  const type = String(raw || "").trim().toLowerCase();
  if (!ALLOWED_TYPES.includes(type)) {
    throw new Error(`Unknown type: ${type}`);
  }
  return type;
}
