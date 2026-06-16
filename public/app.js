// ── Shared frontend helpers for DoIPayThat ───────────────────────────────────

const WORKER_URL = "/api";
const MAX_FILE_SIZE = 8 * 1024 * 1024; // 8 MB
const ALLOWED_EXTENSIONS = [".pdf", ".jpg", ".jpeg", ".png"];

// ── Analytics ─────────────────────────────────────────────────────────────────

export function track(eventName, payload = {}) {
  const event = {
    event: eventName,
    path: window.location.pathname,
    url: window.location.href,
    referrer: document.referrer || null,
    ts: new Date().toISOString(),
    ...payload,
  };

  try {
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push(event);
  } catch (_) {}

  try {
    const body = JSON.stringify(event);

    if (navigator.sendBeacon) {
      const blob = new Blob([body], { type: "application/json" });
      navigator.sendBeacon(`${WORKER_URL}/track`, blob);
      return;
    }

    fetch(`${WORKER_URL}/track`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => {});
  } catch (_) {}
}

export const trackEvent = track;

// ── File helpers ──────────────────────────────────────────────────────────────

export function validateFile(file) {
  if (!file) return "No file selected";

  if (file.size > MAX_FILE_SIZE) {
    return `File too large (max 8 MB, yours is ${(file.size / 1024 / 1024).toFixed(1)} MB)`;
  }

  const ext = "." + file.name.split(".").pop().toLowerCase();

  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    return "File type not allowed. Use PDF, JPG or PNG.";
  }

  return null;
}

export function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ── Read file into ArrayBuffer: prevents stale File issues on iOS/Android ─────

function readFileAsArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => resolve(reader.result);
    reader.onerror = () =>
      reject(new Error("Could not read file. Please try again."));

    reader.readAsArrayBuffer(file);
  });
}

// ── Fetch with timeout ────────────────────────────────────────────────────────

async function fetchWithTimeout(url, options = {}, timeoutMs = 60000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal,
    });

    clearTimeout(timer);
    return res;
  } catch (err) {
    clearTimeout(timer);

    if (err.name === "AbortError") {
      throw new Error("Request timed out — please check your connection and try again.");
    }

    throw new Error("Network error — please check your connection and try again.");
  }
}

// ── Triage / free upload ──────────────────────────────────────────────────────

export async function submitFree({ file, name, email, type, onStatus }) {
  onStatus?.("info", "Checking your document...");

  let buffer;

  try {
    buffer = await readFileAsArrayBuffer(file);
  } catch (_) {
    throw new Error("Could not read file. Please try again.");
  }

  const blob = new Blob([buffer], {
    type: file.type || "application/octet-stream",
  });

  const formData = new FormData();
  formData.append("file", blob, file.name);
  formData.append("name", name);
  formData.append("email", email);
  formData.append("type", type);

  const res = await fetchWithTimeout(`${WORKER_URL}/analyze-free`, {
    method: "POST",
    body: formData,
  });

  let data;

  try {
    data = await res.json();
  } catch (_) {
    throw new Error("Server error — please try again.");
  }

  if (!res.ok || !data.ok) {
    throw new Error(data?.error || "Check failed");
  }

  track("upload_completed", {
    type,
    tier: data.tier || data?.triage?.tier || null,
    emailType: data.emailType || data?.triage?.emailType || null,
    fileType: file.type || null,
    fileSize: file.size || null,
  });

  return data;
}

// ── Automatic paid analysis fallback ──────────────────────────────────────────

export async function submitAutoPaid({ type, sessionId, onStatus }) {
  onStatus?.("info", "Verifying your payment...");

  const res = await fetchWithTimeout(`${WORKER_URL}/submit-auto`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type,
      session_id: sessionId,
    }),
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok || !data.ok) {
    const err = new Error(data?.error || `Error ${res.status}`);

    if (data?.need_upload || data?.needUpload || res.status === 404) {
      err.needUpload = true;
    }

    throw err;
  }

  onStatus?.("success", "Analysis started.");
  return data;
}

