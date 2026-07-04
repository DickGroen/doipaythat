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

const TYPE     = 'debt';
const PRICE    = 49;
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
    freeFile = null;
    return;
  }

  if (status) {
    status.className = 'optie-status';
    status.textContent = '';
  }

  const label = document.getElementById('gratis-upload-label');
  const hint  = document.getElementById('gratis-upload-hint');

  if (label) {
    label.innerHTML = '<svg class="icon-lg"><use href="#icon-check"></use></svg> ' + esc(freeFile.name);
    label.style.color = 'var(--green)';
  }
  if (hint) {
    hint.innerHTML = formatFileSize(freeFile.size) + ' &middot; <a href="#" id="gratis-change-file" style="position:relative;z-index:2;color:var(--accent);text-decoration:underline;">Choose a different file</a>';
  }

  const changeLink = document.getElementById('gratis-change-file');
  if (changeLink) {
    changeLink.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      resetGratisUpload();
    });
  }

  const fields = document.getElementById('gratis-contact-fields');
  if (fields) fields.style.display = 'flex';

  checkFreeReady();
};

function resetGratisUpload() {
  freeFile = null;

  const input = document.getElementById('gratis-file-input');
  if (input) input.value = '';

  const label = document.getElementById('gratis-upload-label');
  const hint  = document.getElementById('gratis-upload-hint');

  if (label) {
    label.textContent = 'Choose a file or drag it here';
    label.style.color = '';
  }
  if (hint) {
    hint.textContent = 'PDF, JPG or PNG · max. 8 MB';
  }

  const fields = document.getElementById('gratis-contact-fields');
  if (fields) fields.style.display = 'none';

  const status = document.getElementById('gratis-status');
  if (status) {
    status.className = 'optie-status';
    status.textContent = '';
  }

  checkFreeReady();
}
window.resetGratisUpload = resetGratisUpload;

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

// Note: gratis-file-input has NO inline onchange attribute and no addEventListener
// bound here. The single 'change' listener lives in the inline <script> at the
// bottom of the page's HTML (installUploadFix()), which calls
// window._gratisFileSafety() → window.handleGratisFileSelect() exactly once per
// selection. Do not add a second listener here or an inline onchange in the HTML —
// either would reintroduce the double-fire bug this comment used to describe.

['input', 'change', 'blur'].forEach(evt => {
  document.getElementById('gratis-name')?.addEventListener(evt, checkFreeReady);
  document.getElementById('gratis-email')?.addEventListener(evt, checkFreeReady);
});

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

    renderTeaser(triage);

    if (status) {
      status.className = 'optie-status optie-status--success';
      status.textContent = 'Your first check is ready.';
    }

    if (btn) {
      btn.innerHTML = '<svg class="icon"><use href="#icon-check"></use></svg> Done';
    }
  } catch (err) {
    if (status) {
      status.className = 'optie-status optie-status--error';
      status.textContent = 'Error: ' + err.message;
    }

    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Get my free overview';
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
    return 'Several parts of this letter may be worth clarifying before you respond — a closer review can set out exactly which ones.';
  }

  if (risk === 'medium') {
    return 'Some parts of this letter may be worth confirming before you decide how to respond.';
  }

  return 'The letter appears relatively standard, though a fuller review can confirm the details before you respond.';
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
      <div style="font-size:1.1rem;font-weight:700;color:#14532d;margin-bottom:12px;display:flex;align-items:center;gap:8px;">
        <svg class="icon-lg"><use href="#icon-check"></use></svg> We've received your document.
      </div>
      <p style="color:#166534;margin-bottom:12px;line-height:1.7;">
        We'll review it carefully and send your first check by email by the next working day before 4pm.
      </p>
      <div style="background:#fff;border:1px solid #bbf7d0;border-radius:8px;padding:14px;margin-bottom:14px;">
        <strong style="color:#14532d;">Why this matters:</strong>
        <p style="color:#166534;margin-top:6px;margin-bottom:0;line-height:1.65;">
          Our review helps you understand what to check before paying. Many people only realise they could have questioned the claim after they've already paid.
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

function ctaText() {
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
      btn.textContent = ctaText();
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
          <div class="success-screen__icon"><svg class="icon-lg"><use href="#icon-check"></use></svg></div>
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

// initFaq() — handled inline in HTML
initModal();
initStickyFooter();
