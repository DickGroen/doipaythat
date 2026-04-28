import { validateUploadInput } from "../utils/validation.js";
import { fileToBase64, safeJsonParse } from "../utils/files.js";
import { jsonResponse } from "../utils/response.js";
import { runTriage, runAnalysis } from "../services/claude.js";
import { enqueuePaid } from "../services/queue.js";
import { notifyAdminPaid } from "../services/resend.js";
import { loadPrompts } from "../config/prompts.js";

export async function handleSubmitPaid(request, env) {
  const formData = await request.formData();
  const file = formData.get("file");
  const name = String(formData.get("name") || "").trim();
  const email = String(formData.get("email") || "").trim();
  const type = String(formData.get("type") || "").trim();

  const validationError = validateUploadInput({ file, name, email, type });
  if (validationError) return jsonResponse({ ok: false, error: validationError }, 400);

  const { base64, mediaType } = await fileToBase64(file);
  const prompts = await loadPrompts(type);

  // Run triage first
  const triageRaw = await runTriage(env, {
    fileBase64: base64,
    mediaType,
    triagePrompt: prompts.triage
  });

  const triage = safeJsonParse(triageRaw) || { risk: "medium", route: "SONNET" };
  console.log("TRIAGE:", JSON.stringify(triage));

  // Run full analysis
  const analysis = await runAnalysis(env, {
    fileBase64: base64,
    mediaType,
    route: triage.route || "SONNET",
    haikusPrompt: prompts.haiku,
    sonnetPrompt: prompts.sonnet
  });

  console.log("ANALYSIS TAGS:", ["TITLE","SUMMARY","ISSUES","ASSESSMENT","NEXT_STEPS"]
    .map(t => `${t}:${analysis.includes(`[${t}]`) ? "OK" : "MISSING"}`).join(" "));

  await enqueuePaid(env, { type, name, email, triage, analysis });

  try {
    await notifyAdminPaid(env, { name, email, type, triage, analysis });
  } catch (err) {
    console.error("Admin notify failed:", err.message);
  }

  return jsonResponse({
    ok: true,
    message: "Upload successful. You'll receive your full analysis by the next business day before 4pm."
  });
}
