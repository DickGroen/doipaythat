// utils/types.js
// Maps all frontend route slugs to canonical internal types.
// DE and EN types are kept separate — different legal context, different language.

export const TYPE_MAP = {
  // EN
  debt:         "debt",
  parking:      "parking",
  bill:         "bill",
  subscription: "subscription",
  quote:        "quote",

  // DE
  mahnung:      "mahnung",
  parkstrafe:   "parkstrafe",
  rechnung:     "rechnung",
  vertrag:      "vertrag",
  angebot:      "angebot",

  // NL → maps to DE prompts (same legal system, DE prompts cover NL context)
  schuld:       "mahnung",
  boete:        "parkstrafe",
  factuur:      "rechnung",
  abonnement:   "vertrag",
  offerte:      "angebot",
};

// Language derived from canonical type — used for email subjects, response language etc.
export const TYPE_LANG = {
  debt:         "en",
  parking:      "en",
  bill:         "en",
  subscription: "en",
  quote:        "en",
  mahnung:      "de",
  parkstrafe:   "de",
  rechnung:     "de",
  vertrag:      "de",
  angebot:      "de",
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
  return TYPE_LANG[type] || "de";
}