// ── Paid upload fallback ──────────────────────────────────────────────────────

export async function submitPaid({ file, name, email, type, sessionId, onStatus }) {
  onStatus?.("info", "Uploading your document securely...");

  let buffer;

  try {
    buffer = await readFileAsArrayBuffer(file);
  } catch (_) {
    throw new Error("Could not read file. Please try again.");
  }

  const blob = new Blob([buffer], {
    type: file.type || "application/octet-stream",
  });

  const formData = new FormData();
  formData.append("file", blob, file.name);
  formData.append("name", name);
  formData.append("email", email);
  formData.append("type", type);

  if (sessionId) {
    formData.append("session_id", sessionId);
  }

  const res = await fetchWithTimeout(`${WORKER_URL}/submit`, {
    method: "POST",
    body: formData,
  });

  let data;

  try {
    data = await res.json();
  } catch (_) {
    throw new Error("Server error — please try again.");
  }

  if (!res.ok || !data.ok) {
    throw new Error(data?.error || "Upload failed");
  }

  return data;
}

// ── FAQ accordion ─────────────────────────────────────────────────────────────

export function initFaq() {
  document.querySelectorAll(".faq-q").forEach((q) => {
    q.addEventListener("click", () => {
      const item = q.closest(".faq-item");
      if (!item) return;

      const answer = item.querySelector(".faq-a");
      const chevron = item.querySelector(".faq-chevron");
      const isOpen = item.classList.contains("faq-item--open");

      document.querySelectorAll(".faq-item--open").forEach((open) => {
        open.classList.remove("faq-item--open");

        const a = open.querySelector(".faq-a");
        const c = open.querySelector(".faq-chevron");

        if (a) a.style.maxHeight = null;
        if (c) c.style.transform = "";
      });

      if (!isOpen) {
        item.classList.add("faq-item--open");

        if (answer) answer.style.maxHeight = answer.scrollHeight + "px";
        if (chevron) chevron.style.transform = "rotate(180deg)";
      }
    });
  });
}

// ── Modal ─────────────────────────────────────────────────────────────────────

export function initModal() {
  document.querySelectorAll("[data-open-modal]").forEach((btn) => {
    btn.addEventListener("click", () => {
      openModal(btn.dataset.openModal || "modal");
    });
  });

  document.querySelectorAll("[data-close-modal]").forEach((btn) => {
    btn.addEventListener("click", () => {
      closeModal(btn.dataset.closeModal || "modal");
    });
  });

  document.querySelectorAll(".modal-overlay").forEach((modal) => {
    modal.addEventListener("click", (e) => {
      if (e.target === modal) closeModal(modal.id || "modal");
    });
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeModal();
  });
}

export function openModal(id = "modal") {
  const modal = document.getElementById(id);
  if (!modal) return;

  modal.classList.add("open");
  modal.classList.add("modal--open");
  document.body.style.overflow = "hidden";
}

export function closeModal(id = "modal") {
  const modal = document.getElementById(id);
  if (!modal) return;

  modal.classList.remove("open");
  modal.classList.remove("modal--open");
  document.body.style.overflow = "";
}

// ── Sticky footer ─────────────────────────────────────────────────────────────

export function initStickyFooter() {
  const footer = document.getElementById("sticky-footer");
  if (!footer) return;

  let ticking = false;

  window.addEventListener(
    "scroll",
    () => {
      if (ticking) return;

      ticking = true;

      requestAnimationFrame(() => {
        const scrollY = window.scrollY;
        const nearBottom =
          scrollY + window.innerHeight >
          document.documentElement.scrollHeight - 200;

        const visible = scrollY > 400 && !nearBottom;

        footer.classList.toggle("sticky-footer--visible", visible);
        footer.classList.toggle("visible", visible);

        ticking = false;
      });
    },
    { passive: true }
  );
}
