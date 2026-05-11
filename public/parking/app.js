// public/parking/app.js
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

window.openModal  = openModal;
window.closeModal = closeModal;

const TYPE     = 'parking';
const PRICE    = 19;
const CURRENCY = '£';

let freeFile   = null;
let stripeLink = null;

track('page_view', { type: TYPE });

// ── Free triage flow ──────────────────────────────────────────────────────────

window.handleGratisFileSelect = function(input) {
  if (!input.files?.[0]) return;

  freeFile = input.files[0];

  track('free_upload_started', { type: TYPE });

  const err    = validateFile(freeFile);
  const status = document.getElementById('gratis-status');

  if (err) {
    if (status) {
      status.className  = 'optie-status optie-status--error';
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
      hint.textContent  = 'Please enter a valid email address.';
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
      status.className  = 'optie-status optie-status--error';
      status.textContent = 'Please enter your name, a valid email address and select a file.';
    }
    return;
  }

  if (btn) {
    btn.disabled    = true;
    btn.textContent = 'Checking your parking fine…';
  }

  try {
    const data = await submitFree({
      file: freeFile,
      name,
      email,
      type: TYPE,
      onStatus: (kind, msg) => {
        if (!status) return;
        status.className  = `optie-status optie-status--${kind}`;
        status.textContent = msg;
      }
    });

    const triage = normalizeTriage(data.triage || {});

    // stripeLink comes from API — never hardcoded
    stripeLink =
      data.stripeLink       ||
      data.teaser?.stripeLink ||
      triage.stripeLink     ||
      null;

    track('free_triage_completed', { type: TYPE });

    renderTeaser(triage);

    if (status) {
      status.className  = 'optie-status optie-status--success';
      status.textContent = 'Your first check is ready.';
    }

    if (btn) btn.textContent = 'Done ✓';

  } catch (err) {
    if (status) {
      status.className  = 'optie-status optie-status--error';
      status.textContent = 'Error: ' + err.message;
    }

    if (btn) {
      btn.disabled    = false;
      btn.textContent = 'Start free check';
    }
  }
};

// ── Triage normalisation ──────────────────────────────────────────────────────

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
    return 'There are strong signs this fine may not be fully enforceable. Paying without checking could mean paying something you may not have needed to pay.';
  }
  if (risk === 'medium') {
    return 'There may be aspects of this fine worth checking before you pay. A review takes minutes and could save you the full amount.';
  }
  return 'Some aspects of this fine may be worth a quick check before you pay — just to be certain.';
}

// ── Teaser rendering ──────────────────────────────────────────────────────────

