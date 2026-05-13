```js
// worker/config/types.js — doipaythat

export const VALID_TYPES = [
  "debt",
  "parking",
  "bill",
  "subscription",
  "quote",
];

export const TYPE_LABELS = {
  debt: "Debt collection",
  parking: "Parking notice",
  bill: "Bill dispute",
  subscription: "Subscription cancellation",
  quote: "Quote check",
};

export function requireType(type) {
  const normalized = String(type || "")
    .trim()
    .toLowerCase();

  if (!VALID_TYPES.includes(normalized)) {
    throw new Error(`Unknown type: ${normalized || "missing"}`);
  }

  return normalized;
}

export function getTypeLabel(type) {
  return TYPE_LABELS[type] || "Document";
}
```
