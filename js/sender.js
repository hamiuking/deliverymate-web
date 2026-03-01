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

// Alias for compatibility with driver.js code patterns
const escapeHtml = safeText;

function setResult(el, html) {
  if (!el) return;
  el.innerHTML = html || "";
}

function setWorking(btn, workingText = "Working…") {
  if (!btn) return () => {};
  const oldText = btn.textContent;
  btn.disabled = true;
  btn.textContent = workingText;
  return (ok) => {
    if (ok) {
      btn.textContent = "Done ✓";
      setTimeout(() => {
        btn.disabled = false;
        btn.textContent = oldText;
      }, 900);
    } else {
      btn.disabled = false;
      btn.textContent = oldText;
    }
  };
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

  // Re-initialize Google Maps autocomplete when dashboard becomes visible
  // (it may have given up retrying if the form was hidden during initial load)
  if (isAuthed) {
    setTimeout(function() {
      if (window.setupGoogleMapsAutocomplete) {
        // Reset retry counter so it tries again fresh
        window.autocompleteRetries = 0;
        window.setupGoogleMapsAutocomplete();
      }
    }, 200);
  }
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

  // Delivery photo (shown when delivered)
  const photoUrl = r?.delivered_photo_url || "";
  const photoHtml = (status === "delivered" && photoUrl) ? `
    <div style="margin-top:14px;">
      <div style="font-size:13px; font-weight:600; margin-bottom:6px; color:#166534;">📸 Proof of Delivery</div>
      <a href="${safeText(photoUrl)}" target="_blank" rel="noopener">
        <img src="${safeText(photoUrl)}" alt="Delivery photo"
          style="max-width:100%; max-height:260px; border-radius:8px; border:1px solid rgba(34,197,94,.3); display:block; cursor:zoom-in;" />
      </a>
      <div class="muted" style="font-size:12px; margin-top:4px;">Click photo to view full size · Link expires in 5 minutes</div>
    </div>
  ` : "";

  // Driver contact info (shown after offer accepted)
  const driverPhone = r?.driver_phone || "";
  const driverName = r?.driver_name || "Driver";
  const contactHtml = (status !== "open" && driverPhone) ? `
    <div style="margin-top:14px; padding:10px; background:rgba(59,130,246,.06); border-radius:6px; border:1px solid rgba(59,130,246,.2);">
      <div style="font-size:13px; font-weight:600; margin-bottom:4px;">📞 Driver Contact</div>
      <div><strong>${escapeHtml(driverName)}</strong></div>
      <div class="muted" style="font-size:13px;">Phone: ${escapeHtml(driverPhone)}</div>
      <div class="muted" style="font-size:12px; margin-top:4px;">Contact the driver directly if you have questions or issues.</div>
    </div>
  ` : "";

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
      ${contactHtml}
      ${photoHtml}
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
  
  // Show/hide report issue card
  updateReportIssueCard(r);
}

function updateReportIssueCard(r) {
  const card = document.getElementById('senderReportIssueCard');
  if (!card) return;
  
  const status = String(r?.status || '').toLowerCase();
  const disputed = r?.disputed === true;
  
  // Show report button only if:
  // - Status is 'delivered'
  // - Not already disputed
  // - Escrow not yet released
  const canReport = status === 'delivered' && !disputed && r?.escrow_status !== 'released';
  
  if (canReport) {
    card.classList.remove('hidden');
    
    // Pre-fill the hidden request ID
    const requestIdInput = document.getElementById('reportIssueRequestId');
    if (requestIdInput) requestIdInput.value = r.id;
  } else {
    card.classList.add('hidden');
  }
  
  // If already disputed, show a notice
  if (disputed) {
    card.classList.remove('hidden');
    card.innerHTML = `
      <h3 style="margin-top:0;">📝 Issue Logged</h3>
      <p class="muted">You reported an issue with this delivery. Your report has been logged for our records. Payment will still release automatically.</p>
      <p><strong>Reported reason:</strong> ${escapeHtml(r.dispute_reason || 'No details provided')}</p>
    `;
  }
}

/* ---------------------------------------------------------
   Report Issue Form Handler
--------------------------------------------------------- */
function setupReportIssueForm() {
  const form = document.getElementById('reportIssueForm');
  if (!form) return;
  
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const result = document.getElementById('reportIssueResult');
    const btn = form.querySelector('button[type="submit"]');
    const done = setWorking(btn, 'Submitting...');
    
    if (result) setResult(result, '');
    
    const requestId = form.request_id.value;
    const description = form.description.value;
    
    if (!requestId || !description) {
      done(false);
      if (result) setResult(result, alertError('Please provide a description'));
      return;
    }
    
    const res = await api(`/requests/${requestId}/report`, {
      method: 'POST',
      role: 'sender',
      body: { description },
    });
    
    done(!!res.ok);
    
    if (res.ok) {
      if (result) setResult(result, alertSuccess(res.message || 'Issue logged. Please contact the driver to resolve.'));
      
      // Refresh the request view to show updated status
      setTimeout(() => {
        const viewForm = document.getElementById('viewRequestForm');
        if (viewForm && viewForm.request_id) {
          viewForm.request_id.value = requestId;
          viewForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        }
      }, 1500);
    } else {
      if (result) setResult(result, alertError(res.error || 'Failed to submit report'));
    }
  });
}