function renderTeaser(triage) {
  const teaser = document.getElementById('teaser');
  if (!teaser) return;

  const risk      = triage.risk || 'medium';
  const fineAmount = triage.amount_claimed || triage.fine_amount || null;
  const emailType = triage.emailType || 'strong';
  const showCta   = emailType !== 'trust' || !!stripeLink;

  teaser.style.display = 'block';
  setTimeout(() => teaser.classList.add('teaser--visible'), 10);

  track('teaser_shown', { type: TYPE, risk, amount: fineAmount });

  const riskLabel = {
    high:   '🔴 Appeal grounds likely found',
    medium: '🟠 Possible grounds worth checking',
    low:    '🟡 Worth a quick check before paying'
  };

  const title = document.getElementById('teaser-company');
  if (title) {
    title.textContent = 'Your free check is complete';
  }

  const sub = document.getElementById('teaser-sub');
  if (sub) {
    sub.textContent = `${riskLabel[risk] || riskLabel.medium}${fineAmount ? ` • Fine amount: ${CURRENCY}${esc(String(fineAmount))}` : ''}`;
  }

  const copy = document.getElementById('modal-dynamic-copy');
  if (copy) {
    copy.textContent = triage.teaser;
  }

  const financial = document.getElementById('teaser-financial');
  if (financial) {
    financial.innerHTML = fineAmount
      ? `💸 <strong>Possible unnecessary payment:</strong><br>If there are valid grounds to appeal, paying now means paying <strong>${CURRENCY}${esc(String(fineAmount))}</strong> that you may not have owed.`
      : `💸 <strong>Before you pay:</strong><br>Many parking charges are paid without checking. A review can show whether you have grounds to appeal before you hand over any money.`;
  }

  const cta = document.getElementById('teaser-cta');
  if (cta) {
    if (showCta) {
      cta.innerHTML = `
        <h3>🔍 Get the full analysis + appeal letter</h3>
        <ul>
          <li>✓ Every appeal ground reviewed</li>
          <li>✓ POFA 2012 keeper liability check</li>
          <li>✓ Ready-to-send appeal letter</li>
          <li>✓ Clear next steps if appeal is rejected</li>
        </ul>
        <button class="offer-cta" onclick="goToStripe()">
          ${ctaText(risk)}
        </button>
        <div style="margin-top:8px;font-size:.85rem;color:var(--muted);">
          One-off ${CURRENCY}${PRICE} · no subscription · secure payment
        </div>
      `;
    } else {
      // trust tier — no payment CTA
      cta.innerHTML = `
        <p style="font-size:.9rem;color:var(--ink-3);">
          Your check is complete. If you have any questions, you can reply to the email we sent you.
        </p>
      `;
    }
  }

  // Update modal Stripe link dynamically
  if (stripeLink) {
    const modalLink = document.querySelector('.js-stripe-link, .modal__cta');
    if (modalLink) modalLink.href = stripeLink;
  }

  teaser.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function ctaText(risk) {
  if (risk === 'high') return `Check now — appeal grounds found · ${CURRENCY}${PRICE} →`;
  if (risk === 'low')  return `Get full review + appeal letter · ${CURRENCY}${PRICE} →`;
  return `Full analysis + appeal letter — ${CURRENCY}${PRICE} →`;
}

// ── Stripe redirect ────────────────────────────────────────────────────────────

window.goToStripe = async function() {
  track('stripe_clicked', { type: TYPE, price: PRICE });

  const name  = document.getElementById('gratis-name')?.value.trim()  || '';
  const email = document.getElementById('gratis-email')?.value.trim() || '';

  if (!name || !email) {
    openModal('modal');
    return;
  }

  const btn = document.querySelector('.offer-cta[onclick="goToStripe()"]');
  if (btn) {
    btn.disabled    = true;
    btn.textContent = 'Redirecting to checkout…';
  }

  try {
    const res = await fetch('/api/create-checkout', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
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
      btn.disabled    = false;
      btn.textContent = ctaText('medium');
    }
    console.error('Checkout error:', err.message);
    if (stripeLink) window.location.href = stripeLink;
  }
};

// ── Paid upload fallback flow (thankyou.html) ─────────────────────────────────

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
    if (emailEl && params.get('email')) emailEl.value = params.get('email');
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
    btn.disabled    = false;
    btn.textContent = 'Upload and start analysis';
  }
}

function clearFile() {
  selectedFile = null;
  const input  = document.getElementById('real-file-input');
  if (input) input.value = '';

  document.getElementById('selected-file')?.classList.remove('show');

  const btn = document.getElementById('submit-btn');
  if (btn) {
    btn.disabled    = true;
    btn.textContent = 'Choose a file first';
  }
}

function showStatus(msg, type) {
  const box = document.getElementById('status-box');
  if (!box) return;

  box.classList.remove('hidden');
  box.className = 'status-box ' + type;
  box.innerHTML  = esc(msg);
}

async function doSubmit() {
  const name   = document.getElementById('customer-name')?.value.trim();
  const email  = document.getElementById('customer-email')?.value.trim();
  const params = new URLSearchParams(window.location.search);
  const file   = document.getElementById('real-file-input')?.files?.[0] || selectedFile;

  const emailOk = email && email.includes('@') && email.includes('.') && email.length > 5;

  if (!name || !emailOk || !file) {
    showStatus('Please fill in all fields correctly and select a file.', 'error');
    return;
  }

  const btn = document.getElementById('submit-btn');
  if (btn) {
    btn.disabled    = true;
    btn.textContent = 'Uploading…';
  }

  try {
    await submitPaid({
      file,
      name,
      email,
      type:      TYPE,
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
          <p>We will review your parking fine and send you the full analysis and appeal letter by email to <strong>${esc(email)}</strong>.</p>
          <p style="font-size:.82rem;color:var(--muted);">Please also check your spam folder.</p>
        </div>`;
    }
  } catch (err) {
    showStatus('Upload failed: ' + err.message, 'error');
    if (btn) {
      btn.disabled    = false;
      btn.textContent = 'Upload and start analysis';
    }
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function esc(str) {
  return String(str || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

// ── Init ──────────────────────────────────────────────────────────────────────

initFaq();
initModal();
initStickyFooter();
