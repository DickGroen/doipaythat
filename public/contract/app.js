import {
  validateFile,
  formatFileSize,
  submitFree,
  submitPaid,
  initFaq,
  initModal,
  initStickyFooter,
  openModal,
  closeModal,
  track
} from '../app.js';

window.openModal = openModal;
window.closeModal = closeModal;

const TYPE  = 'contract';
const PRICE = 29;

let gratisFile   = null;
let selectedFile = null;
let stripeLink   = null;

track('page_view', { type: TYPE });

// ── Free triage flow ─────────────────────────────────────────────────────────

window.handleGratisFileSelect = function(input) {
  if (!input.files?.[0]) return;

  gratisFile = input.files[0];

  track('free_upload_started', { type: TYPE });

  const err    = validateFile(gratisFile);
  const status = document.getElementById('gratis-status');

  if (err) {
    if (status) {
      status.className = 'optie-status optie-status--error';
      status.textContent = err;
    }
    return;
  }

  const zone = document.getElementById('gratis-upload-zone');
  if (zone) {
    const label = zone.querySelector('.upload-label');
    const hint  = zone.querySelector('.upload-hint');
    if (label) {
      label.style.color = 'var(--green)';
      label.innerHTML = '✓ ' + esc(gratisFile.name);
    }
    if (hint) {
      hint.textContent = formatFileSize(gratisFile.size);
    }
  }

  input.value = '';

  const fields = document.getElementById('gratis-contact-fields');
  if (fields) fields.style.display = 'flex';

  checkGratisReady();
};

function checkGratisReady() {
  const name  = document.getElementById('gratis-name')?.value.trim();
  const email = document.getElementById('gratis-email')?.value.trim();
  const btn   = document.getElementById('gratis-btn');
  const hint  = document.getElementById('gratis-email-hint');

  if (!btn) return;

  const emailOk = email.includes('@') && email.includes('.');
  const ready   = !!(gratisFile && name && emailOk);

  btn.disabled = !ready;

  if (hint) {
    if (email.length > 3 && !emailOk) {
      hint.textContent = 'Please enter a valid email address.';
      hint.style.display = 'block';
    } else {
      hint.style.display = 'none';
    }
  }
}

['input', 'change', 'blur'].forEach((evt) => {
  document.getElementById('gratis-name')?.addEventListener(evt, checkGratisReady);
  document.getElementById('gratis-email')?.addEventListener(evt, checkGratisReady);
});

window.startGratisUpload = async function() {
  const name   = document.getElementById('gratis-name')?.value.trim();
  const email  = document.getElementById('gratis-email')?.value.trim();
  const btn    = document.getElementById('gratis-btn');
  const status = document.getElementById('gratis-status');

  if (!gratisFile || !name || !email) return;

  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Working…';
  }

  try {
    const data = await submitFree({
      file: gratisFile,
      name,
      email,
      type: TYPE,
      onStatus: (kind, msg) => {
        if (!status) return;
        status.className = `optie-status optie-status--${kind}`;
        status.textContent = msg;
      }
    });

    const triage = normalizeTriage(data.triage || {});
    stripeLink =
      data.stripeLink ||
      data.teaser?.stripeLink ||
      triage.stripeLink ||
      stripeLink;

    track('free_triage_completed', { type: TYPE });

    const freeCard = document.getElementById('free-card');
    if (freeCard) freeCard.style.display = 'none';

    renderTeaser(triage);

    if (status) {
      status.className = 'optie-status optie-status--success';
      status.textContent = 'First overview complete.';
    }

    if (typeof gtag !== 'undefined') {
      gtag('event', 'upload_complete');
    }

    if (btn) {
      btn.textContent = 'Done ✓';
    }
  } catch (err) {
    if (status) {
      status.className = 'optie-status optie-status--error';
      status.textContent = err.message || 'Upload failed. Please try again.';
    }

    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Get a free first overview';
    }
  }
};

function normalizeTriage(triage) {
  const risk = ['low', 'medium', 'high'].includes(triage.risk)
    ? triage.risk
    : 'medium';

  return {
    ...triage,
    risk,
    teaser: triage.teaser || getFallbackTeaser(risk)
  };
}

function getFallbackTeaser(risk) {
  if (risk === 'high') {
    return 'There are points in this agreement that are worth understanding before you sign, cancel or respond — particularly around notice periods or automatic renewal terms.';
  }

  if (risk === 'medium') {
    return 'There are one or more points in this agreement that may be worth clarifying before you commit or act. A fuller overview will identify what to look at.';
  }

  return 'The agreement appears relatively straightforward, though some terms may still be worth understanding before you sign, renew or cancel.';
}

