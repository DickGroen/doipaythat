// ── Shared frontend helpers for DoIPayThat ────────────────────────────────────

const WORKER_URL = "/api";
const MAX_FILE_SIZE = 10 * 1024 * 1024; // ✅ aligned met backend
const ALLOWED_EXTENSIONS = [".pdf", ".jpg", ".jpeg", ".png"];

// ── File helpers ──────────────────────────────────────────────────────────────

export function validateFile(file) {
  if (!file) return "No file selected";

  if (file.size > MAX_FILE_SIZE) {
    return `File too large (max 10 MB, yours is ${(file.size / 1024 / 1024).toFixed(1)} MB)`;
  }

  const ext = "." + file.name.split(".").pop().toLowerCase();
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    return "File type not allowed. Use PDF, JPG or PNG.";
  }

  return null;
}

export function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

// ── Triage / free upload ──────────────────────────────────────────────────────

export async function submitFree({ file, name, email, type, onStatus }) {
  onStatus?.("info", "Checking your document...");

  const formData = new FormData();
  formData.append("file", file);
  formData.append("name", name);
  formData.append("email", email);
  formData.append("type", type);

  const res = await fetch(`${WORKER_URL}/analyze-free`, {
    method: "POST",
    body: formData
  });

  const data = await res.json();

  if (!res.ok || !data.ok) {
    throw new Error(data.error || "Check failed");
  }

  return data;
}

// ── Paid upload ───────────────────────────────────────────────────────────────

export async function submitPaid({ file, name, email, type, sessionId, onStatus }) {
  if (!sessionId) {
    throw new Error("Missing payment session. Please return from Stripe.");
  }

  onStatus?.("info", "Uploading your document securely...");

  const formData = new FormData();
  formData.append("file", file);
  formData.append("name", name);
  formData.append("email", email);
  formData.append("type", type);
  formData.append("session_id", sessionId); // ✅ verplicht

  const res = await fetch(`${WORKER_URL}/submit`, {
    method: "POST",
    body: formData
  });

  const data = await res.json();

  if (!res.ok || !data.ok) {
    throw new Error(data.error || "Upload failed");
  }

  return data;
}

// ── FAQ accordion ─────────────────────────────────────────────────────────────

export function initFaq() {
  document.querySelectorAll(".faq-q").forEach(q => {
    q.addEventListener("click", () => {
      const item = q.closest(".faq-item");
      const answer = item.querySelector(".faq-a");
      const chevron = item.querySelector(".faq-chevron");
      const isOpen = item.classList.contains("faq-item--open");

      document.querySelectorAll(".faq-item--open").forEach(open => {
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

// ── Modal (FIXED class name) ──────────────────────────────────────────────────

export function initModal() {
  document.querySelectorAll("[data-open-modal]").forEach(btn => {
    btn.addEventListener("click", () => {
      const modal = document.getElementById(btn.dataset.openModal || "modal");
      if (modal) {
        modal.classList.add("open"); // ✅ fixed
        document.body.style.overflow = "hidden";
      }
    });
  });

  document.querySelectorAll("[data-close-modal]").forEach(btn => {
    btn.addEventListener("click", () => closeModal());
  });

  document.addEventListener("keydown", e => {
    if (e.key === "Escape") closeModal();
  });
}

export function closeModal(id = "modal") {
  const modal = document.getElementById(id);
  if (modal) {
    modal.classList.remove("open"); // ✅ fixed
    document.body.style.overflow = "";
  }
}

export function openModal(id = "modal") {
  const modal = document.getElementById(id);
  if (modal) {
    modal.classList.add("open"); // ✅ fixed
    document.body.style.overflow = "hidden";
  }
}

// ── Sticky footer ─────────────────────────────────────────────────────────────

export function initStickyFooter() {
  const footer = document.getElementById("sticky-footer");
  if (!footer) return;

  let ticking = false;

  window.addEventListener(
    "scroll",
    () => {
      if (!ticking) {
        requestAnimationFrame(() => {
          const scrollY = window.scrollY;
          const nearBottom =
            scrollY + window.innerHeight >
            document.documentElement.scrollHeight - 200;

          footer.classList.toggle(
            "sticky-footer--visible",
            scrollY > 400 && !nearBottom
          );

          ticking = false;
        });

        ticking = true;
      }
    },
    { passive: true }
  );
}
