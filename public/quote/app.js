const TYPE = "quote";

const STRIPE_LINKS = {
  basic: "REPLACE_WITH_STRIPE_QUOTE_BASIC_LINK",
  pro: "REPLACE_WITH_STRIPE_QUOTE_PRO_LINK",
  premium: "REPLACE_WITH_STRIPE_QUOTE_PREMIUM_LINK"
};

let selectedFile = null;
let selectedTier = "pro";

const fileInput = document.getElementById("file-input");
const uploadArea = document.getElementById("upload-area");
const freeCheckBtn = document.getElementById("free-check-btn");
const statusBox = document.getElementById("status-box");
const teaserBox = document.getElementById("teaser");
const teaserTitle = document.getElementById("teaser-title");
const teaserText = document.getElementById("teaser-text");

function showStatus(message, type = "info") {
  if (!statusBox) return;

  statusBox.textContent = message;
  statusBox.className = `status ${type}`;
}

function clearStatus() {
  if (!statusBox) return;

  statusBox.textContent = "";
  statusBox.className = "status";
}

function validateFile(file) {
  if (!file) return "Upload eerst je offerte.";

  const allowedTypes = ["application/pdf", "image/jpeg", "image/png"];
  const allowedExtension = /\.(pdf|jpg|jpeg|png)$/i.test(file.name);

  if (!allowedTypes.includes(file.type) && !allowedExtension) {
    return "Upload een PDF, JPG of PNG bestand.";
  }

  if (file.size > 10 * 1024 * 1024) {
    return "Bestand is te groot. Maximaal 10 MB.";
  }

  return null;
}

function setFile(file) {
  const error = validateFile(file);

  if (error) {
    showStatus(error, "error");
    return;
  }

  selectedFile = file;
  clearStatus();

  if (freeCheckBtn) {
    freeCheckBtn.disabled = false;
    freeCheckBtn.textContent = "Check mijn offerte gratis";
  }

  showStatus(`Geselecteerd: ${file.name}`, "success");
}

if (fileInput) {
  fileInput.addEventListener("change", () => {
    if (fileInput.files[0]) {
      setFile(fileInput.files[0]);
    }
  });
}

if (uploadArea && fileInput) {
  uploadArea.addEventListener("click", () => {
    fileInput.click();
  });

  uploadArea.addEventListener("dragover", (event) => {
    event.preventDefault();
    uploadArea.classList.add("drag-over");
  });

  uploadArea.addEventListener("dragleave", () => {
    uploadArea.classList.remove("drag-over");
  });

  uploadArea.addEventListener("drop", (event) => {
    event.preventDefault();
    uploadArea.classList.remove("drag-over");

    if (event.dataTransfer.files[0]) {
      setFile(event.dataTransfer.files[0]);
    }
  });
}

document.querySelectorAll("[data-tier]").forEach((button) => {
  button.addEventListener("click", () => {
    selectedTier = button.dataset.tier || "pro";

    document.querySelectorAll("[data-tier]").forEach((btn) => {
      btn.classList.remove("is-selected");
    });

    button.classList.add("is-selected");
  });
});

if (freeCheckBtn) {
  freeCheckBtn.addEventListener("click", async () => {
    const error = validateFile(selectedFile);

    if (error) {
      showStatus(error, "error");
      return;
    }

    freeCheckBtn.disabled = true;
    freeCheckBtn.textContent = "Analyseren…";
    showStatus("We checken je offerte. Dit duurt kort.", "info");

    try {
      const formData = new FormData();

      formData.append("file", selectedFile);
      formData.append("name", "Quote visitor");
      formData.append("email", "quote@visitor.local");
      formData.append("type", TYPE);

      const response = await fetch("/api/analyze-free", {
        method: "POST",
        body: formData
      });

      const data = await response.json();

      if (!response.ok || !data.ok) {
        throw new Error(data.error || "Analyse mislukt.");
      }

      const triage = data.triage || {};

      if (teaserBox) {
        teaserBox.classList.add("visible");
      }

      if (teaserTitle) {
        teaserTitle.textContent =
          triage.teaser ||
          triage.summary ||
          "Je offerte lijkt mogelijk hoger dan verwacht.";
      }

      if (teaserText) {
        teaserText.textContent =
          triage.estimated_overpayment
            ? `Mogelijke overbetaling: ongeveer €${triage.estimated_overpayment}.`
            : "Ontgrendel de volledige analyse om te zien waar je mogelijk te veel betaalt.";
      }

      showStatus("Gratis check klaar. Ontgrendel de volledige analyse.", "success");

      const checkoutBtn = document.getElementById("checkout-btn");
      if (checkoutBtn) {
        checkoutBtn.style.display = "block";
      }

    } catch (err) {
      showStatus(err.message || "Er ging iets mis. Probeer opnieuw.", "error");
    } finally {
      freeCheckBtn.disabled = false;
      freeCheckBtn.textContent = "Check opnieuw";
    }
  });
}

const checkoutBtn = document.getElementById("checkout-btn");

if (checkoutBtn) {
  checkoutBtn.addEventListener("click", () => {
    const link = STRIPE_LINKS[selectedTier] || STRIPE_LINKS.pro;

    if (!link || link.includes("REPLACE_WITH")) {
      showStatus("Stripe link ontbreekt voor deze optie.", "error");
      return;
    }

    window.location.href = link;
  });
}
