// public/js/sender.js

import { api } from "./api.js";
import { $, pretty } from "./utils.js";
import { alertSuccess, alertError } from "./components/alerts.js";
import { getFormData } from "./components/forms.js";
import { statusPill, timeline, nextActionText } from "./components/status.js";

export function initSenderPage() {
  console.log("Sender page loaded");

  setupRegistration();
  enforceSenderGate();
  setupSenderAuthControls();
  setupCreateRequest();
  setupViewRequest();
  setupAcceptOffer();
  setupFundEscrow();
  setupReleaseEscrow();
  setupIssueReport_sender();
}


// Store sender tokens per request (pilot convenience).
function saveSenderTokenForRequest(requestId, token) {
  if (!requestId || !token) return;
  try {
    const key = 'dm_sender_tokens';
    const obj = JSON.parse(localStorage.getItem(key) || '{}');
    obj[String(requestId)] = String(token);
    localStorage.setItem(key, JSON.stringify(obj));
    // Also set as current sender token for API calls
    sessionStorage.setItem('dm_sender_token', String(token));
  } catch (_) {
    // Fallback: at least set session token
    sessionStorage.setItem('dm_sender_token', String(token));
  }
}

function loadSenderTokenForRequest(requestId) {
  if (!requestId) return '';
  try {
    const obj = JSON.parse(localStorage.getItem('dm_sender_tokens') || '{}');
    return obj[String(requestId)] || '';
  } catch (_) {
    return '';
  }
}

function markSenderRegistered(user) {
  localStorage.setItem('dm_sender_registered', '1');
  if (user) { localStorage.setItem('dm_user', JSON.stringify(user)); sessionStorage.setItem('dm_user', JSON.stringify(user)); }
}

function isSenderRegistered() {
  return localStorage.getItem('dm_sender_registered') === '1';
}

function enforceSenderGate() {
  const status = document.getElementById('senderAuthStatus');
  const locked = !isSenderRegistered();

  // Apply a CSS gate to hide non-essential sections until registration completes.
  document.body.classList.toggle('locked', locked);
  document.body.classList.toggle('unlocked', !locked);

  if (status) {
    if (locked) {
      status.textContent = 'Pilot: please register first to enable request creation and offer acceptance on this device.';
    } else {
      let phone = '';
      try { phone = (JSON.parse((sessionStorage.getItem('dm_user') || localStorage.getItem('dm_user') || 'null')) || {}).phone || ''; } catch(_) {}
      status.textContent = phone ? `Registered: ${phone}` : 'Registered';
    }
  }
}

/* ---------------------------------------------------------
   1. Sender Registration
--------------------------------------------------------- */
function setupRegistration() {
  const form = $("#senderRegForm");
  const out = $("#senderRegOut");

  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const data = getFormData(form);

    const res = await api("/users/register", {
      method: "POST",
      body: data,
    });

    out.textContent = pretty(res);

    if (res.ok) {
      // Store the latest profile (helps autofill; no auth token is issued here)
      if (res.user) sessionStorage.setItem('dm_user', JSON.stringify(res.user));
      out.insertAdjacentHTML("beforebegin", alertSuccess("Registration saved"));
    } else {
      out.insertAdjacentHTML("beforebegin", alertError(res.error || "Registration failed"));
    }
  });
}

/* ---------------------------------------------------------
   2. Create Delivery Request
--------------------------------------------------------- */
function setupCreateRequest() {
  const form = $("#createRequestForm");
  const out = $("#senderOutput");

  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const data = getFormData(form);

    // Ack version required by backend
    if (!data.sender_ack_version) {
      data.sender_ack_version = sessionStorage.getItem('dm_sender_ack_version') || 'v2';
    }

    // If user profile exists, use it as defaults (pilot convenience)
    try {
      const u = JSON.parse((sessionStorage.getItem('dm_user') || localStorage.getItem('dm_user') || 'null'));
      if (u && u.phone) data.sender_phone = data.sender_phone || u.phone;
      if (u && u.full_name) data.sender_name = data.sender_name || u.full_name;
      if (u && u.phone) data.sender_phone = data.sender_phone || u.phone;
    } catch (_) {}

    const res = await api("/requests", {
      method: "POST",
      body: data,
      role: 'sender',
    });

    out.textContent = pretty(res);

    if (res.ok) {
      out.insertAdjacentHTML("beforebegin", alertSuccess("Request created"));
      renderCreateRequestInfo(res);
    } else {
      out.insertAdjacentHTML("beforebegin", alertError(res.error || "Failed to create request"));
    }
  });
}


