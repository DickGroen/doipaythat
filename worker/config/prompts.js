// worker/config/prompts.js — doipaythat (EN)

import debtTriage          from "../../prompts/debt/triage.js";
import debtHaiku           from "../../prompts/debt/haiku.js";
import debtSonnet          from "../../prompts/debt/sonnet.js";

import parkingTriage       from "../../prompts/parking/triage.js";
import parkingHaiku        from "../../prompts/parking/haiku.js";
import parkingSonnet       from "../../prompts/parking/sonnet.js";

import billTriage          from "../../prompts/bill/triage.js";
import billHaiku           from "../../prompts/bill/haiku.js";
import billSonnet          from "../../prompts/bill/sonnet.js";

import subscriptionTriage  from "../../prompts/subscription/triage.js";
import subscriptionHaiku   from "../../prompts/subscription/haiku.js";
import subscriptionSonnet  from "../../prompts/subscription/sonnet.js";

import quoteTriage         from "../../prompts/quote/triage.js";
import quoteHaiku          from "../../prompts/quote/haiku.js";
import quoteSonnet         from "../../prompts/quote/sonnet.js";

export const PROMPTS = {
  debt: {
    triage: debtTriage,
    haiku: debtHaiku,
    sonnet: debtSonnet,
  },

  parking: {
    triage: parkingTriage,
    haiku: parkingHaiku,
    sonnet: parkingSonnet,
  },

  bill: {
    triage: billTriage,
    haiku: billHaiku,
    sonnet: billSonnet,
  },

  subscription: {
    triage: subscriptionTriage,
    haiku: subscriptionHaiku,
    sonnet: subscriptionSonnet,
  },

  quote: {
    triage: quoteTriage,
    haiku: quoteHaiku,
    sonnet: quoteSonnet,
  },
};

export function loadPrompts(type) {
  const key = String(type || "").trim().toLowerCase();
  const prompts = PROMPTS[key];

  if (!prompts) {
    throw new Error(`Unknown type: ${type}`);
  }

  return prompts;
}
