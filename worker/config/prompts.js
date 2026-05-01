// config/prompts.js
// Loads prompt sets per canonical type.
// DE and EN are kept separate — different legal context, different prompt language.

// ── EN prompts ────────────────────────────────────────────────────────────────

import debtTriage        from "../../prompts/debt/triage.js";
import debtHaiku         from "../../prompts/debt/haiku.js";
import debtSonnet        from "../../prompts/debt/sonnet.js";

import parkingTriage     from "../../prompts/parking/triage.js";
import parkingHaiku      from "../../prompts/parking/haiku.js";
import parkingSonnet     from "../../prompts/parking/sonnet.js";

import billTriage        from "../../prompts/bill/triage.js";
import billHaiku         from "../../prompts/bill/haiku.js";
import billSonnet        from "../../prompts/bill/sonnet.js";

import subscriptionTriage  from "../../prompts/subscription/triage.js";
import subscriptionHaiku   from "../../prompts/subscription/haiku.js";
import subscriptionSonnet  from "../../prompts/subscription/sonnet.js";

import quoteTriage       from "../../prompts/quote/triage.js";
import quoteHaiku        from "../../prompts/quote/haiku.js";
import quoteSonnet       from "../../prompts/quote/sonnet.js";

// ── DE prompts ────────────────────────────────────────────────────────────────

import mahnungTriage     from "../../prompts/mahnung/triage.js";
import mahnungHaiku      from "../../prompts/mahnung/haiku.js";
import mahnungSonnet     from "../../prompts/mahnung/sonnet.js";

import parkstrafeTriage  from "../../prompts/parkstrafe/triage.js";
import parkstrafeHaiku   from "../../prompts/parkstrafe/haiku.js";
import parkstrafeSonnet  from "../../prompts/parkstrafe/sonnet.js";

import rechnungTriage    from "../../prompts/rechnung/triage.js";
import rechnungHaiku     from "../../prompts/rechnung/haiku.js";
import rechnungSonnet    from "../../prompts/rechnung/sonnet.js";

import vertragTriage     from "../../prompts/vertrag/triage.js";
import vertragHaiku      from "../../prompts/vertrag/haiku.js";
import vertragSonnet     from "../../prompts/vertrag/sonnet.js";

import angebotTriage     from "../../prompts/angebot/triage.js";
import angebotHaiku      from "../../prompts/angebot/haiku.js";
import angebotSonnet     from "../../prompts/angebot/sonnet.js";

// ── Prompt map ────────────────────────────────────────────────────────────────

export const PROMPTS = {
  // EN
  debt:         { triage: debtTriage,         haiku: debtHaiku,         sonnet: debtSonnet         },
  parking:      { triage: parkingTriage,       haiku: parkingHaiku,      sonnet: parkingSonnet      },
  bill:         { triage: billTriage,          haiku: billHaiku,         sonnet: billSonnet         },
  subscription: { triage: subscriptionTriage,  haiku: subscriptionHaiku, sonnet: subscriptionSonnet },
  quote:        { triage: quoteTriage,         haiku: quoteHaiku,        sonnet: quoteSonnet        },

  // DE
  mahnung:      { triage: mahnungTriage,       haiku: mahnungHaiku,      sonnet: mahnungSonnet      },
  parkstrafe:   { triage: parkstrafeTriage,    haiku: parkstrafeHaiku,   sonnet: parkstrafeSonnet   },
  rechnung:     { triage: rechnungTriage,      haiku: rechnungHaiku,     sonnet: rechnungSonnet     },
  vertrag:      { triage: vertragTriage,       haiku: vertragHaiku,      sonnet: vertragSonnet      },
  angebot:      { triage: angebotTriage,       haiku: angebotHaiku,      sonnet: angebotSonnet      },
};

// ── Loader ────────────────────────────────────────────────────────────────────

export function loadPrompts(type) {
  const prompts = PROMPTS[type];
  if (!prompts) throw new Error(`Unknown type: ${type}`);
  return prompts;
}