function renderCreateRequestInfo(res) {
  try {
    const box = document.getElementById('senderCreateInfo');
    if (!box) return;
    const id = res?.request?.id;
    const tok = res?.sender_token;
    if (!id) return;
    if (tok) saveSenderTokenForRequest(id, tok);

    // Autofill common fields to reduce pilot friction
    const viewForm = document.getElementById('viewRequestForm');
    if (viewForm && viewForm.request_id) viewForm.request_id.value = String(id);

    const relInput = document.getElementById('releaseRequestId');
    if (relInput) relInput.value = String(id);

    box.innerHTML = `
      <div class="card compact" style="border:1px solid rgba(15,23,42,.12);">
        <div><strong>Save your Request ID:</strong> <span id="createdRequestId">${safeText(id)}</span></div>
        <div class="btn-row" style="margin-top:8px;">
          <button class="btn secondary" type="button" id="copyRequestIdBtn">Copy ID</button>
          <button class="btn" type="button" id="loadCreatedRequestBtn">Load request</button>
        </div>
        <div class="muted" id="copyRequestIdNote" style="margin-top:6px;"></div>
      </div>
    `;

    const copyBtn = document.getElementById('copyRequestIdBtn');
    const loadBtn = document.getElementById('loadCreatedRequestBtn');
    const note = document.getElementById('copyRequestIdNote');

    if (copyBtn) {
      copyBtn.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(String(id));
          if (note) note.textContent = 'Copied.';
        } catch {
          if (note) note.textContent = 'Copy failed. Please select and copy manually.';
        }
      });
    }
    if (loadBtn) {
      loadBtn.addEventListener('click', () => {
        if (viewForm) viewForm.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
      });
    }
  } catch (_) {}
}


/* ---------------------------------------------------------
   3. View Request + Offers + History
--------------------------------------------------------- */
function setupViewRequest() {
  const form = $("#viewRequestForm");
  if (!form) return;

  const reqOut = $("#viewRequestOut");
  const offersOut = $("#viewOffersOut");
  const historyOut = $("#viewHistoryOut");
  const summary = $("#senderReqSummary");
  const offersList = $("#senderOffersList");
  const historyList = $("#senderHistoryList");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = form.request_id.value;

    // Ensure sender token is loaded for this request (needed for accept/release).
    const tok = loadSenderTokenForRequest(id);
    if (tok) sessionStorage.setItem('dm_sender_token', tok);

    const req = await api(`/requests/${id}`);
    reqOut.textContent = pretty(req);

    const offers = await api(`/requests/${id}/offers`);
    offersOut.textContent = pretty(offers);

    const hist = await api(`/requests/${id}/history`);
    historyOut.textContent = pretty(hist);

    // Friendly summary (no raw JSON). Debug JSON remains available in <details>.
    renderSenderSummary({ req, offers, hist, summary, offersList, historyList });
  });
}

