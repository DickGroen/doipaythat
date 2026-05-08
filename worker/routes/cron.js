// worker/routes/cron.js

import { getDueEntries, deleteEntry, hasPaid } from "../services/queue.js";
import { sendFreeEmail, sendPaidEmail, sendAbandonedEmail, notifyAdminPaid } from "../services/resend.js";
import { runAnalysis } from "../services/claude.js";
import { loadPrompts } from "../config/prompts.js";

export async function handleCron(env) {
  console.log("Cron: checking queue...");
  const due = await getDueEntries(env);
  console.log(`Cron: ${due.length} entries due`);

  for (const { key, entry } of due) {
    try {
      if (entry.kind === "free") {
        const alreadyPaid = await hasPaid(env, entry.email);
        if (alreadyPaid) {
          await deleteEntry(env, key);
          console.log(`Cron: recovery skipped, already paid: ${entry.email}`);
          continue;
        }

        await sendFreeEmail(env, {
          name:       entry.name,
          email:      entry.email,
          type:       entry.type,
          triage:     entry.triage,
          stripeLink: entry.stripe_link || "https://doipaythat.co.uk",
          stage:      entry.stage || 1,
        });

      } else if (entry.kind === "paid") {
        // If analysis is missing, run it now
        let analysis = entry.analysis;

        if (!analysis && entry.file_base64 && entry.media_type) {
          console.log(`Cron: running analysis for paid entry: ${entry.email}`);
          try {
            const prompts = await loadPrompts(entry.type);
            analysis = await runAnalysis(env, {
              fileBase64:   entry.file_base64,
              mediaType:    entry.media_type,
              route:        entry.triage?.route || "SONNET",
              haikuPrompt:  prompts.haiku,
              sonnetPrompt: prompts.sonnet,
            });
          } catch (err) {
            console.error(`Cron: analysis failed for ${entry.email}:`, err.message);
            throw err; // retry on next cron run
          }
        }

        await sendPaidEmail(env, {
          name:     entry.name,
          email:    entry.email,
          type:     entry.type,
          triage:   entry.triage,
          analysis: analysis || "",
        });

        try {
          await notifyAdminPaid(env, {
            name:     entry.name,
            email:    entry.email,
            type:     entry.type,
            triage:   entry.triage,
            analysis: analysis || "",
          });
        } catch (err) {
          console.error(`Cron: admin notify failed:`, err.message);
        }

      } else if (entry.kind === "abandoned") {
        const alreadyPaid = await hasPaid(env, entry.email);
        if (alreadyPaid) {
          await deleteEntry(env, key);
          console.log(`Cron: abandoned skipped, already paid: ${entry.email}`);
          continue;
        }

        await sendAbandonedEmail(env, {
          name:       entry.name,
          email:      entry.email,
          type:       entry.type,
          amount:     entry.amount,
          stripeLink: entry.stripe_link,
          stage:      entry.stage || 1,
        });

      } else {
        console.warn(`Cron: unknown entry kind: ${entry.kind} (${key})`);
      }

      await deleteEntry(env, key);
      console.log(`Cron: sent and deleted ${key}`);
    } catch (err) {
      console.error(`Cron: failed for ${key}:`, err.message, err.stack);
      // Do NOT delete entry on error — retry on next cron run
      throw err;
    }
  }
}
