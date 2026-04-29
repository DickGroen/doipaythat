import { validateUploadInput } from "../utils/validation.js";
import { fileToBase64, safeJsonParse } from "../utils/files.js";
import { jsonResponse } from "../utils/response.js";
import { runTriage, runAnalysis } from "../services/claude.js";
import { enqueuePaid } from "../services/queue.js";
import { notifyAdminPaid } from "../services/resend.js";
import { loadPrompts } from "../config/prompts.js";
import { requireType } from "../config/types.js";

export async function handleSubmitPaid(request, env) {
  const formData = await request.formData();

  const file = formData.get("file");
  const name = String(formData.get("name") || "").trim();
  const email = String(formData.get("email") || "").trim();
  const rawType = String(formData.get("type") || "").trim();
  const tier = String(formData.get("tier") || "pro").trim();

  let type;

  try {
    type = requireType(rawType);
  } catch (err) {
    return jsonResponse({ ok: false, error: err.message }, 400);
  }

  const validationError = validateUploadInput({ file, name, email, type });

  if (validationError) {
    return jsonResponse({ ok: false, error: validationError }, 400);
  }

  const { base64, mediaType } = await fileToBase64(file);
  const prompts = await loadPrompts(type);

  const triageRaw = await runTriage(env, {
    fileBase64: base64,
    mediaType,
    triagePrompt: prompts.triage
  });

  const triage = safeJsonParse(triageRaw) || {
    risk: "medium",
    route: "SONNET"
  };

  console.log("TRIAGE:", JSON.stringify(triage));

  const analysis = await runAnalysis(env, {
    fileBase64: base64,
    mediaType,
    route: triage.route || "SONNET",
    haikuPrompt: prompts.haiku,
    sonnetPrompt: prompts.sonnet
  });

  await enqueuePaid(env, {
    type,
    rawType,
    tier,
    name,
    email,
    triage,
    analysis
  });

  try {
    await notifyAdminPaid(env, {
      name,
      email,
      type,
      rawType,
      tier,
      triage,
      analysis
    });
  } catch (err) {
    console.error("Admin notify failed:", err.message);
  }

  return jsonResponse({
    ok: true,
    type,
    tier,
    message: "Upload successful. You'll receive your full analysis by the next business day before 4pm."
  });
}