/* ---------------------------------------------------------
   Create request acknowledgement gating
--------------------------------------------------------- */

function setupCreateAcksGate() {
  const btn = document.getElementById("createRequestBtn");
  if (!btn) return;

  const ids = ["sAck1", "sAck2", "sAck3", "sAck4", "sAck5", "sAck6"];
  const boxes = ids.map((id) => document.getElementById(id)).filter(Boolean);

  const refresh = () => {
    const ok = boxes.length === 6 && boxes.every((b) => b.checked);
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
    console.log('[Create Request] Saved user:', u);
    const sender_phone = String(u?.phone || "").trim();
    console.log('[Create Request] Sender phone:', sender_phone);
    
    if (!sender_phone) {
      if (btn) btn.disabled = false;
      
      // Try one more time to sync from driver
      try {
        const driverData = localStorage.getItem("dm_user_driver") || sessionStorage.getItem("dm_user_driver");
        if (driverData) {
          const driver = JSON.parse(driverData);
          console.log('[Create Request] Emergency sync from driver:', driver);
          if (driver.phone) {
            saveUser({
              phone: driver.phone,
              full_name: driver.full_name || driver.name,
              email: driver.email,
            });
            // Retry with new data
            window.location.reload();
            return;
          }
        }
      } catch (_) {}
      
      if (result) setResult(result, alertError("Your login session is missing a phone number. Please log out and log in again."));
      return;
    }

    const pickup_suburb = String(fd.pickup_suburb_only || fd.pickup_suburb || "").trim();
    const dropoff_suburb = String(fd.dropoff_suburb_only || fd.dropoff_suburb || "").trim();
    const item_desc = String(fd.item_desc || "").trim();
    const sender_note = String(fd.sender_note || "").trim();

    if (!pickup_suburb || !dropoff_suburb || !item_desc) {
      if (btn) btn.disabled = false;
      if (result) setResult(result, alertError("From address, to address, and item description are required."));
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
      sender_ack_version: "v1", // Required by backend
      // Phase 4: Google Maps data (if available from autocomplete)
      pickup_address_full: String(fd.pickup_address_full || "").trim() || null,
      pickup_lat: fd.pickup_lat === "" || fd.pickup_lat == null ? null : Number(fd.pickup_lat),
      pickup_lng: fd.pickup_lng === "" || fd.pickup_lng == null ? null : Number(fd.pickup_lng),
      dropoff_address_full: String(fd.dropoff_address_full || "").trim() || null,
      dropoff_lat: fd.dropoff_lat === "" || fd.dropoff_lat == null ? null : Number(fd.dropoff_lat),
      dropoff_lng: fd.dropoff_lng === "" || fd.dropoff_lng == null ? null : Number(fd.dropoff_lng),
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

        // ✅ Auto-fill View form (but don't auto-submit - avoid invalid token error)
        const viewForm = document.getElementById("viewRequestForm");
        if (viewForm && viewForm.request_id) {
          viewForm.request_id.value = requestId;
          // Clear any stale error messages from previous loads
          const viewResult = document.getElementById("viewRequestResult");
          const offersResult = document.getElementById("viewOffersResult");
          if (viewResult) viewResult.innerHTML = "";
          if (offersResult) offersResult.innerHTML = "";
          // Hide details section until user explicitly loads
          const detailsSection = document.getElementById("senderRequestDetails");
          if (detailsSection) detailsSection.classList.add("hidden");
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

      if (result) result.innerHTML = ""; // Clear any previous errors
    } else {
      // ✅ Hide details section on error
      const detailsSection = document.getElementById("senderRequestDetails");
      if (detailsSection) detailsSection.classList.add("hidden");
      
      // ✅ Only show error if user manually clicked "Load Request" (isTrusted = real user click)
      if (result) {
        if (e.isTrusted) {
          setResult(result, alertError(req.error || "Failed to load request"));
        } else {
          result.innerHTML = ""; // Silent fail on auto-triggers
        }
      }
      
      // Clear banner on error
      updateNextActionBanner(null);
    }

    renderOffers(offers, req.request);
    renderHistory(hist, req.request);

    if (offersResult) {
      // ✅ Only show offers error on manual submit
      if (e.isTrusted) {
        setResult(offersResult, offers.ok ? "" : alertError(offers.error || "Failed to load offers"));
      } else {
        offersResult.innerHTML = "";
      }
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
  // --- Registration form ---
  const regForm = document.getElementById("senderRegForm");
  const regResult = document.getElementById("senderRegResult");

  if (regForm) {
    regForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = getFormData(regForm);
      const phone = String(fd.phone || "").trim();
      const invite_code = String(fd.invite_code || "").trim();
      const full_name = String(fd.full_name || "").trim();
      const email = String(fd.email || "").trim() || undefined;

      if (!phone) {
        if (regResult) setResult(regResult, alertError("Phone is required."));
        return;
      }
      if (!invite_code) {
        if (regResult) setResult(regResult, alertError("Invite code is required."));
        return;
      }

      const btn = regForm.querySelector("button[type=submit]");
      const done = setWorking(btn, "Registering...");

      const res = await api("/users/register", {
        method: "POST",
        role: "sender",
        body: { phone, invite_code, full_name, ...(email && { email }) },
      });

      done(!!res.ok);

      if (!res.ok) {
        if (regResult) setResult(regResult, alertError(res.error || "Registration failed"));
        return;
      }

      // Save token and log in automatically
      sessionStorage.setItem("dm_user_token", res.user_token);
      localStorage.setItem("dm_user_token", res.user_token);
      saveUser({ phone, email });
      setAuthStatus(`Logged in as ${phone}`);
      setDashboardVisible(true);
      if (regResult) setResult(regResult, alertSuccess("Registered and logged in!"));
      renderRecentRequests();
      setTimeout(() => renderSenderActiveRequests(), 500);
    });
  }

  // --- Login form ---
  const form = document.getElementById("senderLoginForm");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const fd = getFormData(form);
    const phone = String(fd.phone || "").trim();
    const email = String(fd.email || "").trim() || undefined;

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
      body: { phone, ...(email && { email }) }
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
    // Fetch profile silently to pre-fill pickup suburb and refresh snapshot if open
    try { loadSenderProfileSnapshot(); } catch (_) {}
  });

  const logoutBtn = document.getElementById("senderLogoutBtn");
  if (logoutBtn && !logoutBtn.__bound) {
    logoutBtn.__bound = true;
    logoutBtn.addEventListener("click", () => {
      sessionStorage.removeItem("dm_user_token");
      localStorage.removeItem("dm_user_token");
      // Clear BOTH sender and driver user data to prevent cross-contamination
      localStorage.removeItem("dm_sender_user");
      localStorage.removeItem("dm_user_driver"); // FIXED: correct key
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
   Active Requests - Show requests needing action at top of dashboard
--------------------------------------------------------- */

async function renderSenderActiveRequests() {
  const listEl = document.getElementById("senderActiveRequestsList");
  const countEl = document.getElementById("senderActiveRequestsCount");
  if (!listEl) return;

  listEl.innerHTML = `<div class="muted">Loading...</div>`;

  const res = await api("/sender/requests", { method: "GET", role: "sender" });
  if (!res || !res.ok) {
    listEl.innerHTML = `<div class="muted">No active requests yet. Create a delivery request below to get started!</div>`;
    if (countEl) countEl.textContent = "No active requests.";
    return;
  }

  const all = Array.isArray(res.requests) ? res.requests : [];

  // Filter to only requests that need action
  const active = all.filter(r => {
    const status = String(r?.status || "").toLowerCase();
    const escrowStatus = String(r?.escrow_status || "none").toLowerCase();
    return !["cancelled", "released", "completed"].includes(status) &&
           !(status === "delivered" && escrowStatus === "released");
  });

  if (active.length === 0) {
    listEl.innerHTML = `<div class="muted">No active requests. Create a new delivery request below!</div>`;
    if (countEl) countEl.textContent = "No active requests.";
    return;
  }

  // Count needs-action vs waiting
  const needsAction = active.filter(r => {
    const status = String(r?.status || "").toLowerCase();
    const escrowStatus = String(r?.escrow_status || "none").toLowerCase();
    return (status === "open" && (r.offers_count > 0 || r.has_offers)) ||
           (status === "accepted" && escrowStatus === "none") ||
           (status === "delivered" && escrowStatus === "pending_release");
  });

  if (countEl) {
    if (needsAction.length > 0) {
      countEl.textContent = `${needsAction.length} request${needsAction.length === 1 ? '' : 's'} need${needsAction.length === 1 ? 's' : ''} your attention!`;
    } else {
      countEl.textContent = `${active.length} active request${active.length === 1 ? '' : 's'} in progress.`;
    }
  }

  const MAX_DISPLAY = 5;
  const displayed = active.slice(0, MAX_DISPLAY);
  const remaining = active.length - displayed.length;

  listEl.innerHTML = "";

  for (const r of displayed) {
    const id = String(r.id || "");
    const status = String(r.status || "").toLowerCase();
    const escrowStatus = String(r.escrow_status || "none").toLowerCase();
    const pickup = safeText(r.pickup_suburb || "");
    const dropoff = safeText(r.dropoff_suburb || "");
    const offersCount = r.offers_count || r.offers?.length || 0;

    const card = document.createElement("div");
    card.className = "card";
    card.style.margin = "8px 0";
    card.style.padding = "12px";

    // Determine state message, action button, and card colour
    let statusMessage = "";
    let actionButton = "";
    let cardStyle = "";

    // State: Open, no offers yet
    if (status === "open" && offersCount === 0) {
      statusMessage = `⏳ <strong>Waiting for driver offers</strong>`;
      cardStyle = "background: rgba(148,163,184,.08); border-color: rgba(148,163,184,.3);";
    }

    // State: Open, has offers - needs action!
    else if (status === "open" && offersCount > 0) {
      statusMessage = `🙋 <strong>${offersCount} offer${offersCount === 1 ? '' : 's'} received!</strong> — Review and accept`;
      cardStyle = "background: rgba(245,158,11,.05); border-color: rgba(245,158,11,.4);";
      actionButton = `<button class="btn activeReqViewBtn" data-id="${safeText(id)}" style="margin-top:10px; width:100%;">Review Offers</button>`;
    }

    // State: Accepted, needs payment - needs action!
    else if (status === "accepted" && escrowStatus === "none") {
      statusMessage = `💳 <strong>Offer accepted!</strong> — Payment required to proceed`;
      cardStyle = "background: rgba(245,158,11,.05); border-color: rgba(245,158,11,.4);";
      actionButton = `<button class="btn activeReqFundBtn" data-id="${safeText(id)}" style="margin-top:10px; width:100%; background:#0284c7; border-color:#0284c7;">💳 Pay with Stripe</button>`;
    }

    // State: Funded, waiting for pickup
    else if (status === "accepted" && escrowStatus === "funded") {
      statusMessage = `✓ <strong>Payment confirmed</strong> — Waiting for driver pickup`;
      cardStyle = "background: rgba(59,130,246,.05); border-color: rgba(59,130,246,.3);";
    }

    // State: Picked up
    else if (status === "picked_up") {
      statusMessage = `🚗 <strong>Item picked up!</strong> — On the way to drop-off`;
      cardStyle = "background: rgba(59,130,246,.05); border-color: rgba(59,130,246,.3);";
    }

    // State: Delivered, confirm release - needs action!
    else if (status === "delivered" && escrowStatus === "pending_release") {
      statusMessage = `📦 <strong>Item delivered!</strong> — Confirm to release payment`;
      cardStyle = "background: rgba(34,197,94,.05); border-color: rgba(34,197,94,.4);";
      actionButton = `<button class="btn activeReqReleaseBtn" data-id="${safeText(id)}" style="margin-top:10px; width:100%; background:#16a34a; border-color:#16a34a;">✓ Confirm Delivery & Release Payment</button>`;
    }

    // Determine if cancellable and what warning to show
    let cancelButton = "";
    if (status === "open") {
      const warning = offersCount > 0
        ? `This will reject ${offersCount} pending offer${offersCount === 1 ? '' : 's'}.`
        : "";
      cancelButton = `<button class="btn activeReqCancelBtn" data-id="${safeText(id)}" data-warning="${safeText(warning)}" style="margin-top:8px; width:100%; background:transparent; border-color:#dc2626; color:#dc2626;">✕ Cancel Request</button>`;
    } else if (status === "accepted" && escrowStatus === "none") {
      cancelButton = `<button class="btn activeReqCancelBtn" data-id="${safeText(id)}" data-warning="The driver's offer will be cancelled and they will be notified by email." style="margin-top:8px; width:100%; background:transparent; border-color:#dc2626; color:#dc2626;">✕ Cancel Request</button>`;
    } else if (status === "accepted" && escrowStatus === "funded") {
      cancelButton = `<div class="muted" style="margin-top:8px; font-size:13px;">⚠️ Payment already made — to cancel please contact support.</div>`;
    } else if (status === "picked_up") {
      cancelButton = `<div class="muted" style="margin-top:8px; font-size:13px;">⚠️ Item is in transit — to cancel please contact support.</div>`;
    }

    card.style.cssText += cardStyle;
    card.innerHTML = `
      <div>
        <div style="font-weight:700;">Request #${safeText(id)}</div>
        <div style="margin-top:4px;">${pickup} → ${dropoff}</div>
        <div style="margin-top:8px; font-size:14px;">${statusMessage}</div>
        ${actionButton}
        ${cancelButton}
      </div>
    `;

    listEl.appendChild(card);
  }

  // Show "X more" if capped
  if (remaining > 0) {
    const moreEl = document.createElement("div");
    moreEl.className = "muted";
    moreEl.style.cssText = "text-align:center; padding:8px; font-size:13px;";
    moreEl.textContent = `+ ${remaining} more request${remaining === 1 ? '' : 's'} — scroll down to "All My Requests" to view`;
    listEl.appendChild(moreEl);
  }

  // Warn when approaching the 10-request limit
  if (active.length >= 8) {
    const warnEl = document.createElement("div");
    warnEl.style.cssText = "margin-top:8px; padding:10px 12px; background:rgba(245,158,11,.08); border:1px solid rgba(245,158,11,.3); border-radius:6px; font-size:13px; color:#92400e;";
    if (active.length >= 10) {
      warnEl.innerHTML = `⚠️ <strong>Request limit reached (${active.length}/10).</strong> You must complete or cancel a request before creating new ones.`;
    } else {
      warnEl.innerHTML = `⚠️ You have ${active.length}/10 active requests. Complete or cancel requests to stay under the limit.`;
    }
    listEl.appendChild(warnEl);
  }
  listEl.onclick = async (e) => {
    const viewBtn = e.target?.closest?.(".activeReqViewBtn");
    const fundBtn = e.target?.closest?.(".activeReqFundBtn");
    const releaseBtn = e.target?.closest?.(".activeReqReleaseBtn");
    const cancelBtn = e.target?.closest?.(".activeReqCancelBtn");

    // Cancel request
    if (cancelBtn) {
      const id = cancelBtn.dataset.id;
      const warning = cancelBtn.dataset.warning;

      const confirmMsg = warning
        ? `Cancel Request #${id}?\n\n${warning}`
        : `Cancel Request #${id}? This cannot be undone.`;

      if (!confirm(confirmMsg)) return;

      cancelBtn.disabled = true;
      cancelBtn.textContent = "Cancelling...";

      const res = await api(`/requests/${id}/status`, {
        method: "PATCH",
        role: "sender",
        body: { status: "cancelled" },
      });

      if (res.ok) {
        // Refresh active requests to remove cancelled card
        renderSenderActiveRequests();
        // Also refresh view if this request was loaded
        const viewForm = document.getElementById("viewRequestForm");
        if (viewForm?.request_id?.value === id) {
          viewForm.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
        }
      } else {
        alert(res.error || "Failed to cancel request");
        cancelBtn.disabled = false;
        cancelBtn.textContent = "✕ Cancel Request";
      }
    }

    // Review Offers → load the request in View section
    if (viewBtn) {
      const id = viewBtn.dataset.id;
      const viewForm = document.getElementById("viewRequestForm");
      if (viewForm) {
        viewForm.request_id.value = id;
        viewForm.scrollIntoView({ behavior: "smooth", block: "start" });
        viewForm.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      }
    }

    // Pay → auto-fill and submit fund form
    if (fundBtn) {
      const id = fundBtn.dataset.id;
      const fundForm = document.getElementById("fundEscrowForm");
      if (fundForm) {
        if (fundForm.request_id) fundForm.request_id.value = id;
        const price = loadAcceptedPriceForRequest(id);
        if (fundForm.amount_nzd && price) {
          fundForm.amount_nzd.value = price;
          fundForm.amount_nzd.readOnly = true;
        }
        fundForm.scrollIntoView({ behavior: "smooth", block: "start" });
        setTimeout(() => {
          fundForm.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
        }, 300);
      }
    }

    // Confirm release → scroll to View Request Details to see full context
    if (releaseBtn) {
      const id = releaseBtn.dataset.id;
      
      // Load the request in View Request Details section
      const viewForm = document.getElementById("viewRequestForm");
      if (viewForm) {
        viewForm.request_id.value = id;
        
        // Scroll to View Request Details section
        const viewSection = viewForm.closest('section');
        if (viewSection) {
          viewSection.scrollIntoView({ behavior: "smooth", block: "start" });
        }
        
        // Auto-load the request to show delivery photo, report card, and confirm button
        setTimeout(() => {
          viewForm.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
        }, 300);
      }
    }
  };
}

/* ---------------------------------------------------------
   Sender Profile section
   - Loads current profile from GET /users/me on open
   - senderBasicProfileForm → PATCH /users/me (name + email only)
   Senders cannot change phone (identity) and have no vehicle/licence fields.
--------------------------------------------------------- */

async function loadSenderProfileSnapshot() {
  const snapshot = document.getElementById("senderProfileSnapshot");
  if (!snapshot) {
    console.warn('[Profile] Snapshot element not found in DOM');
    return;
  }

  // Show spinner while loading
  snapshot.innerHTML = `<span class="muted">Loading profile…</span>`;

  // Guard: don't call if no user token available
  const tok = getUserToken();
  if (!tok) {
    console.warn('[Profile] No user token available');
    snapshot.innerHTML = `<span class="muted">Sign in to view your profile.</span>`;
    return;
  }

  console.log('[Profile] Fetching from GET /users/me...');
  const res = await api("/users/me", { method: "GET", role: "sender" });
  console.log('[Profile] Response:', res);

  if (!res || !res.ok || !res.user) {
    const errorMsg = res && res.error ? escapeHtml(res.error) : 'Unknown error';
    console.error('[Profile] Failed to load:', errorMsg, res);
    snapshot.innerHTML = `<span style="color:#dc2626;">Unable to load profile: ${errorMsg}. Check browser console for details.</span>`;
    return;
  }

  const u = res.user;

  // Pre-fill form fields
  const nameInput = document.getElementById("senderProfileName");
  const emailInput = document.getElementById("senderProfileEmail");
  const addressInput = document.getElementById("senderProfileAddress");
  if (nameInput && u.full_name) nameInput.value = u.full_name;
  if (emailInput && u.email) emailInput.value = u.email;
  if (addressInput && u.default_address) addressInput.value = u.default_address;

  // Pre-fill pickup suburb if address is saved and field is currently empty
  prefillPickupSuburb(u.default_address);

  snapshot.innerHTML = `
    <div style="display:grid; gap:6px; font-size:14px; padding:12px; background:rgba(0,0,0,.03); border-radius:8px; border:1px solid rgba(0,0,0,.06);">
      <div><strong>Name:</strong> ${escapeHtml(u.full_name || "—")}</div>
      <div><strong>Phone:</strong> ${escapeHtml(u.phone || "—")}</div>
      <div><strong>Email:</strong> ${escapeHtml(u.email || "—")}</div>
      <div><strong>Default address:</strong> ${escapeHtml(u.default_address || "—")}</div>
    </div>
  `;
}

/* -------------------------------------------------------------
   Extract suburb from a full address and pre-fill the pickup
   suburb field if it is currently empty.
   Strategy: take the last comma-separated segment that looks
   like a suburb (not a postcode, not "New Zealand").
   e.g. "123 Queen St, Ponsonby, Auckland" → "Ponsonby"
        "45 Main Rd, Tauranga" → "Tauranga"
        "Ponsonby" → "Ponsonby"
------------------------------------------------------------- */
function extractSuburb(address) {
  if (!address) return "";
  const parts = address.split(",").map(s => s.trim()).filter(Boolean);
  if (parts.length === 0) return "";
  // Walk from the end, skip postcodes (all digits) and country names
  const skip = new Set(["new zealand", "nz"]);
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    if (/^\d+$/.test(p)) continue;          // postcode
    if (skip.has(p.toLowerCase())) continue; // country
    if (i === 0 && parts.length > 1) continue; // likely street number+name
    return p;
  }
  // Fallback: return last non-empty part
  return parts[parts.length - 1];
}

function prefillPickupSuburb(defaultAddress) {
  const field = document.getElementById("createPickupSuburb");
  const hint = document.getElementById("pickupSuburbHint");
  if (!field) return;
  // Only pre-fill if field is currently empty — never overwrite what the sender typed
  if (field.value && field.value.trim()) return;
  const suburb = extractSuburb(defaultAddress);
  if (!suburb) return;
  field.value = suburb;
  if (hint) hint.style.display = "block";
}

function setupSenderProfile() {
  // Load profile when the collapsible section is opened
  const details = document.getElementById("senderProfileDetails");
  if (details) {
    details.addEventListener("toggle", () => {
      if (details.open) {
        loadSenderProfileSnapshot();
        checkSenderDriverStatus(); // Check if already applied
      }
    });
  }

  // Basic profile form (name + email)
  const form = document.getElementById("senderBasicProfileForm");
  const result = document.getElementById("senderBasicProfileResult");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = form.querySelector("button[type=submit]");
    const done = setWorking(btn, "Saving…");
    if (result) setResult(result, "");

    const fd = new FormData(form);
    const full_name = String(fd.get("full_name") || "").trim();
    const email = String(fd.get("email") || "").trim();
    const default_address = String(fd.get("default_address") || "").trim();

    if (!full_name && !email && !default_address) {
      done(false);
      if (result) setResult(result, alertError("Please enter at least one field to update."));
      return;
    }

    const body = {};
    if (full_name) body.full_name = full_name;
    if (email) body.email = email;
    // Always send default_address if the field exists — allows clearing it
    body.default_address = default_address || null;

    const res = await api("/users/me", {
      method: "PATCH",
      role: "sender",
      body,
    });

    done(!!res.ok);
    if (res.ok) {
      if (result) setResult(result, alertSuccess("Contact details saved."));
      const u = getSavedUser() || {};
      if (full_name) u.full_name = full_name;
      if (email) u.email = email;
      saveUser(u);
      // Re-run pre-fill in case address changed
      if (default_address) prefillPickupSuburb(default_address);
      loadSenderProfileSnapshot();
    } else {
      if (result) setResult(result, alertError(res.error || "Failed to save."));
    }
  });

  // Apply to be driver form
  setupSenderDriverApplication();
}

