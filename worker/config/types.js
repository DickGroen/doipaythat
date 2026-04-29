export const TYPE_MAP = {
  // UK / generic
  debt: "debt",
  parking: "parking",
  bill: "bill",
  subscription: "subscription",
  quote: "quote",

  // DE
  mahnung: "debt",
  parkstrafe: "parking",
  rechnung: "bill",
  vertrag: "subscription",
  angebot: "quote",

  // NL
  schuld: "debt",
  boete: "parking",
  factuur: "bill",
  abonnement: "subscription",
  offerte: "quote"
};

export function normalizeType(input) {
  if (!input) return null;

  const key = String(input).toLowerCase().trim();

  return TYPE_MAP[key] || null;
}

export function requireType(input) {
  const type = normalizeType(input);

  if (!type) {
    throw new Error(`Unknown type: ${input}`);
  }

  return type;
}
