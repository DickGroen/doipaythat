// worker/index.js

import { corsResponse, jsonResponse } from "./utils/response.js";
import { handleAnalyzeFree }    from "./routes/analyze-free.js";
import { handleSubmitPaid }     from "./routes/submit-paid.js";
import { handleCreateCheckout } from "./routes/create-checkout.js";
import { handleCron }           from "./routes/cron.js";
import { handleStripeWebhook }  from "./routes/webhook.js";

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return corsResponse();
    }

    const url = new URL(request.url);

    try {
      if (url.pathname === "/api/stripe-webhook" && request.method === "POST") {
        return await handleStripeWebhook(request, env);
      }

      if (url.pathname === "/api/analyze-free" && request.method === "POST") {
        return await handleAnalyzeFree(request, env);
      }

      if (url.pathname === "/api/create-checkout" && request.method === "POST") {
        return await handleCreateCheckout(request, env);
      }

      if (url.pathname === "/api/submit" && request.method === "POST") {
        return await handleSubmitPaid(request, env);
      }

      return jsonResponse({ ok: false, error: "Endpoint not found" }, 404);
    } catch (err) {
      console.error("Unhandled error:", err?.message, err?.stack);
      return jsonResponse({ ok: false, error: err?.message || "Internal server error" }, 500);
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(handleCron(env));
  }
};