/* ---------------------------------------------------------
   Sender → Driver Application
--------------------------------------------------------- */
async function checkSenderDriverStatus() {
  const statusEl = document.getElementById("senderDriverAppStatus");
  if (!statusEl) return;

  const res = await api("/users/me", { method: "GET", role: "sender" });
  if (!res.ok || !res.user) return;

  const driverStatus = String(res.user.driver_status || "").toLowerCase();
  
  if (driverStatus === "approved") {
    statusEl.innerHTML = `
      <div style="padding:12px; background:rgba(34,197,94,.1); border-radius:6px; border:1px solid rgba(34,197,94,.3);">
        <div style="font-weight:700; color:#166534;">✓ You're approved as a driver!</div>
        <div class="muted" style="margin-top:4px;">Visit the <a href="/driver.html">Driver Dashboard</a> to browse jobs and make offers.</div>
      </div>
    `;
    // Hide the application form
    const form = document.getElementById("senderApplyDriverForm");
    if (form) form.style.display = "none";
  } else if (driverStatus === "pending" || driverStatus === "pending_review") {
    statusEl.innerHTML = `
      <div style="padding:12px; background:rgba(245,158,11,.1); border-radius:6px; border:1px solid rgba(245,158,11,.3);">
        <div style="font-weight:700; color:#92400e;">⏳ Application pending</div>
        <div class="muted" style="margin-top:4px;">Your driver application is under review. You'll be notified when approved (usually within 24 hours).</div>
      </div>
    `;
    // Hide the application form
    const form = document.getElementById("senderApplyDriverForm");
    if (form) form.style.display = "none";
  } else if (driverStatus === "disabled") {
    statusEl.innerHTML = `
      <div style="padding:12px; background:rgba(239,68,68,.1); border-radius:6px; border:1px solid rgba(239,68,68,.3);">
        <div style="font-weight:700; color:#991b1b;">⚠️ Driver account disabled</div>
        <div class="muted" style="margin-top:4px;">Please contact admin@deliverymate.nz for more information.</div>
      </div>
    `;
    const form = document.getElementById("senderApplyDriverForm");
    if (form) form.style.display = "none";
  }
}

