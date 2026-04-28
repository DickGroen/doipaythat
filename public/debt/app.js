import { validateFile, formatFileSize, submitFree, submitPaid, initFaq, initModal, initStickyFooter, openModal } from '../app.js';

const TYPE = 'debt';
let selectedFile = null;
let gratisFile = null;

// ── Gratis flow ───────────────────────────────────────────────────────────────

window.handleGratisFileSelect = function(input) {
  if (!input.files?.[0]) return;
  gratisFile = input.files[0];
  const err = validateFile(gratisFile);
  if (err) { document.getElementById('gratis-status').className = 'optie-status optie-status--error'; document.getElementById('gratis-status').textContent = err; return; }
  const zone = document.getElementById('gratis-upload-zone');
  zone.innerHTML = `<div class="upload-label" style="color:var(--green);">&#10003; ${esc(gratisFile.name)}</div><div class="upload-hint">${formatFileSize(gratisFile.size)}</div>`;
  document.getElementById('gratis-contact-fields').style.display = 'flex';
  checkGratisReady();
};

function checkGratisReady() {
  const name = document.getElementById('gratis-name').value.trim();
  const email = document.getElementById('gratis-email').value.trim();
  document.getElementById('gratis-btn').disabled = !(name && email.includes('@') && email.includes('.') && gratisFile);
}

document.getElementById('gratis-name').addEventListener('input', checkGratisReady);
document.getElementById('gratis-email').addEventListener('input', checkGratisReady);

window.startGratisUpload = async function() {
  const name = document.getElementById('gratis-name').value.trim();
  const email = document.getElementById('gratis-email').value.trim();
  const btn = document.getElementById('gratis-btn');
  const status = document.getElementById('gratis-status');
  if (!gratisFile) return;

  btn.disabled = true;
  btn.textContent = 'Sending...';

  try {
    const data = await submitFree({
      file: gratisFile, name, email, type: TYPE,
      onStatus: (type, msg) => { status.className = `optie-status optie-status--${type}`; status.textContent = msg; }
    });

    // Show teaser with triage result
    showTeaser(data.triage);
    status.className = 'optie-status optie-status--success';
    status.textContent = "Done! Your assessment will arrive by the next business day before 4pm.";
    btn.textContent = 'Sent \u2713';
  } catch (err) {
    status.className = 'optie-status optie-status--error';
    status.textContent = 'Error: ' + err.message;
    btn.disabled = false;
    btn.textContent = 'Check before I pay — free';
  }
};

// ── Teaser ────────────────────────────────────────────────────────────────────

