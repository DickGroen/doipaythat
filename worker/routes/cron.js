// worker/routes/cron.js
import { getDueEntries, deleteEntry, hasPaid } from "../services/queue.js";
import { sendFreeEmail, sendPaidEmail, sendAbandonedEmail } from "../services/resend.js";

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
        await sendPaidEmail(env, {
          name:     entry.name,
          email:    entry.email,
          type:     entry.type,
          triage:   entry.triage,
          analysis: entry.analysis,
        });

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
      console.error(`Cron: failed for ${key}:`, err.message);
    }
  }
}