function setupSenderDriverApplication() {
  const form = document.getElementById("senderApplyDriverForm");
  const result = document.getElementById("senderApplyDriverResult");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const btn = document.getElementById("senderApplyDriverBtn");
    const consent = document.getElementById("senderDriverConsent");
    
    if (!consent || !consent.checked) {
      if (result) setResult(result, alertError("Please confirm the consent checkbox."));
      return;
    }

    const done = setWorking(btn, "Submitting…");
    if (result) setResult(result, "");

    // Get form data
    const vehiclePlate = document.getElementById("senderDriverVehiclePlate")?.value.trim();
    const licenseNumber = document.getElementById("senderDriverLicenseNumber")?.value.trim();
    const wofExpiry = document.getElementById("senderDriverWofExpiry")?.value;
    const licenseFrontFile = document.getElementById("senderDriverLicenseFront")?.files?.[0];
    const licenseBackFile = document.getElementById("senderDriverLicenseBack")?.files?.[0];

    // Validation
    if (!vehiclePlate || !licenseNumber || !wofExpiry) {
      done(false);
      if (result) setResult(result, alertError("Please fill in all required fields."));
      return;
    }

    if (!licenseFrontFile || !licenseBackFile) {
      done(false);
      if (result) setResult(result, alertError("Please upload both driver licence photos."));
      return;
    }

    try {
      // Convert images to base64
      const frontBase64 = await fileToDataUrl(licenseFrontFile);
      const backBase64 = await fileToDataUrl(licenseBackFile);

      // Submit application
      const res = await api("/users/me", {
        method: "PATCH",
        role: "sender",
        body: {
          vehicle_plate: vehiclePlate,
          license_number: licenseNumber,
          wof_expiry: wofExpiry,
          driver_license_front_base64: frontBase64,
          driver_license_back_base64: backBase64,
          apply_as_driver: true, // Signal to backend to set driver_status = pending
        },
      });

      done(!!res.ok);

      if (res.ok) {
        if (result) setResult(result, alertSuccess("Driver application submitted! Admin will review within 24 hours."));
        // Refresh status
        setTimeout(() => {
          checkSenderDriverStatus();
        }, 1500);
      } else {
        if (result) setResult(result, alertError(res.error || "Failed to submit application."));
      }
    } catch (err) {
      done(false);
      if (result) setResult(result, alertError(err?.message || "Failed to process images."));
    }
  });
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

  // NEW: Auto-sync between driver and sender user data for seamless cross-login
  // This allows drivers to create requests without logging in again
  try {
    const senderUser = getSavedUser();
    
    // Try both localStorage and sessionStorage for driver data
    let driverUserData = localStorage.getItem("dm_user_driver");
    if (!driverUserData) {
      driverUserData = sessionStorage.getItem("dm_user_driver");
    }
    
    console.log('[Sender] Driver user data found:', !!driverUserData);
    
    if (driverUserData) {
      const driverUser = JSON.parse(driverUserData);
      console.log('[Sender] Driver user object:', driverUser);
      
      // If no sender user, OR sender user has different phone, sync from driver
      if (!senderUser || senderUser.phone !== driverUser.phone) {
        // Copy driver user to sender storage (same person, different role)
        const userData = {
          phone: driverUser.phone,
          full_name: driverUser.full_name || driverUser.name || driverUser.full_name,
          email: driverUser.email,
        };
        console.log('[Sender] Saving user data:', userData);
        saveUser(userData);
        console.log('[Sender] Auto-synced user from driver session:', driverUser.phone);
      } else {
        console.log('[Sender] Sender user already exists with same phone:', senderUser.phone);
      }
    } else {
      console.log('[Sender] No driver user data found to sync');
    }
  } catch (e) {
    console.error('[Sender] Auto-sync error:', e);
  }

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
  setupSenderProfile();         // ← NEW: profile section
  setupReportIssueForm();       // ← Report issue functionality

  // Stripe return auto-refresh
  handlePaidRedirectRefresh();

  //
  // 4. Auth LAST — so it cannot override restored login state
  //
  setupSenderAuth();

  //
  // 5. Render recent requests + active requests
  //
  renderRecentRequests();
  
  // Pre-fill From address from saved address + load profile snapshot
  // Small delay so token is fully ready before first API call
  setTimeout(() => {
    renderSenderActiveRequests();
    try { loadSenderProfileSnapshot(); } catch (_) {}
  }, 500);
  
  setInterval(() => {
    try { renderSenderActiveRequests(); } catch (_) {}
  }, 30000);

  //
  // 6. Cross-tab logout detection
  // If user logs out from driver page (or another tab), detect it here
  //
  window.addEventListener('storage', (e) => {
    if (e.key === 'dm_user_token' && !e.newValue) {
      // Token was removed (logout happened in another tab)
      console.log('[Sender] Detected logout in another tab, logging out...');
      sessionStorage.removeItem('dm_user_token');
      setAuthStatus('Not logged in');
      setDashboardVisible(false);
    }
  });
}

