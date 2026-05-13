// worker/routes/cron.js

import { getDueEntries, deleteEntry, hasPaid } from "../services/queue.js";
import { runAnalysis } from "../services/claude.js";
import { loadPrompts } from "../config/prompts.js";
import {
  sendFreeEmail,
  sendPaidEmail,
  sendAbandonedEmail,
  notifyAdminPaid,
} from "../services/resend.js";

function isTier3(entry) {
  return (
    entry?.triage?.tier === "tier3" ||
    entry?.tier === "tier3" ||
    entry?.triage?.emailType === "trust" ||
    entry?.emailType === "trust"
  );
}

function getStripeLink(entry) {
  return (
    entry?.stripe_link ||
    entry?.stripeLink ||
    entry?.paymentLink ||
    null
  );
}

export async function handleCron(env) {
  console.log("Cron: checking queue...");

  let due = [];

  try {
    due = await getDueEntries(env);
  } catch (err) {
    console.error("Cron: getDueEntries FAILED:", err?.message, err?.stack);
    return;
  }

  console.log(`Cron: ${due.length} due entries found`);

  for (const { key, entry } of due) {
    try {
      console.log(
        "Cron: processing entry:",
        JSON.stringify({
          key,
          kind: entry?.kind,
          stage: entry?.stage || null,
          email: entry?.email || null,
          type: entry?.type || null,
          tier: entry?.tier || entry?.triage?.tier || null,
          send_at: entry?.send_at || null,
        })
      );

      if (!entry?.kind) {
        console.warn(`Cron: entry without kind skipped and deleted: ${key}`);
        await deleteEntry(env, key);
        continue;
      }

      if (!entry?.email) {
        console.warn(`Cron: entry without email skipped and deleted: ${key}`);
        await deleteEntry(env, key);
        continue;
      }

      // ── Free recovery emails ───────────────────────────────────────────────
      if (entry.kind === "free") {
        const alreadyPaid = await hasPaid(env, entry.email);

        if (alreadyPaid) {
          await deleteEntry(env, key);
          console.log(`Cron: free recovery skipped, already paid: ${entry.email}`);
          continue;
        }

        // Tier 3 is trust-based only: no follow-up recovery emails.
        // Stage 1 may already have been sent immediately by analyze-free.
        if (isTier3(entry) && Number(entry.stage || 1) > 1) {
          await deleteEntry(env, key);
          console.log(`Cron: tier3 recovery suppressed: ${entry.email}`);
          continue;
        }

        const stripeLink = getStripeLink(entry);

        await sendFreeEmail(env, {
          name: entry.name,
          email: entry.email,
          type: entry.type,
          rawType: entry.rawType,
          triage: entry.triage,
          stripeLink,
          stage: entry.stage || 1,
        });

        console.log(
          `Cron: free email sent: ${entry.email}, stage ${entry.stage || 1}`
        );
      }

      // ── Paid analysis emails ───────────────────────────────────────────────
      else if (entry.kind === "paid") {
        let analysis = entry.analysis || null;

        if (!analysis) {
          if (!entry.file_base64 || !entry.media_type) {
            console.error(
              `Cron: paid entry missing file_base64/media_type — cannot run analysis: ${key}`
            );

            await env.DEBT_QUEUE.put(
              `paid_failed_missing_file:${entry.email}:${Date.now()}`,
              JSON.stringify({
                key,
                type: entry.type,
                email: entry.email,
                reason: "missing_file_base64_or_media_type",
                received_at: new Date().toISOString(),
              }),
              { expirationTtl: 60 * 60 * 24 * 30 }
            );

            await deleteEntry(env, key);
            continue;
          }

          try {
            const prompts = await loadPrompts(entry.type);

            if (!prompts?.haiku || !prompts?.sonnet) {
              throw new Error(`Analysis prompts not found for type: ${entry.type}`);
            }

            analysis = await runAnalysis(env, {
              fileBase64: entry.file_base64,
              mediaType: entry.media_type,
              route: entry.triage?.route || "SONNET",
              haikuPrompt: prompts.haiku,
              sonnetPrompt: prompts.sonnet,
            });

            console.log(`Cron: analysis completed for ${entry.email}`);
          } catch (err) {
            console.error(
              `Cron: runAnalysis failed for ${entry.email}:`,
              err.message,
              err.stack
            );

            // Do not delete. Retry on next cron run.
            continue;
          }
        }

        await sendPaidEmail(env, {
          name: entry.name,
          email: entry.email,
          type: entry.type,
          rawType: entry.rawType,
          triage: entry.triage,
          analysis,
          payment: entry.payment || null,
        });

        console.log(`Cron: paid email sent: ${entry.email}`);

        try {
          await notifyAdminPaid(env, {
            name: entry.name,
            email: entry.email,
            type: entry.type,
            rawType: entry.rawType,
            triage: entry.triage,
            analysis,
            payment: entry.payment || null,
          });
        } catch (err) {
          console.error("Cron: admin paid notify failed:", err.message);
        }
      }

      // ── Abandoned checkout emails ──────────────────────────────────────────
      else if (entry.kind === "abandoned") {
        const alreadyPaid = await hasPaid(env, entry.email);

        if (alreadyPaid) {
          await deleteEntry(env, key);
          console.log(`Cron: abandoned skipped, already paid: ${entry.email}`);
          continue;
        }

        // Tier 3 should not receive abandoned/recovery pressure emails.
        if (isTier3(entry)) {
          await deleteEntry(env, key);
          console.log(`Cron: tier3 abandoned email suppressed: ${entry.email}`);
          continue;
        }

        const stripeLink = getStripeLink(entry);

        if (!stripeLink) {
          console.warn(`Cron: abandoned entry without stripe link deleted: ${key}`);
          await deleteEntry(env, key);
          continue;
        }

        await sendAbandonedEmail(env, {
          name: entry.name,
          email: entry.email,
          type: entry.type,
          rawType: entry.rawType,
          amount: entry.amount,
          stripeLink,
          stage: entry.stage || 1,
        });

        console.log(
          `Cron: abandoned email sent: ${entry.email}, stage ${entry.stage || 1}`
        );
      }

      // ── Unknown queue entry ────────────────────────────────────────────────
      else {
        console.warn(`Cron: unknown entry kind: ${entry.kind} (${key})`);
        await deleteEntry(env, key);
        continue;
      }

      await deleteEntry(env, key);
      console.log(`Cron: sent and deleted: ${key}`);
    } catch (err) {
      console.error(`Cron: failed for ${key}:`, err?.message, err?.stack);
      // Do not throw globally. Continue with the next queue entry.
    }
  }

  console.log("Cron: processing complete.");
}
