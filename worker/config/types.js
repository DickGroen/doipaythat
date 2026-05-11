// worker/config/types.js

export const ALLOWED_TYPES = ["debt", "parking", "bill", "subscription", "quote"];

export const TYPE_CONFIG = {
  debt: {
    label:    "Debt letter",
    letter:   "Dispute Letter",
    filename: "Dispute-Letter.rtf",
    price:    49,
    currency: "GBP"
  },
  parking: {
    label:    "Parking fine",
    letter:   "Appeal Letter",
    filename: "Appeal-Letter.rtf",
    price:    19,
    currency: "GBP"
  },
  bill: {
    label:    "Bill",
    letter:   "Dispute Letter",
    filename: "Dispute-Letter.rtf",
    price:    29,
    currency: "GBP"
  },
  subscription: {
    label:    "Subscription charge",
    letter:   "Cancellation Letter",
    filename: "Cancellation-Letter.rtf",
    price:    29,
    currency: "GBP"
  },
  quote: {
    label:    "Quote or estimate",
    letter:   "Response Letter",
    filename: "Response-Letter.rtf",
    price:    29,
    currency: "GBP"
  }
};

export function isAllowedType(type) {
  return ALLOWED_TYPES.includes(type);
}

export function getTypeConfig(type) {
  return TYPE_CONFIG[type] || TYPE_CONFIG.debt;
}