/* -------------------------------------------------------------
   Google Maps Places Autocomplete
   Using new PlaceAutocompleteElement (recommended by Google)
------------------------------------------------------------- */
let autocompleteRetries = 0;
window.autocompleteRetries = 0; // expose for reset
const MAX_AUTOCOMPLETE_RETRIES = 20; // 10 seconds max

window.setupGoogleMapsAutocomplete = function() {
  // Sync reset from external caller (e.g. setDashboardVisible)
  if (window.autocompleteRetries === 0) autocompleteRetries = 0;
  console.log('[Google Maps] Initializing autocomplete... (attempt ' + (autocompleteRetries + 1) + ')');
  
  if (autocompleteRetries >= MAX_AUTOCOMPLETE_RETRIES) {
    console.error('[Google Maps] Failed to initialize after ' + MAX_AUTOCOMPLETE_RETRIES + ' attempts. Autocomplete disabled.');
    return;
  }
  
  const pickupInput = document.getElementById('createPickupSuburb');
  const dropoffInput = document.getElementById('createDropoffSuburb');
  
  if (!pickupInput || !dropoffInput) {
    console.warn('[Google Maps] Form inputs not found yet, retrying in 500ms...');
    autocompleteRetries++;
    setTimeout(window.setupGoogleMapsAutocomplete, 500);
    return;
  }

  // Check if inputs are visible (important for Safari)
  if (pickupInput.offsetParent === null || dropoffInput.offsetParent === null) {
    console.warn('[Google Maps] Form inputs not visible yet, retrying in 500ms...');
    autocompleteRetries++;
    setTimeout(window.setupGoogleMapsAutocomplete, 500);
    return;
  }

  // Check if google.maps.places is loaded
  if (!window.google || !window.google.maps || !window.google.maps.places) {
    console.warn('[Google Maps] Places library not loaded yet, retrying...');
    autocompleteRetries++;
    setTimeout(window.setupGoogleMapsAutocomplete, 500);
    return;
  }
  
  // Restrict to New Zealand only
  const options = {
    componentRestrictions: { country: 'nz' },
    fields: ['address_components', 'geometry', 'formatted_address', 'name'],
  };
  
  try {
    // Use the recommended class (still works the same way)
    const pickupAutocomplete = new google.maps.places.Autocomplete(pickupInput, options);
    const dropoffAutocomplete = new google.maps.places.Autocomplete(dropoffInput, options);
    
    // When user selects a place from pickup dropdown
    pickupAutocomplete.addListener('place_changed', () => {
      const place = pickupAutocomplete.getPlace();
      if (!place || !place.geometry) {
        console.warn('[Google Maps] No geometry for pickup place');
        return;
      }
      
      handlePlaceSelection(place, 'pickup');
    });
    
    // When user selects a place from dropoff dropdown
    dropoffAutocomplete.addListener('place_changed', () => {
      const place = dropoffAutocomplete.getPlace();
      if (!place || !place.geometry) {
        console.warn('[Google Maps] No geometry for dropoff place');
        return;
      }
      
      handlePlaceSelection(place, 'dropoff');
    });
    
    console.log('[Google Maps] Autocomplete initialized ✓');
    autocompleteRetries = 0; // Reset counter on success
  } catch (error) {
    console.error('[Google Maps] Failed to initialize autocomplete:', error);
    console.warn('[Google Maps] Retrying in 1 second...');
    autocompleteRetries++;
    setTimeout(window.setupGoogleMapsAutocomplete, 1000);
  }
};

