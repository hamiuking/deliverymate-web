// public/js/sender.js

import { api } from "./api.js";
import { $, pretty } from "./utils.js";
import { alertSuccess, alertError } from "./components/alerts.js";
import { getFormData } from "./components/forms.js";

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

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = form.request_id.value;

    const req = await api(`/requests/${id}`);
    reqOut.textContent = pretty(req);

    const offers = await api(`/requests/${id}/offers`);
    offersOut.textContent = pretty(offers);

    const hist = await api(`/requests/${id}/history`);
    historyOut.textContent = pretty(hist);
  });
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