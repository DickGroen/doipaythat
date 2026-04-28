import { getDueEntries, deleteEntry } from "../services/queue.js";
import { sendFreeEmail, sendPaidEmail } from "../services/resend.js";

export async function handleCron(env) {
  console.log("Cron: checking queue...");
  const due = await getDueEntries(env);
  console.log(`Cron: ${due.length} entries due`);

  for (const { key, entry } of due) {
    try {
      if (entry.kind === "free") {
        await sendFreeEmail(env, {
          name: entry.name,
          email: entry.email,
          type: entry.type,
          triage: entry.triage,
          stripeLink: entry.stripe_link || "https://doipaythis.co.uk"
        });
      } else if (entry.kind === "paid") {
        await sendPaidEmail(env, {
          name: entry.name,
          email: entry.email,
          type: entry.type,
          triage: entry.triage,
          analysis: entry.analysis
        });
      }
      await deleteEntry(env, key);
      console.log(`Cron: sent and deleted ${key}`);
    } catch (err) {
      console.error(`Cron: failed for ${key}:`, err.message);
    }
  }
}
