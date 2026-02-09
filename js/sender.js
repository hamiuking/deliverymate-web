// public/js/sender.js

import { api } from "./api.js";
import { $, pretty } from "./utils.js";
import { alertSuccess, alertError } from "./components/alerts.js";
import { getFormData } from "./components/forms.js";
import { statusPill, timeline, nextActionText } from "./components/status.js";

export function initSenderPage() {
  console.log("Sender page loaded");

  setupRegistration();
  setupCreateRequest();
  setupViewRequest();
  setupAcceptOffer();
  setupFundEscrow();
  setupReleaseEscrow();
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
      const u = JSON.parse(sessionStorage.getItem('dm_user') || 'null');
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
    } else {
      out.insertAdjacentHTML("beforebegin", alertError(res.error || "Failed to create request"));
    }
  });
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