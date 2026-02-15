// public/js/sender.js
// IMPROVED VERSION with:
// - ✅ FIX: Stripe return auth (dm_user_token check, not dm_sender_token)
// - ✅ Auto-fill Request ID after create/accept
// - ✅ Next action banner with smart guidance
// - ✅ Professional status display (no technical jargon)
// - ✅ Cleaner debug section organization
// - ✅ Better post-payment flow

import { api } from "./api.js";
import { getFormData } from "./components/forms.js";
import { alertSuccess, alertError } from "./components/alerts.js";
import { statusPill, timeline, nextActionText } from "./components/status.js";

/* ---------------------------------------------------------
   Helpers
--------------------------------------------------------- */

function safeText(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function setResult(el, html) {
  if (!el) return;
  el.innerHTML = html || "";
}

function normaliseNzdAmount(v) {
  const s = String(v ?? "").trim();
  if (!s) return "";
  const n = Number(String(s).replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(n) || n <= 0) return "";
  return String(Math.round(n * 100) / 100);
}

function offerPriceFromOfferObj(o) {
  if (!o) return "";
  const p =
    o.price_nzd ??
    o.offer_price_nzd ??
    o.amount_nzd ??
    o.price ??
    o.amount ??
    "";
  return normaliseNzdAmount(p);
}

/* ---------------------------------------------------------
   Local storage keys (scoped per sender phone)
--------------------------------------------------------- */

const SENDER_USER_KEY = "dm_sender_user";
const SENDER_RECENT_KEY_BASE = "dm_sender_recent_requests";

function getSavedUser() {
  try {
    return JSON.parse(localStorage.getItem(SENDER_USER_KEY) || "null");
  } catch {
    return null;
  }
}

function saveUser(userObj) {
  try {
    localStorage.setItem(SENDER_USER_KEY, JSON.stringify(userObj));
  } catch (_) {}
}

function senderRecentKey() {
  const u = getSavedUser();
  const phone = String(u?.phone || "").trim();
  return phone ? `${SENDER_RECENT_KEY_BASE}:${phone}` : `${SENDER_RECENT_KEY_BASE}:anon`;
}

function loadSenderRecent() {
  try {
    return JSON.parse(localStorage.getItem(senderRecentKey()) || "[]");
  } catch {
    return [];
  }
}

function saveSenderRecent(list) {
  try {
    localStorage.setItem(senderRecentKey(), JSON.stringify(list));
  } catch (_) {}
}

/* ---------------------------------------------------------
   Per-request token + accepted offer price caching
--------------------------------------------------------- */

function senderTokenKey(requestId) {
  return `dm_sender_token_for_request:${String(requestId)}`;
}

function saveSenderTokenForRequest(requestId, token) {
  if (!requestId || !token) return;
  try {
    localStorage.setItem(senderTokenKey(requestId), String(token));
  } catch (_) {}
}

function loadSenderTokenForRequest(requestId) {
  if (!requestId) return "";
  try {
    return localStorage.getItem(senderTokenKey(requestId)) || "";
  } catch (_) {
    return "";
  }
}

function acceptedPriceKey(requestId) {
  return `dm_sender_accepted_price:${String(requestId)}`;
}

function saveAcceptedPriceForRequest(requestId, price) {
  const p = normaliseNzdAmount(price);
  if (!requestId || !p) return;
  try {
    localStorage.setItem(acceptedPriceKey(requestId), p);
  } catch (_) {}
}

function loadAcceptedPriceForRequest(requestId) {
  if (!requestId) return "";
  try {
    return localStorage.getItem(acceptedPriceKey(requestId)) || "";
  } catch (_) {
    return "";
  }
}

function offerPriceKey(requestId, offerId) {
  return `dm_sender_offer_price:${String(requestId)}:${String(offerId)}`;
}

function saveOfferPriceForRequestOffer(requestId, offerId, price) {
  const p = normaliseNzdAmount(price);
  if (!requestId || !offerId || !p) return;
  try {
    localStorage.setItem(offerPriceKey(requestId, offerId), p);
  } catch (_) {}
}

function loadOfferPriceForRequestOffer(requestId, offerId) {
  if (!requestId || !offerId) return "";
  try {
    return localStorage.getItem(offerPriceKey(requestId, offerId)) || "";
  } catch (_) {
    return "";
  }
}

/* ---------------------------------------------------------
   Auth helpers - FIXED: Use dm_user_token consistently
--------------------------------------------------------- */

function setAuthStatus(text) {
  const el = document.getElementById("senderAuthStatusDash") || document.getElementById("senderAuthStatus");
  if (el) el.textContent = text || "";
}

function getUserToken() {
  // ✅ FIX: Check dm_user_token (unified auth), not dm_sender_token
  return sessionStorage.getItem("dm_user_token") || localStorage.getItem("dm_user_token") || "";
}

function setDashboardVisible(isAuthed) {
  const dash = document.getElementById("senderDashboard");
  const auth = document.getElementById("senderAuthArea") || document.getElementById("senderAuthCard");
  if (dash) dash.classList.toggle("hidden", !isAuthed);
  if (auth) auth.classList.toggle("hidden", !!isAuthed);
}

/* ---------------------------------------------------------
   Recent requests UI (aligned to senderMyRequestsCard)
--------------------------------------------------------- */

function addRecentRequest(requestId) {
  const id = String(requestId || "").trim();
  if (!id) return;
  const list = loadSenderRecent();
  const next = [id, ...list.filter((x) => String(x) !== id)].slice(0, 12);
  saveSenderRecent(next);
}

function renderRecentRequests() {
  const sel = document.getElementById("senderRecentSelect");
  if (!sel) return;

  const list = loadSenderRecent();

  const cnt = document.getElementById("senderRecentCount");
  if (cnt) cnt.textContent = list.length ? `${list.length} saved on this device` : `No saved requests on this device yet.`;

  sel.innerHTML = `<option value="">Select a request…</option>`;
  for (const id of list) {
    sel.insertAdjacentHTML("beforeend", `<option value="${safeText(id)}">Request #${safeText(id)}</option>`);
  }

  const clr = document.getElementById("senderRecentClearBtn");
  if (clr && !clr.__bound) {
    clr.__bound = true;
    clr.addEventListener("click", () => {
      saveSenderRecent([]);
      renderRecentRequests();
    });
  }
}

/* ---------------------------------------------------------
   NEW: Next Action Banner - Smart guidance based on request state
--------------------------------------------------------- */

function updateNextActionBanner(requestData) {
  const banner = document.getElementById("senderNextActionBanner");
  if (!banner) return;

  if (!requestData || !requestData.id) {
    banner.innerHTML = "";
    return;
  }

  const r = requestData;
  const status = String(r.status || "").toLowerCase();
  const escrowStatus = String(r.escrow_status || "none").toLowerCase();
  const offersCount = r.offers_count || 0;

  let html = "";

  // State: Open, waiting for offers
  if (status === "open" && offersCount === 0) {
    html = `
      <div class="alert" style="background: rgba(59,130,246,.08); border-color: rgba(59,130,246,.2); color: #1e3a8a;">
        <strong>⏳ Waiting for driver offers</strong>
        <div class="muted" style="margin-top:4px;">Your request is live. Approved drivers can now submit offers. You'll see them appear in the "Offers" section below.</div>
      </div>
    `;
  }

  // State: Open, has offers
  if (status === "open" && offersCount > 0) {
    html = `
      <div class="alert" style="background: rgba(34,197,94,.08); border-color: rgba(34,197,94,.2); color: #166534;">
        <strong>✓ You have ${offersCount} offer${offersCount > 1 ? 's' : ''}</strong>
        <div class="muted" style="margin-top:4px;">Review offers below and click "Accept" on your preferred driver.</div>
      </div>
    `;
  }

  // State: Accepted, need to fund escrow
  if (status === "accepted" && escrowStatus === "none") {
    html = `
      <div class="alert" style="background: rgba(245,158,11,.08); border-color: rgba(245,158,11,.2); color: #78350f;">
        <strong>💳 Payment required</strong>
        <div class="muted" style="margin-top:4px;">Fund escrow via Stripe to confirm this delivery with your driver.</div>
        <button class="btn mt-2" id="bannerPayBtn" style="background: #0284c7; border-color: #0284c7;">Go to Payment</button>
      </div>
    `;
  }

  // State: Accepted, escrow funded, waiting for pickup
  if (status === "accepted" && escrowStatus === "funded") {
    html = `
      <div class="alert" style="background: rgba(59,130,246,.08); border-color: rgba(59,130,246,.2); color: #1e3a8a;">
        <strong>✓ Payment complete</strong>
        <div class="muted" style="margin-top:4px;">Your driver will pick up the item and update you when it's on the way.</div>
      </div>
    `;
  }

  // State: Picked up
  if (status === "picked_up") {
    html = `
      <div class="alert" style="background: rgba(59,130,246,.08); border-color: rgba(59,130,246,.2); color: #1e3a8a;">
        <strong>🚗 Item picked up</strong>
        <div class="muted" style="margin-top:4px;">Your driver has collected the item and is on the way to drop-off.</div>
      </div>
    `;
  }

  // State: Delivered, pending release
  if (status === "delivered" && escrowStatus === "pending_release") {
    html = `
      <div class="alert" style="background: rgba(34,197,94,.08); border-color: rgba(34,197,94,.2); color: #166534;">
        <strong>📦 Delivered! Confirm to release payment</strong>
        <div class="muted" style="margin-top:4px;">Your driver marked this as delivered. Confirm delivery to release payment immediately, or it will auto-release in 24 hours.</div>
        <button class="btn mt-2" id="bannerReleaseBtn" style="background: #16a34a; border-color: #16a34a;">Confirm Delivery</button>
      </div>
    `;
  }

  // State: Released
  if (escrowStatus === "released") {
    html = `
      <div class="alert success">
        <strong>✓ Complete</strong>
        <div class="muted" style="margin-top:4px;">Payment has been released to your driver. This delivery is complete.</div>
      </div>
    `;
  }

  // State: Cancelled
  if (status === "cancelled") {
    html = `
      <div class="alert error">
        <strong>Cancelled</strong>
        <div class="muted" style="margin-top:4px;">This request has been cancelled.</div>
      </div>
    `;
  }

  banner.innerHTML = html;

  // Wire up banner buttons
  const payBtn = document.getElementById("bannerPayBtn");
  if (payBtn && !payBtn.__bound) {
    payBtn.__bound = true;
    payBtn.addEventListener("click", () => {
      const fundForm = document.getElementById("fundEscrowForm");
      if (fundForm) {
        if (fundForm.request_id) fundForm.request_id.value = r.id;
        const price = loadAcceptedPriceForRequest(r.id);
        if (fundForm.amount_nzd && price) {
          fundForm.amount_nzd.value = price;
          fundForm.amount_nzd.readOnly = true;
        }
        fundForm.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
  }

  const releaseBtn = document.getElementById("bannerReleaseBtn");
  if (releaseBtn && !releaseBtn.__bound) {
    releaseBtn.__bound = true;
    releaseBtn.addEventListener("click", () => {
      const releaseForm = document.getElementById("releaseEscrowForm");
      if (releaseForm) {
        if (releaseForm.request_id) releaseForm.request_id.value = r.id;
        releaseForm.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
  }
}

/* ---------------------------------------------------------
   Status summary
--------------------------------------------------------- */

function renderRequestSummary(r) {
  const box = document.getElementById("senderReqSummary");
  if (!box) return;

  const pill = statusPill(r);
  const tl = timeline(r);
  const next = nextActionText(r);

  const status = String(r?.status || "").toLowerCase();
  const escrowStatus = String(r?.escrow_status || "none").toLowerCase();
  const requestId = r?.id || "";

  // Determine which inline action to show
  let actionButton = "";

  // State: Accepted, need payment
  if (status === "accepted" && escrowStatus === "none") {
    actionButton = `
      <button class="btn" id="inlineFundBtn" data-request-id="${safeText(requestId)}" style="margin-top:12px; width:100%; background:#0284c7; border-color:#0284c7;">
        💳 Fund Escrow (Pay with Stripe)
      </button>
    `;
  }

  // State: Delivered, pending release
  if (status === "delivered" && escrowStatus === "pending_release") {
    actionButton = `
      <button class="btn" id="inlineReleaseBtn" data-request-id="${safeText(requestId)}" style="margin-top:12px; width:100%; background:#16a34a; border-color:#16a34a;">
        ✓ Confirm Delivery & Release Payment
      </button>
    `;
  }

  box.innerHTML = `
    <div class="card compact">
      <div style="display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap;">
        <div>
          <div style="font-weight:700;">Request #${safeText(requestId)}</div>
          <div class="muted">${safeText(r?.pickup_suburb || "")}${r?.dropoff_suburb ? ` → ${safeText(r.dropoff_suburb)}` : ""}</div>
        </div>
        <div>${pill}</div>
      </div>
      <div style="margin-top:10px;">${tl}</div>
      <div style="margin-top:10px;" class="muted"><strong>Next:</strong> ${safeText(next || "")}</div>
      ${actionButton}
    </div>
  `;

  // Wire up inline buttons
  const fundBtn = document.getElementById("inlineFundBtn");
  if (fundBtn && !fundBtn.__bound) {
    fundBtn.__bound = true;
    fundBtn.addEventListener("click", () => {
      const reqId = fundBtn.dataset.requestId;
      const fundForm = document.getElementById("fundEscrowForm");
      if (fundForm && reqId) {
        if (fundForm.request_id) fundForm.request_id.value = reqId;
        
        // Pre-fill amount from accepted offer
        const price = loadAcceptedPriceForRequest(reqId);
        if (fundForm.amount_nzd && price) {
          fundForm.amount_nzd.value = price;
          fundForm.amount_nzd.readOnly = true;
        }
        
        // Auto-submit to go directly to Stripe
        fundForm.scrollIntoView({ behavior: "smooth", block: "start" });
        setTimeout(() => {
          fundForm.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
        }, 300);
      }
    });
  }

  const releaseBtn = document.getElementById("inlineReleaseBtn");
  if (releaseBtn && !releaseBtn.__bound) {
    releaseBtn.__bound = true;
    releaseBtn.addEventListener("click", async () => {
      const reqId = releaseBtn.dataset.requestId;
      
      // Confirm before releasing
      if (!confirm("Confirm delivery and release payment to driver?")) return;
      
      releaseBtn.disabled = true;
      releaseBtn.textContent = "Releasing...";
      
      const res = await api(`/requests/${reqId}/escrow/release`, {
        method: "POST",
        role: "sender",
        body: {},
      });
      
      if (res.ok) {
        // Refresh the view to show updated status
        const viewForm = document.getElementById("viewRequestForm");
        if (viewForm && viewForm.request_id) {
          viewForm.request_id.value = reqId;
          viewForm.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
        }
      } else {
        alert(res.error || "Failed to release payment");
        releaseBtn.disabled = false;
        releaseBtn.textContent = "✓ Confirm Delivery & Release Payment";
      }
    });
  }
}

/* ---------------------------------------------------------
   Create request acknowledgement gating
--------------------------------------------------------- */

function setupCreateAcksGate() {
  const btn = document.getElementById("createRequestBtn");
  if (!btn) return;

  const ids = ["sAck1", "sAck2", "sAck3", "sAck4"];
  const boxes = ids.map((id) => document.getElementById(id)).filter(Boolean);

  const refresh = () => {
    const ok = boxes.length === 4 && boxes.every((b) => b.checked);
    btn.disabled = !ok;
  };

  boxes.forEach((b) => b.addEventListener("change", refresh));
  refresh();
}

/* ---------------------------------------------------------
   Create Request - IMPROVED: Auto-fill ID after creation
--------------------------------------------------------- */

function setupCreateRequest() {
  const form = document.getElementById("createRequestForm");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const btn = document.getElementById("createRequestBtn");
    const out = document.getElementById("senderOutput");
    const result = document.getElementById("createRequestResult");
    const info = document.getElementById("senderCreateInfo");

    if (btn) btn.disabled = true;
    if (result) setResult(result, "");
    if (info) setResult(info, "");

    const fd = getFormData(form);

    // ✅ Verify acknowledgements are checked
    const ackOk =
      !!document.getElementById("sAck1")?.checked &&
      !!document.getElementById("sAck2")?.checked &&
      !!document.getElementById("sAck3")?.checked &&
      !!document.getElementById("sAck4")?.checked;

    if (!ackOk) {
      if (btn) btn.disabled = false;
      if (result) setResult(result, alertError("Please tick all acknowledgements to continue."));
      return;
    }

    // ✅ Auto-include sender_phone from logged-in user
    const u = getSavedUser();
    const sender_phone = String(u?.phone || "").trim();
    if (!sender_phone) {
      if (btn) btn.disabled = false;
      if (result) setResult(result, alertError("Your login session is missing a phone number. Please log out and log in again."));
      return;
    }

    const pickup_suburb = String(fd.pickup_suburb || "").trim();
    const dropoff_suburb = String(fd.dropoff_suburb || "").trim();
    const item_desc = String(fd.item_desc || "").trim();
    const sender_note = String(fd.sender_note || "").trim();

    if (!pickup_suburb || !dropoff_suburb || !item_desc) {
      if (btn) btn.disabled = false;
      if (result) setResult(result, alertError("Pickup suburb, drop-off suburb, and item description are required."));
      return;
    }

    // ✅ Backend expects item_description (max 300 chars) and combines note
    let item_description = item_desc;
    if (sender_note) item_description = `${item_desc} | Note: ${sender_note}`;
    item_description = item_description.slice(0, 300);

    // ✅ Build proper payload matching backend expectations
    const body = {
      sender_phone,
      pickup_suburb,
      dropoff_suburb,
      item_description, // Backend expects this field name
      weight_kg: fd.weight_kg === "" || fd.weight_kg == null ? null : Number(fd.weight_kg),
      suggested_price_nzd: fd.suggested_price_nzd === "" || fd.suggested_price_nzd == null ? null : Number(fd.suggested_price_nzd),
      sender_ack_version: "v1" // Required by backend
    };

    const res = await api("/requests", {
      method: "POST",
      role: "sender",
      body,
    });

    if (btn) btn.disabled = false;
    if (out) out.textContent = JSON.stringify(res, null, 2);

    if (res.ok) {
      if (result) setResult(result, alertSuccess("Request created"));
      
      const requestId = res.request?.id || res.id;
      
      if (requestId) {
        // ✅ Auto-save to recent
        addRecentRequest(requestId);
        renderRecentRequests();

        // ✅ Auto-fill View form
        const viewForm = document.getElementById("viewRequestForm");
        if (viewForm && viewForm.request_id) {
          viewForm.request_id.value = requestId;
        }

        // ✅ Show success with next steps
        if (info) {
          setResult(info, `
            <div class="alert success" style="margin-top:10px;">
              <strong>Request #${safeText(requestId)} created successfully</strong>
              <div class="muted" style="margin-top:6px;">Your request is now visible to approved drivers. You'll receive offers below.</div>
              <button class="btn secondary mt-2" id="viewNewRequestBtn">View Request Details</button>
            </div>
          `);

          // Wire up view button
          const viewBtn = document.getElementById("viewNewRequestBtn");
          if (viewBtn && !viewBtn.__bound) {
            viewBtn.__bound = true;
            viewBtn.addEventListener("click", () => {
              if (viewForm) {
                viewForm.scrollIntoView({ behavior: "smooth", block: "start" });
                viewForm.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
              }
            });
          }
        }

        // Save sender token if returned
        if (res.sender_token) {
          saveSenderTokenForRequest(requestId, res.sender_token);
        }
      }

      form.reset();
      setupCreateAcksGate(); // Re-disable button
    } else {
      if (result) setResult(result, alertError(res.error || "Failed to create request"));
    }
  });
}

/* ---------------------------------------------------------
   View Request - IMPROVED: Update next action banner
--------------------------------------------------------- */

function setupViewRequest() {
  const form = document.getElementById("viewRequestForm");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const out = document.getElementById("viewRequestOut");
    const offersOut = document.getElementById("viewOffersOut");
    const historyOut = document.getElementById("viewHistoryOut");
    const result = document.getElementById("viewRequestResult");
    const offersResult = document.getElementById("viewOffersResult");

    const requestId = form.request_id.value;
    if (!requestId) {
      if (result) setResult(result, alertError("Request ID is required"));
      return;
    }

    // Fetch request, offers, history
    const [req, offers, hist] = await Promise.all([
      api(`/requests/${requestId}`, { method: "GET", role: "sender" }),
      api(`/requests/${requestId}/offers`, { method: "GET", role: "sender" }),
      api(`/requests/${requestId}/history`, { method: "GET", role: "sender" }),
    ]);

    if (out) out.textContent = JSON.stringify(req, null, 2);
    if (offersOut) offersOut.textContent = JSON.stringify(offers, null, 2);
    if (historyOut) historyOut.textContent = JSON.stringify(hist, null, 2);

    if (req.ok && req.request) {
      addRecentRequest(requestId);
      renderRecentRequests();
      renderRequestSummary(req.request);
      
      // ✅ Update next action banner
      updateNextActionBanner({
        ...req.request,
        offers_count: (offers.ok && Array.isArray(offers.offers)) ? offers.offers.length : 0
      });

      // ✅ Show the details section
      const detailsSection = document.getElementById("senderRequestDetails");
      if (detailsSection) detailsSection.classList.remove("hidden");

      if (result) setResult(result, alertSuccess("Loaded"));
    } else {
      // ✅ Hide details section on error
      const detailsSection = document.getElementById("senderRequestDetails");
      if (detailsSection) detailsSection.classList.add("hidden");
      
      if (result) setResult(result, alertError(req.error || "Failed to load request"));
      
      // Clear banner on error
      updateNextActionBanner(null);
    }

    renderOffers(offers, req.request); // Pass request data
    renderHistory(hist, req.request); // Pass request data

    if (offersResult) {
      setResult(offersResult, offers.ok ? "" : alertError(offers.error || "Failed to load offers"));
    }
  });
}

function renderOffers(offers, requestData) {
  const list = document.getElementById("senderOffersList");
  if (!list) return;
  list.innerHTML = "";

  if (!offers || !offers.ok || !Array.isArray(offers.offers)) {
    list.insertAdjacentHTML("beforeend", alertError(offers?.error || "Failed to load offers"));
    return;
  }

  if (offers.offers.length === 0) {
    list.insertAdjacentHTML("beforeend", `<div class="muted">No offers yet.</div>`);
    return;
  }

  // Check if offer has been accepted (status = 'accepted' or later)
  const status = String(requestData?.status || "").toLowerCase();
  const isAccepted = ["accepted", "picked_up", "delivered", "cancelled"].includes(status);

  // Wrap in collapsible details, auto-collapsed if accepted
  const detailsOpen = !isAccepted; // Open if NOT accepted, closed if accepted
  
  const detailsWrapper = document.createElement("details");
  if (detailsOpen) detailsWrapper.setAttribute("open", "");
  detailsWrapper.style.marginTop = "10px";
  
  const summary = document.createElement("summary");
  summary.style.cursor = "pointer";
  summary.style.fontWeight = "600";
  summary.style.marginBottom = "10px";
  summary.textContent = `${offers.offers.length} offer${offers.offers.length === 1 ? '' : 's'} received ${isAccepted ? '(accepted - click to view)' : ''}`;
  
  detailsWrapper.appendChild(summary);

  for (const o of offers.offers) {
    const price = offerPriceFromOfferObj(o);
    const requestId = String(o.request_id || "");
    const offerId = String(o.id || "");

    if (price) {
      try { saveOfferPriceForRequestOffer(requestId, offerId, price); } catch (_) {}
    }

    const card = document.createElement("div");
    card.className = "card compact";
    card.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap:wrap;">
        <div>
          <div style="font-weight:600;">${safeText(o.driver_name || "Driver")}</div>
          <div class="muted">Price: NZD $${safeText(price || "—")}</div>
          ${o.note ? `<div class="muted" style="margin-top:4px;">${safeText(o.note)}</div>` : ""}
        </div>
        <button
          class="btn senderOfferAcceptBtn"
          data-request-id="${safeText(requestId)}"
          data-offer-id="${safeText(offerId)}"
          data-offer-price="${safeText(price)}"
        >Accept</button>
      </div>
    `;
    detailsWrapper.appendChild(card);
  }
  
  list.appendChild(detailsWrapper);
}

function renderHistory(hist, requestData) {
  const list = document.getElementById("senderHistoryList");
  if (!list) return;
  list.innerHTML = "";

  const events = hist && hist.ok && Array.isArray(hist.events) ? hist.events : (hist?.history || []);
  if (!hist || !hist.ok) {
    list.insertAdjacentHTML("beforeend", alertError(hist?.error || "Failed to load history"));
    return;
  }

  if (events.length === 0) {
    list.insertAdjacentHTML("beforeend", `<div class="muted">No history yet.</div>`);
    return;
  }

  // Check if offer has been accepted
  const status = String(requestData?.status || "").toLowerCase();
  const isAccepted = ["accepted", "picked_up", "delivered", "cancelled"].includes(status);

  // Wrap in collapsible details, auto-collapsed if accepted
  const detailsOpen = !isAccepted;
  
  const detailsWrapper = document.createElement("details");
  if (detailsOpen) detailsWrapper.setAttribute("open", "");
  detailsWrapper.style.marginTop = "10px";
  
  const summary = document.createElement("summary");
  summary.style.cursor = "pointer";
  summary.style.fontWeight = "600";
  summary.style.marginBottom = "10px";
  summary.textContent = `${events.length} activity event${events.length === 1 ? '' : 's'} ${isAccepted ? '(click to view)' : ''}`;
  
  detailsWrapper.appendChild(summary);

  const card = document.createElement("div");
  card.className = "card compact";
  card.innerHTML = `
    <ul style="margin:0; padding-left:18px;">
      ${events.slice(0, 12).map((ev) => {
        const when = ev.created_at ? new Date(ev.created_at).toLocaleString() : "";
        const note = ev.note || `${ev.from_status || ""} → ${ev.to_status || ""}`;
        return `<li><strong>${safeText(when)}</strong> — ${safeText(note)}</li>`;
      }).join("")}
    </ul>
  `;
  detailsWrapper.appendChild(card);
  list.appendChild(detailsWrapper);
}

/* ---------------------------------------------------------
   Fund Escrow
--------------------------------------------------------- */

function setupFundEscrow() {
  const form = document.getElementById("fundEscrowForm");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const btn = form.querySelector('button[type="submit"]');
    const out = document.getElementById("fundEscrowOut");
    const result = document.getElementById("fundEscrowResult");

    if (btn) btn.disabled = true;
    if (result) setResult(result, "");

    const requestId = form.request_id.value;
    const amountNzd = form.amount_nzd.value;

    // ✅ Correct endpoint: /requests/:id/escrow/fund
    const res = await api(`/requests/${encodeURIComponent(requestId)}/escrow/fund`, {
      method: "POST",
      role: "sender",
      body: { amount_nzd: amountNzd },
    });

    if (btn) btn.disabled = false;
    if (out) out.textContent = JSON.stringify(res, null, 2);

    if (res.ok && res.checkout_url) {
      if (result) setResult(result, alertSuccess("Redirecting to Stripe…"));
      
      // Save token before redirect (if provided)
      if (res.sender_token) {
        saveSenderTokenForRequest(requestId, res.sender_token);
      }

      setTimeout(() => {
        window.location.href = res.checkout_url;
      }, 400);
    } else {
      if (result) setResult(result, alertError(res.error || "Failed to create checkout"));
    }
  });
}

/* ---------------------------------------------------------
   Confirm Release
--------------------------------------------------------- */

function setupConfirmRelease() {
  const form = document.getElementById("releaseEscrowForm");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const btn = form.querySelector('button[type="submit"]');
    const out = document.getElementById("releaseEscrowOut");
    const result = document.getElementById("releaseEscrowResult");

    if (btn) btn.disabled = true;
    if (result) setResult(result, "");

    const requestId = form.request_id.value;

    const res = await api(`/requests/${requestId}/escrow/release`, {
      method: "POST",
      role: "sender",
      body: {},
    });

    if (btn) btn.disabled = false;
    if (out) out.textContent = JSON.stringify(res, null, 2);

    if (res.ok) {
      if (result) setResult(result, alertSuccess("Escrow released"));
      
      // Refresh view
      const viewForm = document.getElementById("viewRequestForm");
      if (viewForm) {
        viewForm.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      }
    } else {
      if (result) setResult(result, alertError(res.error || "Failed to release"));
    }
  });
}

/* ---------------------------------------------------------
   Offer accept - IMPROVED: Auto-scroll to payment
--------------------------------------------------------- */

function setupSenderOffersActions() {
  document.addEventListener("click", async (e) => {
    const btn = e.target?.closest?.(".senderOfferAcceptBtn");
    if (!btn) return;

    const requestId = String(btn.dataset.requestId || "").trim();
    const offerId = String(btn.dataset.offerId || "").trim();
    const offerPrice = String(btn.dataset.offerPrice || "").trim();

    if (!requestId || !offerId) return;

    const out = document.getElementById("viewOffersResult");
    const old = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Accepting…";

    try {
      const p = offerPrice || loadOfferPriceForRequestOffer(requestId, offerId);
      if (p) saveOfferPriceForRequestOffer(requestId, offerId, p);
    } catch (_) {}

    const res = await api(
      `/requests/${encodeURIComponent(requestId)}/offers/${encodeURIComponent(offerId)}/accept`,
      { method: "POST", role: "sender", body: {} }
    );

    btn.textContent = old;

    if (res.ok) {
      if (out) setResult(out, alertSuccess("Offer accepted"));

      try {
        document
          .querySelectorAll(`.senderOfferAcceptBtn[data-request-id="${CSS.escape(requestId)}"]`)
          .forEach((b) => {
            b.disabled = true;
            if (String(b.dataset.offerId || "") === offerId) b.textContent = "Accepted";
            else b.textContent = "Not selected";
          });
      } catch (_) {}

      const p = offerPrice || loadOfferPriceForRequestOffer(requestId, offerId);
      if (p) {
        try { saveAcceptedPriceForRequest(requestId, p); } catch (_) {}
      }

      // ✅ Auto-scroll to payment form and pre-fill
      try {
        const fundForm = document.getElementById("fundEscrowForm");
        if (fundForm) {
          if (fundForm.request_id) fundForm.request_id.value = requestId;

          const amt = p || loadAcceptedPriceForRequest(requestId);
          if (fundForm.amount_nzd && amt) {
            fundForm.amount_nzd.value = amt;
            fundForm.amount_nzd.readOnly = true;
          }

          fundForm.scrollIntoView?.({ behavior: "smooth", block: "start" });
        }
      } catch (_) {}

      // Refresh view to update banner
      try {
        const viewForm = document.getElementById("viewRequestForm");
        if (viewForm) viewForm.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      } catch (_) {}

      return;
    }

    btn.disabled = false;
    if (out) setResult(out, alertError(res.error || "Failed"));
  });
}

/* ---------------------------------------------------------
   Stripe return auto-refresh - IMPROVED: Better UX
--------------------------------------------------------- */

function getQueryParam(name) {
  const u = new URL(window.location.href);
  return u.searchParams.get(name);
}

function handlePaidRedirectRefresh() {
  const paid = getQueryParam("paid");
  const requestId = getQueryParam("request_id");
  if (paid !== "1" || !requestId) return;

  // Show success message
  const banner = document.getElementById("senderNextActionBanner");
  if (banner) {
    banner.innerHTML = `
      <div class="alert success">
        <strong>✓ Payment successful</strong>
        <div class="muted" style="margin-top:4px;">Loading your request details...</div>
      </div>
    `;
  }

  const form = document.getElementById("viewRequestForm");
  if (!form) return;

  if (form.request_id) form.request_id.value = requestId;

  // Auto-load request details after payment
  setTimeout(() => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  }, 800);

  setTimeout(() => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  }, 3000);
}

/* ---------------------------------------------------------
   Login + logout - FIXED: dm_user_token
--------------------------------------------------------- */

function setupSenderAuth() {
  const form = document.getElementById("senderLoginForm");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const fd = getFormData(form);
    const phone = String(fd.phone || "").trim();

    const out =
      document.getElementById("senderLoginResult") ||
      document.getElementById("senderAuthHint");

    if (!phone) {
      if (out) setResult(out, alertError("Phone is required."));
      return;
    }

    const res = await api("/users/login", {
      method: "POST",
      role: "sender",
      body: { phone }
    });

    if (!res.ok) {
      if (out) setResult(out, alertError(res.error || "Login failed"));
      setAuthStatus("Not logged in");
      setDashboardVisible(false);
      return;
    }

    // ✅ Save unified auth token
    sessionStorage.setItem("dm_user_token", res.user_token);
    localStorage.setItem("dm_user_token", res.user_token);

    saveUser({ phone });
    setAuthStatus(`Logged in as ${phone}`);
    setDashboardVisible(true);

    if (out) setResult(out, alertSuccess("Logged in"));
    renderRecentRequests();
  });

  const logoutBtn = document.getElementById("senderLogoutBtn");
  if (logoutBtn && !logoutBtn.__bound) {
    logoutBtn.__bound = true;
    logoutBtn.addEventListener("click", () => {
      sessionStorage.removeItem("dm_user_token");
      localStorage.removeItem("dm_user_token");
      setAuthStatus("Not logged in");
      setDashboardVisible(false);
    });
  }
}

/* ---------------------------------------------------------
   Quick buttons (scroll helpers)
--------------------------------------------------------- */

function setupQuickButtons() {
  const payBtn = document.getElementById("senderQuickPayBtn");
  const relBtn = document.getElementById("senderQuickReleaseBtn");
  const viewBtn = document.getElementById("senderQuickViewBtn");
  const copyBtn = document.getElementById("senderQuickCopyBtn");

  if (payBtn && !payBtn.__bound) {
    payBtn.__bound = true;
    payBtn.addEventListener("click", () => {
      const sel = document.getElementById("senderRecentSelect");
      const id = String(sel?.value || "").trim();
      const fundForm = document.getElementById("fundEscrowForm");
      if (fundForm && id) {
        if (fundForm.request_id) fundForm.request_id.value = id;
        const price = loadAcceptedPriceForRequest(id);
        if (fundForm.amount_nzd && price) {
          fundForm.amount_nzd.value = price;
          fundForm.amount_nzd.readOnly = true;
        }
      }
      fundForm?.scrollIntoView?.({ behavior: "smooth", block: "start" });
    });
  }

  if (relBtn && !relBtn.__bound) {
    relBtn.__bound = true;
    relBtn.addEventListener("click", () => {
      const sel = document.getElementById("senderRecentSelect");
      const id = String(sel?.value || "").trim();
      const releaseForm = document.getElementById("releaseEscrowForm");
      if (releaseForm && id) {
        if (releaseForm.request_id) releaseForm.request_id.value = id;
      }
      releaseForm?.scrollIntoView?.({ behavior: "smooth", block: "start" });
    });
  }

  if (viewBtn && !viewBtn.__bound) {
    viewBtn.__bound = true;
    viewBtn.addEventListener("click", () => {
      document.getElementById("viewRequestForm")?.scrollIntoView?.({ behavior: "smooth", block: "start" });
    });
  }

  if (copyBtn && !copyBtn.__bound) {
    copyBtn.__bound = true;
    copyBtn.addEventListener("click", async () => {
      const sel = document.getElementById("senderRecentSelect");
      const id = String(sel?.value || "").trim();
      if (!id) return;
      try { await navigator.clipboard.writeText(id); } catch (_) {}
    });
  }

  const recentSel = document.getElementById("senderRecentSelect");
  if (recentSel && !recentSel.__bound) {
    recentSel.__bound = true;
    recentSel.addEventListener("change", () => {
      const id = String(recentSel.value || "").trim();
      if (!id) return;
      const viewForm = document.getElementById("viewRequestForm");
      if (viewForm && viewForm.request_id) {
        viewForm.request_id.value = id;
        viewForm.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      }
    });
  }
}

/* ---------------------------------------------------------
   Init - FIXED: Check dm_user_token
--------------------------------------------------------- */

export function initSenderPage() {
  //
  // 1. Restore tokens BEFORE anything else
  //
  try {
    // Restore login token
    const s = sessionStorage.getItem("dm_user_token");
    const l = localStorage.getItem("dm_user_token");
    if (!s && l) sessionStorage.setItem("dm_user_token", l);
  } catch (_) {}

  try {
    // Restore per-request sender token (Stripe return)
    const reqId = new URL(window.location.href).searchParams.get("request_id");
    if (reqId) {
      const saved = loadSenderTokenForRequest(reqId);
      if (saved) sessionStorage.setItem("dm_sender_token", saved);
    }
  } catch (_) {}

  //
  // 2. Update UI immediately based on restored token
  // ✅ FIX: Check dm_user_token (not dm_sender_token)
  //
  const tok = getUserToken();
  const u = getSavedUser();

  if (tok) {
    setAuthStatus(u?.phone ? `Logged in as ${u.phone}` : "Logged in");
    setDashboardVisible(true);
  } else {
    setAuthStatus("Not logged in");
    setDashboardVisible(false);
  }

  //
  // 3. Load all functional modules
  //
  setupCreateAcksGate();
  setupCreateRequest();
  setupViewRequest();
  setupFundEscrow();
  setupConfirmRelease();
  setupSenderOffersActions();
  setupQuickButtons();

  // Stripe return auto-refresh
  handlePaidRedirectRefresh();

  //
  // 4. Auth LAST — so it cannot override restored login state
  //
  setupSenderAuth();

  //
  // 5. Render recent requests
  //
  renderRecentRequests();
}