function handlePlaceSelection(place, type) {
  const prefix = type; // 'pickup' or 'dropoff'
  
  // Extract suburb from address_components
  // In NZ: usually "locality" or "sublocality" or "administrative_area_level_2"
  let suburb = '';
  const components = place.address_components || [];
  
  for (const comp of components) {
    if (comp.types.includes('locality')) {
      suburb = comp.long_name;
      break;
    }
    if (comp.types.includes('sublocality')) {
      suburb = comp.long_name;
      break;
    }
    if (comp.types.includes('administrative_area_level_2')) {
      suburb = comp.long_name;
      break;
    }
  }
  
  // Fallback: use the first part of formatted_address
  if (!suburb && place.formatted_address) {
    suburb = place.formatted_address.split(',')[0].trim();
  }
  
  // Show FULL ADDRESS in visible field (what sender sees)
  const visibleInput = document.getElementById(
    type === 'pickup' ? 'createPickupSuburb' : 'createDropoffSuburb'
  );
  if (visibleInput && place.formatted_address) {
    visibleInput.value = place.formatted_address;
  }
  
  // Store suburb (for public job listings), full address + coordinates in hidden fields
  const suburbInput = document.getElementById(`${prefix}SuburbOnly`);
  const fullAddrInput = document.getElementById(`${prefix}AddressFull`);
  const latInput = document.getElementById(`${prefix}Lat`);
  const lngInput = document.getElementById(`${prefix}Lng`);
  
  if (suburbInput) suburbInput.value = suburb || '';
  if (fullAddrInput) fullAddrInput.value = place.formatted_address || '';
  if (latInput) latInput.value = place.geometry.location.lat();
  if (lngInput) lngInput.value = place.geometry.location.lng();
  
  console.log(`[Google Maps] ${type} selected:`, {
    suburb,
    fullAddress: place.formatted_address,
    lat: place.geometry.location.lat(),
    lng: place.geometry.location.lng(),
  });
}
