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

const TYPE     = 'quote';
const PRICE    = 29;
const CURRENCY = '£';

let freeFile   = null;
let selectedFile = null;
let stripeLink = null;

track('page_view', { type: TYPE });

// ── Free triage flow ─────────────────────────────────────────────────────────

window.handleGratisFileSelect = function(input) {
  if (!input.files?.[0]) return;

  freeFile = input.files[0];

  track('free_upload_started', { type: TYPE });

  const err    = validateFile(freeFile);
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
    zone.innerHTML = `
      <div class="upload-label" style="color:var(--green);">✓ ${esc(freeFile.name)}</div>
      <div class="upload-hint">${formatFileSize(freeFile.size)}</div>
    `;
  }

  const fields = document.getElementById('gratis-contact-fields');
  if (fields) fields.style.display = 'flex';

  checkFreeReady();
};

function checkFreeReady() {
  const name  = document.getElementById('gratis-name')?.value.trim();
  const email = document.getElementById('gratis-email')?.value.trim();
  const btn   = document.getElementById('gratis-btn');
  const hint  = document.getElementById('gratis-email-hint');

  if (!btn) return;

  const emailOk = email.includes('@') && email.includes('.');
  const ready   = !!(freeFile && name && emailOk);

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

document.getElementById('gratis-name')?.addEventListener('input', checkFreeReady);
document.getElementById('gratis-email')?.addEventListener('input', checkFreeReady);

window.startGratisUpload = async function() {
  const name   = document.getElementById('gratis-name')?.value.trim();
  const email  = document.getElementById('gratis-email')?.value.trim();
  const btn    = document.getElementById('gratis-btn');
  const status = document.getElementById('gratis-status');

  const emailOk = email && email.includes('@') && email.includes('.');

  if (!freeFile || !name || !emailOk) {
    if (status) {
      status.className = 'optie-status optie-status--error';
      status.textContent = 'Please enter your name, a valid email address and select a file.';
    }
    return;
  }

  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Checking your document…';
  }

  try {
    const data = await submitFree({
      file: freeFile,
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
      status.textContent = 'Your first check is ready.';
    }

    if (btn) {
      btn.textContent = 'Done ✓';
    }
  } catch (err) {
    if (status) {
      status.className = 'optie-status optie-status--error';
      status.textContent = 'Error: ' + err.message;
    }

    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Start free check';
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
    return 'There are strong signs this claim may not be fully correct. If you don\'t act, the situation could become significantly more expensive.';
  }

  if (risk === 'medium') {
    return 'There may be aspects in this claim worth checking. Without action, you could end up paying more than necessary.';
  }

  return 'Some details in this claim may not be fully clear. Without review, you could still risk unnecessary costs.';
}

function renderTeaser(triage) {
  const teaser = document.getElementById('teaser');
  if (!teaser) return;

  const risk   = triage.risk || 'medium';
  const amount = triage.amount_claimed || null;

  teaser.style.display = 'block';

  setTimeout(() => {
    teaser.classList.add('teaser--visible');
  }, 10);

  track('teaser_shown', {
    type: TYPE,
    risk,
    amount
  });

  teaser.innerHTML = `
    <div class="offer-card teaser-card" style="border-color:var(--green);background:#f0fdf4;max-width:620px;margin:0 auto;">
      <div style="font-size:1.1rem;font-weight:700;color:#14532d;margin-bottom:12px;">
        ✓ We've received your document.
      </div>
      <p style="color:#166534;margin-bottom:12px;line-height:1.7;">
        You'll receive your first review by email shortly — by the next working day before 4pm at the latest.
      </p>
      <div style="background:#fff;border:1px solid #bbf7d0;border-radius:8px;padding:14px;margin-bottom:14px;">
        <strong style="color:#14532d;">What happens next?</strong>
        <p style="color:#166534;margin-top:6px;margin-bottom:0;line-height:1.65;">
          We'll go through the document and let you know if there are any details worth looking at before you decide what to do.
        </p>
      </div>
      <p style="font-size:.85rem;color:#166534;">
        → Please also check your spam folder if you don't hear from us.
      </p>
      <p style="font-size:.85rem;color:#166534;margin-top:8px;">Thank you for trusting us with this.</p>
    </div>
  `;

  const modalLink = document.querySelector('.js-stripe-link, .modal__cta');
  if (modalLink && stripeLink) {
    modalLink.href = stripeLink;
  }

  teaser.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function ctaText(risk) {
  if (risk === 'high') return `Check now and avoid unnecessary costs — ${CURRENCY}${PRICE} →`;
  if (risk === 'low')  return `Get clarity with a full analysis — ${CURRENCY}${PRICE} →`;
  return `Get full analysis + response draft — ${CURRENCY}${PRICE} →`;
}

window.goToStripe = async function() {
  track('stripe_clicked', {
    type:  TYPE,
    price: PRICE
  });

  const name  = document.getElementById('gratis-name')?.value.trim()  || '';
  const email = document.getElementById('gratis-email')?.value.trim() || '';

  if (!name || !email) {
    openModal('modal');
    return;
  }

  const btn = document.querySelector('.offer-cta[onclick="goToStripe()"]');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Redirecting to checkout…';
  }

  try {
    const res = await fetch('/api/create-checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type:          TYPE,
        name,
        email,
        freeSessionId: stripeLink || '',
      }),
    });

    const data = await res.json();

    if (data.ok && data.url) {
      window.location.href = data.url;
    } else {
      throw new Error(data.error || 'Checkout failed');
    }
  } catch (err) {
    if (btn) {
      btn.disabled = false;
      btn.textContent = ctaText(TYPE);
    }
    console.error('Checkout error:', err.message);
    // Fallback to static link if available
    if (stripeLink) window.location.href = stripeLink;
  }
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

  // Hybrid B-flow: thankyou.html manages auto/fallback state.
  // app.js must not show thankyou-app itself to avoid race condition.
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
    btn.textContent = 'Upload and start analysis';
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
    showStatus('Please fill in all fields correctly and select a file.', 'error');
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
          <h2>Upload successful</h2>
          <p>We will analyse your letter and send you the full review and response draft by email to <strong>${esc(email)}</strong>.</p>
          <p style="font-size:.82rem;color:var(--muted);">Please also check your spam folder.</p>
        </div>`;
    }
  } catch (err) {
    showStatus('Upload failed: ' + err.message, 'error');

    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Upload and start analysis';
    }
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function esc(str) {
  return String(str || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

// ── Init ────────────────────────────────────────────────────────────────────

initFaq();
initModal();
initStickyFooter();
