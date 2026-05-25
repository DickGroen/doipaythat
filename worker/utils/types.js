// worker/utils/types.js — doipaythat (EN)

export const TYPE_MAP = {
  debt:         "debt",
  parking:      "parking",
  bill:         "bill",
  subscription: "subscription",
  quote:        "quote",
  contract:     "contract",
  housing:      "housing",
};

export const TYPE_LANG = {
  debt:         "en",
  parking:      "en",
  bill:         "en",
  subscription: "en",
  quote:        "en",
  contract:     "en",
  housing:      "en",
};

export function normalizeType(input) {
  if (!input) return null;
  return TYPE_MAP[String(input).toLowerCase().trim()] || null;
}

export function requireType(input) {
  const type = normalizeType(input);
  if (!type) throw new Error(`Unknown type: ${input}`);
  return type;
}

export function getLang(type) {
  return TYPE_LANG[type] || "en";
}

export function isValidType(input) {
  return !!normalizeType(input);
}