function renderSenderSummary({ req, offers, hist, summary, offersList, historyList }) {
  if (!summary || !offersList || !historyList) return;
  summary.innerHTML = '';
  offersList.innerHTML = '';
  historyList.innerHTML = '';

  if (!req || !req.ok || !req.request) {
    summary.insertAdjacentHTML('beforeend', alertError(req?.error || 'Failed to load request'));
    return;
  }

  const r = req.request;
  const pill = statusPill({
    request_status: r.status,
    escrow_status: r.escrow_status,
    payout_status: r.payout_status,
  });
  const tl = timeline({ request_status: r.status, escrow_status: r.escrow_status });
  const next = nextActionText({ role: 'sender', request_status: r.status, escrow_status: r.escrow_status });

  summary.insertAdjacentHTML('beforeend', `
    <div class="card compact">
      ${pill}
      ${tl}
      ${next ? `<div class="next-action"><strong>What happens next:</strong> ${next}</div>` : ''}
      <div class="muted" style="margin-top:10px;">
        Request #${r.id} · ${safeText(r.pickup_suburb)} → ${safeText(r.dropoff_suburb)}
      </div>
    </div>
  `)

  // Prominent sender CTA: confirm delivery when eligible
  const canConfirm = (r.status === 'delivered' || r.escrow_status === 'pending_release');
  if (canConfirm) {
    summary.insertAdjacentHTML('beforeend', `
      <div class="card" style="border:1px solid rgba(15,23,42,.12);">
        <h3 style="margin-top:0;">Confirm delivery</h3>
        <p class="muted">
          Confirming will release escrow immediately. If you do nothing, escrow will auto‑release after 24 hours.
        </p>
        <button class="btn" id="ctaConfirmDeliveryBtn">Confirm delivery & release escrow</button>
        <div class="muted" id="ctaConfirmDeliveryNote" style="margin-top:8px;"></div>
      </div>
    `);

    const ctaBtn = document.getElementById('ctaConfirmDeliveryBtn');
    if (ctaBtn) {
      ctaBtn.addEventListener('click', () => {
        const rid = String(r.id);
        const input = document.getElementById('releaseRequestId');
        const btn = document.getElementById('releaseEscrowBtn');
        const note = document.getElementById('ctaConfirmDeliveryNote');
        if (input) input.value = rid;
        if (note) note.textContent = 'Releasing escrow…';
        if (btn) btn.click();
      });
    }
  }
;

  // Offers list
  const arr = offers && offers.ok && Array.isArray(offers.offers) ? offers.offers : [];
  if (offers && !offers.ok) {
    offersList.insertAdjacentHTML('beforeend', alertError(offers.error || 'Failed to load offers'));
  } else if (arr.length === 0) {
    offersList.insertAdjacentHTML('beforeend', `<div class="muted">No offers yet.</div>`);
  } else {
    offersList.insertAdjacentHTML('beforeend', `
      <div class="card compact">
        <table class="table" style="width:100%; border-collapse: collapse;">
          <thead>
            <tr>
              <th align="left">Offer</th>
              <th align="left">Driver</th>
              <th align="left">Price</th>
              <th align="left">Status</th>
            </tr>
          </thead>
          <tbody>
            ${arr.map(o => `
              <tr>
                <td>#${safeText(o.id)}</td>
                <td>${safeText(o.driver_name || '')}</td>
                <td>${o.price_nzd != null ? `$${safeText(o.price_nzd)}` : ''}</td>
                <td>${safeText(o.status || '')}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
        <div class="muted" style="margin-top:10px;">To accept, copy the Offer ID into “Accept Offer”.</div>
      </div>
    `);
  }

  // History list
  const h = hist && hist.ok && Array.isArray(hist.history) ? hist.history : [];
  if (hist && !hist.ok) {
    historyList.insertAdjacentHTML('beforeend', alertError(hist.error || 'Failed to load history'));
  } else if (h.length === 0) {
    historyList.insertAdjacentHTML('beforeend', `<div class="muted">No history yet.</div>`);
  } else {
    historyList.insertAdjacentHTML('beforeend', `
      <div class="card compact">
        <ul style="margin:0; padding-left:18px;">
          ${h.slice(0, 12).map(ev => {
            const when = ev.created_at ? new Date(ev.created_at).toLocaleString() : '';
            const note = ev.note || `${ev.from_status || ''} → ${ev.to_status || ''}`;
            return `<li><strong>${safeText(when)}</strong> — ${safeText(note)}</li>`;
          }).join('')}
        </ul>
        ${h.length > 12 ? `<div class="muted" style="margin-top:8px;">Showing latest 12 events (debug JSON contains full history).</div>` : ''}
      </div>
    `);
  }
}

function safeText(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ---------------------------------------------------------
   4. Accept Offer
--------------------------------------------------------- */
function setupAcceptOffer() {
  const form = $("#acceptOfferForm");
  const out = $("#acceptOfferOut");

  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const requestId = form.request_id.value;
    const offerId = form.offer_id.value;

    const res = await api(`/requests/${requestId}/offers/${offerId}/accept`, {
      method: "POST",
      role: 'sender',
    });

    out.textContent = pretty(res);

    if (res.ok) {
      out.insertAdjacentHTML("beforebegin", alertSuccess("Offer accepted"));
    } else {
      out.insertAdjacentHTML("beforebegin", alertError(res.error || "Failed to accept offer"));
    }
  });
}

/* ---------------------------------------------------------
   5. Fund Escrow (Stripe Checkout)
--------------------------------------------------------- */
function setupFundEscrow() {
  const btn = $("#fundEscrowBtn");
  const amountInput = $("#fundAmount");
  const out = $("#fundEscrowOut");

  if (!btn) return;

  btn.addEventListener("click", async () => {
    const requestId = $("#fundRequestId").value;
    const amount = amountInput.value;

    const res = await api(`/requests/${requestId}/escrow/fund`, {
      method: "POST",
      body: { amount_nzd: amount },
      role: 'sender',
    });

    out.textContent = pretty(res);

    if (res.ok && res.checkout_url) {
      window.location.href = res.checkout_url;
    } else {
      out.insertAdjacentHTML("beforebegin", alertError(res.error || "Failed to start payment"));
    }
  });
}

/* ---------------------------------------------------------
   6. Release Escrow
--------------------------------------------------------- */
function setupReleaseEscrow() {
  const btn = $("#releaseEscrowBtn");
  const out = $("#releaseEscrowOut");

  if (!btn) return;

  btn.addEventListener("click", async () => {
    const requestId = $("#releaseRequestId").value;

    const res = await api(`/requests/${requestId}/escrow/release`, {
      method: "POST",
      role: 'sender',
    });

    out.textContent = pretty(res);

    if (res.ok) {
      out.insertAdjacentHTML("beforebegin", alertSuccess("Escrow released"));
    } else {
      out.insertAdjacentHTML("beforebegin", alertError(res.error || "Failed to release escrow"));
    }
  });
}

/* ---------------------------------------------------------
   Pilot: Report an issue helper
--------------------------------------------------------- */
function setupIssueReport_sender() {
  const form = document.getElementById('senderIssueForm');
  const out = document.getElementById('senderIssueOut');
  if (!form || !out) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const requestId = String(fd.get('request_id') || '').trim();
    const note = String(fd.get('note') || '').trim();

    let snapshot = '';
    if (requestId) {
      // Try to load request + (optional) offers/history where relevant
      const req = await api(`/requests/${encodeURIComponent(requestId)}`, { role: 'sender' });
      if (req && req.ok && req.request) {
        const r = req.request;
        snapshot = `Status: ${r.status}\nEscrow: ${r.escrow_status}\nPayout: ${r.payout_status}\nPickup: ${safeText(r.pickup_suburb)}\nDrop-off: ${safeText(r.dropoff_suburb)}`;
      } else {
        snapshot = `Status snapshot: (unable to load request)`;
      }
    }

    const now = new Date().toISOString();
    const url = window.location.origin;
    const msg = [
      `DeliveryMate pilot issue report`,
      `Time: ${now}`,
      `Role: sender`,
      requestId ? `Request ID: ${requestId}` : `Request ID: (not provided)`,
      snapshot ? `\n${snapshot}\n` : '',
      note ? `Note: ${note}` : 'Note: (none)',
      `\nPlease include a screenshot if possible.`,
      `Site: ${url}`
    ].join('\n');

    out.textContent = msg;
  });
}


function setupSenderAuthControls() {
  setupSenderLogin();
  const continueBtn = document.getElementById('senderContinueBtn');
  const logoutBtn = document.getElementById('senderLogoutBtn');
  const hint = document.getElementById('senderAuthHint');

  if (hint) {
    const u = getSavedUser();
    hint.textContent = u?.phone ? `Saved on this device: ${u.phone}` : 'No saved login on this device yet.';
  }

  if (continueBtn) {
    continueBtn.addEventListener('click', () => {
      const u = getSavedUser();
      if (!u) {
        if (hint) hint.textContent = 'No saved login found. Please register below.';
        return;
      }
      // Mark registered and restore to session for convenience
      localStorage.setItem('dm_sender_registered', '1');
      sessionStorage.setItem('dm_sender_registered', '1');
      sessionStorage.setItem('dm_user', JSON.stringify(u));
      enforceSenderGate();
      if (hint) hint.textContent = `Continuing as ${u.phone}`;
    });
  }

  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      // Keep sender_tokens map; only clear identity
      localStorage.removeItem('dm_sender_registered');
      localStorage.removeItem('dm_user');
      sessionStorage.removeItem('dm_sender_registered');
      sessionStorage.removeItem('dm_user');
      sessionStorage.removeItem('dm_sender_token');
      sessionStorage.removeItem('dm_user_token');
      localStorage.removeItem('dm_user_token');
      enforceSenderGate();
      if (hint) hint.textContent = 'Logged out. Please register again to use this device.';
    });
  }
}


function saveUserToken(tok) {
  if (!tok) return;
  localStorage.setItem('dm_user_token', String(tok));
  sessionStorage.setItem('dm_user_token', String(tok));
}

function getSavedUser() {
  try {
    const raw = localStorage.getItem('dm_user');
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}


function setupSenderLogin() {
  const form = document.getElementById('senderLoginForm');
  const hint = document.getElementById('senderAuthHint');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const phone = String(fd.get('phone') || '').trim();
    const invite_code = String(fd.get('invite_code') || '').trim();

    if (hint) hint.textContent = 'Logging in…';

    const res = await api('/users/login', { method: 'POST', body: { phone, invite_code } });
    if (!res.ok) {
      if (hint) hint.textContent = res.error || 'Login failed';
      return;
    }

    saveUserToken(res.user_token);
    markSenderRegistered(res.user);
    // Also restore to session for convenience
    sessionStorage.setItem('dm_user', JSON.stringify(res.user));
    enforceSenderGate();

    if (hint) hint.textContent = `Logged in as ${res.user?.phone || phone}`;
  });
}