function showTeaser(triage) {
  const teaser = document.getElementById('teaser');
  if (!teaser || !triage) return;
  teaser.style.display = 'block';
  setTimeout(() => teaser.classList.add('teaser--visible'), 10);

  const amount = triage.amount_claimed ? `\u00A3${triage.amount_claimed}` : null;
  const sender = triage.sender;
  const risk = triage.risk || 'medium';

  document.getElementById('teaser-company').textContent =
    amount ? `We\u2019ve identified potential challenge scenarios for your \u00A3${triage.amount_claimed} debt`
           : sender ? `We\u2019ve identified potential challenge scenarios for your ${sender} letter`
           : 'We\u2019ve identified potential challenge scenarios';

  const riskMsg = { high: '🔴 Significant issues identified — full analysis recommended.', medium: '🟠 Possible grounds to challenge — a full check will confirm.', low: '🟡 Appears straightforward — but a check may reveal options.' };
  document.getElementById('teaser-sub').textContent = riskMsg[risk] || '';

  document.getElementById('modal-dynamic-copy').textContent =
    `We\u2019ve identified potential challenge scenarios${amount ? ` for your \u00A3${triage.amount_claimed} debt` : ''} \u2014 don\u2019t pay yet. Full analysis follows after payment.`;

  teaser.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// ── Paid upload (bedankt.html) ────────────────────────────────────────────────

if (document.getElementById('submit-btn')) {
  const fileInput = document.getElementById('real-file-input');
  const selectedFileBox = document.getElementById('selected-file');

  fileInput?.addEventListener('change', () => {
    if (fileInput.files?.[0]) updateSelectedFile(fileInput.files[0]);
  });

  const uploadPanel = document.getElementById('upload-panel');
  uploadPanel?.addEventListener('dragover', e => { e.preventDefault(); uploadPanel.classList.add('drag-over'); });
  uploadPanel?.addEventListener('dragleave', () => uploadPanel.classList.remove('drag-over'));
  uploadPanel?.addEventListener('drop', e => {
    e.preventDefault(); uploadPanel.classList.remove('drag-over');
    if (e.dataTransfer.files?.[0]) { fileInput.files = e.dataTransfer.files; updateSelectedFile(e.dataTransfer.files[0]); }
  });

  document.getElementById('remove-file')?.addEventListener('click', e => { e.preventDefault(); clearFile(); });
  document.getElementById('submit-btn')?.addEventListener('click', doSubmit);

  validateSession();
}

function validateSession() {
  const params = new URLSearchParams(window.location.search);
  const sessionId = params.get('session_id');
  if (sessionId?.startsWith('cs_')) {
    document.getElementById('thankyou-app').style.display = 'block';
    const emailEl = document.getElementById('customer-email');
    if (emailEl && params.get('email')) emailEl.value = params.get('email');
  } else {
    document.getElementById('locked-screen').style.display = 'block';
  }
}

function updateSelectedFile(file) {
  const err = validateFile(file);
  if (err) { showStatus(err, 'error'); return; }
  selectedFile = file;
  document.getElementById('selected-file').classList.add('show');
  document.getElementById('selected-file-name').textContent = file.name;
  document.getElementById('selected-file-meta').textContent = formatFileSize(file.size) + ' \xB7 ready';
  document.getElementById('submit-btn').disabled = false;
  document.getElementById('submit-btn').textContent = 'Upload and get my analysis';
}

function clearFile() {
  selectedFile = null;
  document.getElementById('real-file-input').value = '';
  document.getElementById('selected-file').classList.remove('show');
  document.getElementById('submit-btn').disabled = true;
  document.getElementById('submit-btn').textContent = 'Choose a file first';
}

function showStatus(msg, type) {
  const box = document.getElementById('status-box');
  box.className = 'status-box ' + type;
  box.innerHTML = msg;
}

async function doSubmit() {
  const name = document.getElementById('customer-name').value.trim();
  const email = document.getElementById('customer-email').value.trim();
  const params = new URLSearchParams(window.location.search);
  const file = document.getElementById('real-file-input').files[0] || selectedFile;

  if (!name || !email.includes('@') || !file) { showStatus('Please fill in all fields and choose a file.', 'error'); return; }

  document.getElementById('submit-btn').disabled = true;
  document.getElementById('submit-btn').textContent = 'Uploading...';

  try {
    await submitPaid({
      file, name, email, type: TYPE,
      sessionId: params.get('session_id'),
      onStatus: showStatus
    });
    document.querySelector('.thankyou-card').innerHTML = `
      <div class="success-screen">
        <div class="success-screen__icon">&#10003;</div>
        <h2>Upload successful!</h2>
        <p>We\u2019ll analyse your document and send your full analysis and draft dispute letter to <strong>${esc(email)}</strong> within 24 hours.</p>
        <p style="font-size:0.82rem;color:var(--muted);">Check your spam folder too.</p>
      </div>`;
  } catch (err) {
    showStatus('Upload failed: ' + err.message + '. Please try again or email support@doipaythis.co.uk', 'error');
    document.getElementById('submit-btn').disabled = false;
    document.getElementById('submit-btn').textContent = 'Upload and get my analysis';
  }
}

function esc(str) { return String(str||'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;'); }

// ── Init ──────────────────────────────────────────────────────────────────────

initFaq();
initModal();
initStickyFooter();

// Delay free card 4 seconds
setTimeout(() => {
  const card = document.getElementById('free-card');
  if (card) { card.style.opacity = '0.85'; card.style.pointerEvents = 'auto'; }
}, 4000);