function renderTeaser(triage) {
  const teaser = document.getElementById('teaser');
  if (!teaser) return;

  track('teaser_shown', {
    type: TYPE,
    risk: triage.risk || 'medium'
  });

  teaser.style.display = 'block';

  setTimeout(() => {
    teaser.classList.add('teaser--visible');
  }, 10);

  const features = [];
  features.push('Notice periods and cancellation conditions clarified');
  features.push('Automatic renewal terms explained');
  features.push('Minimum terms and exit fees identified');
  if (triage.risk === 'high' || triage.risk === 'medium') {
    features.push('Suggested response wording included');
  }

  teaser.innerHTML = `
    <div class="offer-card teaser-card" style="border-color:var(--green);background:#f0fdf4;max-width:620px;margin:0 auto;">
      <div style="font-size:1.1rem;font-weight:700;color:#14532d;margin-bottom:12px;">
        ✓ Your document has been received.
      </div>
      <p style="color:#166534;margin-bottom:12px;line-height:1.7;">
        ${esc(triage.teaser)}
      </p>
      <div style="background:#fff;border:1px solid #bbf7d0;border-radius:8px;padding:14px;margin-bottom:14px;">
        <strong style="color:#14532d;">Your first overview will include:</strong>
        <ul style="color:#166534;margin:8px 0 0;padding-left:20px;line-height:1.8;">
          ${features.map(f => `<li>${esc(f)}</li>`).join('')}
        </ul>
      </div>
      <p style="font-size:.85rem;color:#166534;">
        You will receive your overview by email — typically by the next working day before 4pm.
      </p>
      ${stripeLink ? `
        <a href="${esc(stripeLink)}" class="offer-cta" style="margin-top:14px;display:inline-block;">
          Get a further overview — £${PRICE}
        </a>
      ` : ''}
    </div>
  `;

  teaser.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

window.goToStripe = function() {
  track('stripe_clicked', {
    type:  TYPE,
    price: PRICE
  });

  if (stripeLink) {
    window.location.href = stripeLink;
    return;
  }

  openModal('modal');
};

// ── Paid upload fallback flow for thankyou.html ──────────────────────────────

if (document.getElementById('submit-btn')) {
  const fileInput = document.getElementById('real-file-input');

  fileInput?.addEventListener('change', () => {
    if (fileInput.files?.[0]) updateSelectedFile(fileInput.files[0]);
  });

  const uploadPanel = document.getElementById('upload-panel');

  uploadPanel?.addEventListener('dragover', e => {
    e.preventDefault();
    uploadPanel.classList.add('drag-over');
  });

  uploadPanel?.addEventListener('dragleave', () => {
    uploadPanel.classList.remove('drag-over');
  });

  uploadPanel?.addEventListener('drop', e => {
    e.preventDefault();
    uploadPanel.classList.remove('drag-over');

    if (e.dataTransfer.files?.[0]) {
      fileInput.files = e.dataTransfer.files;
      updateSelectedFile(e.dataTransfer.files[0]);
    }
  });

  document.getElementById('remove-file')?.addEventListener('click', e => {
    e.preventDefault();
    clearFile();
  });

  document.getElementById('submit-btn')?.addEventListener('click', doSubmit);

  validateSession();
}

function validateSession() {
  const params    = new URLSearchParams(window.location.search);
  const sessionId = params.get('session_id');
  const autoCard  = document.getElementById('auto-card');

  if (autoCard) return;

  if (sessionId?.startsWith('cs_')) {
    const app = document.getElementById('thankyou-app');
    if (app) app.style.display = 'block';

    const emailEl = document.getElementById('customer-email');
    if (emailEl && params.get('email')) {
      emailEl.value = params.get('email');
    }
  } else {
    const locked = document.getElementById('locked-screen');
    if (locked) locked.style.display = 'block';
  }
}

function updateSelectedFile(file) {
  const err = validateFile(file);

  if (err) {
    showStatus(err, 'error');
    return;
  }

  selectedFile = file;

  document.getElementById('selected-file')?.classList.add('show');

  const name = document.getElementById('selected-file-name');
  if (name) name.textContent = file.name;

  const meta = document.getElementById('selected-file-meta');
  if (meta) meta.textContent = formatFileSize(file.size) + ' · ready';

  const btn = document.getElementById('submit-btn');
  if (btn) {
    btn.disabled = false;
    btn.textContent = 'Upload and start overview';
  }
}

function clearFile() {
  selectedFile = null;

  const input = document.getElementById('real-file-input');
  if (input) input.value = '';

  document.getElementById('selected-file')?.classList.remove('show');

  const btn = document.getElementById('submit-btn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Choose a file first';
  }
}

function showStatus(msg, type) {
  const box = document.getElementById('status-box');
  if (!box) return;

  box.classList.remove('hidden');
  box.className = 'status-box ' + type;
  box.innerHTML = esc(msg);
}

async function doSubmit() {
  const name   = document.getElementById('customer-name')?.value.trim();
  const email  = document.getElementById('customer-email')?.value.trim();
  const params = new URLSearchParams(window.location.search);
  const file   = document.getElementById('real-file-input')?.files?.[0] || selectedFile;

  const emailOk =
    email &&
    email.includes('@') &&
    email.includes('.') &&
    email.length > 5;

  if (!name || !emailOk || !file) {
    showStatus('Please fill in all fields correctly.', 'error');
    return;
  }

  const btn = document.getElementById('submit-btn');

  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Uploading…';
  }

  try {
    await submitPaid({
      file,
      name,
      email,
      type: TYPE,
      sessionId: params.get('session_id'),
      onStatus:  showStatus
    });

    const fallback = document.getElementById('thankyou-app');
    if (fallback) fallback.classList.add('hidden');

    const success = document.getElementById('success-screen');
    if (success) {
      success.classList.remove('hidden');
      return;
    }

    const card = document.querySelector('.thankyou-card');
    if (card) {
      card.innerHTML = `
        <div class="success-screen">
          <div class="success-screen__icon">✓</div>
          <h2>Upload complete</h2>
          <p>We will go through your contract and send the overview and suggested response wording by email to <strong>${esc(email)}</strong> — before 4pm the next working day.</p>
          <p style="font-size:.82rem;color:var(--muted);">Please also check your spam folder.</p>
        </div>`;
    }
  } catch (err) {
    showStatus('Upload failed: ' + err.message, 'error');

    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Upload and start overview';
    }
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function esc(str) {
  return String(str || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

// ── Init ─────────────────────────────────────────────────────────────────────

// initFaq() — handled inline in HTML
initModal();
initStickyFooter();
