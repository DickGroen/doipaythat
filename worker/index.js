import { corsResponse, jsonResponse } from "./utils/response.js";
import { handleAnalyzeFree } from "./routes/analyze-free.js";
import { handleSubmitPaid } from "./routes/submit-paid.js";
import { handleCron } from "./routes/cron.js";
import { handleStripeWebhook } from "./services/webhook.js";

export default {
  async fetch(request, env) {
    // CORS preflight
    if (request.method === "OPTIONS") {
      return corsResponse();
    }

    const url = new URL(request.url);

    try {
      // 🔐 Stripe webhook (no JSON response!)
      if (url.pathname === "/api/stripe-webhook" && request.method === "POST") {
        return await handleStripeWebhook(request, env);
      }

      // 🧪 Free analysis
      if (url.pathname === "/api/analyze-free" && request.method === "POST") {
        return await handleAnalyzeFree(request, env);
      }

      // 💰 Paid submit
      if (url.pathname === "/api/submit" && request.method === "POST") {
        return await handleSubmitPaid(request, env);
      }

      // ❌ fallback
      return jsonResponse(
        { ok: false, error: "Endpoint not found" },
        404
      );

    } catch (err) {
      console.error("Unhandled error:", err?.message, err?.stack);

      return jsonResponse(
        {
          ok: false,
          error: err?.message || "Internal server error"
        },
        500
      );
    }
  },

  // ⏱️ Cron (queue processing)
  async scheduled(event, env, ctx) {
    ctx.waitUntil(handleCron(env));
  }
};
