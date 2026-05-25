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

import contractTriage      from "../../prompts/contract/triage.js";
import contractHaiku       from "../../prompts/contract/haiku.js";
import contractSonnet      from "../../prompts/contract/sonnet.js";

import housingTriage       from "../../prompts/housing/triage.js";
import housingHaiku        from "../../prompts/housing/haiku.js";
import housingSonnet       from "../../prompts/housing/sonnet.js";

export const PROMPTS = {
  debt:        { triage: debtTriage,        haiku: debtHaiku,        sonnet: debtSonnet        },
  parking:     { triage: parkingTriage,     haiku: parkingHaiku,     sonnet: parkingSonnet     },
  bill:        { triage: billTriage,        haiku: billHaiku,        sonnet: billSonnet        },
  subscription:{ triage: subscriptionTriage,haiku: subscriptionHaiku,sonnet: subscriptionSonnet},
  quote:       { triage: quoteTriage,       haiku: quoteHaiku,       sonnet: quoteSonnet       },
  contract:    { triage: contractTriage,    haiku: contractHaiku,    sonnet: contractSonnet    },
  housing:     { triage: housingTriage,     haiku: housingHaiku,     sonnet: housingSonnet     },
};

export function loadPrompts(type) {
  const prompts = PROMPTS[type];
  if (!prompts) throw new Error(`Unknown type: ${type}`);
  return prompts;
}
