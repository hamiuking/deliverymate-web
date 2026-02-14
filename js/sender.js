// public/js/sender.js
// Full replacement (minimal additive UX improvements)
// - Adds a clear status summary (pill + timeline + next action) into #senderReqSummary when viewing a request
// - Keeps all existing working flows intact

import { api } from "./api.js";
import { $, pretty } from "./utils.js";
import { alertSuccess, alertError } from "./components/alerts.js";
import { getFormData } from "./components/forms.js";
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
   Local storage keys (scoped per sender phone, not per device)
--------------------------------------------------------- */

const SENDER_USER_KEY = "dm_sender_user";
const SENDER_TOKEN_KEY = "dm_sender_token"; // sessionStorage
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

function senderInviteKey(phone) {
  return `dm_sender_invite_code:${String(phone || "").trim()}`;
}
function saveInviteCodeForPhone(phone, inviteCode) {
  const p = String(phone || "").trim();
  const c = String(inviteCode || "").trim();
  if (!p || !c) return;
  try { localStorage.setItem(senderInviteKey(p), c); } catch (_) {}
}
function loadInviteCodeForPhone(phone) {
  const p = String(phone || "").trim();
  if (!p) return "";
  try { return localStorage.getItem(senderInviteKey(p)) || ""; } catch (_) { return ""; }
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
   Auth helpers
--------------------------------------------------------- */

function setAuthStatus(text) {
  const el = document.getElementById("senderAuthStatus");
  if (el) el.textContent = text || "";
}

function getSessionToken() {
  return sessionStorage.getItem(SENDER_TOKEN_KEY) || "";
}

function setSessionToken(token) {
  if (!token) {
    sessionStorage.removeItem(SENDER_TOKEN_KEY);
    return;
  }
  sessionStorage.setItem(SENDER_TOKEN_KEY, token);
}

function setDashboardVisible(isAuthed) {
  const dash = document.getElementById("senderDashboard");
  const auth = document.getElementById("senderAuthCard");
  if (dash) dash.classList.toggle("hidden", !isAuthed);
  if (auth) auth.classList.toggle("hidden", !!isAuthed);
}

/* ---------------------------------------------------------
   Recent requests UI
--------------------------------------------------------- */

function addRecentRequest(requestId) {
  const id = String(requestId || "").trim();
  if (!id) return;
  const list = loadSenderRecent();
  const next = [id, ...list.filter((x) => String(x) !== id)].slice(0, 12);
  saveSenderRecent(next);
}

function renderRecentRequests() {
  const box = document.getElementById("senderRecentRequests");
  const sel = document.getElementById("senderRecentSelect");
  if (!box || !sel) return;

  const list = loadSenderRecent();
  if (!list.length) {
    box.classList.add("hidden");
    return;
  }

  box.classList.remove("hidden");
  sel.innerHTML = `<option value="">Select a recent request…</option>`;
  for (const id of list) {
    sel.insertAdjacentHTML("beforeend", `<option value="${safeText(id)}">Request #${safeText(id)}</option>`);
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

  box.innerHTML = `
    <div class="card compact">
      <div style="display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap;">
        <div>
          <div style="font-weight:700;">Request #${safeText(r?.id || "")}</div>
          <div class="muted">${safeText(r?.pickup_suburb || "")}${r?.dropoff_suburb ? ` → ${safeText(r.dropoff_suburb)}` : ""}</div>
        </div>
        <div>${pill}</div>
      </div>
      <div style="margin-top:10px;">${tl}</div>
      <div style="margin-top:10px;" class="muted"><strong>Next:</strong> ${safeText(next || "")}</div>
    </div>
  `;
}

function renderNextActionFromRequest(r) {
  const el = document.getElementById("senderNextAction");
  if (!el) return;
  const next = nextActionText(r);
  el.textContent = next || "";
}

/* ---------------------------------------------------------
   Offer list + history
--------------------------------------------------------- */

function renderSenderOffersList(requestId, offersObj, reqObj) {
  const list = document.getElementById("senderOffersList");
  if (!list) return;
  list.innerHTML = "";

  if (!offersObj || !offersObj.ok) {
    list.insertAdjacentHTML("beforeend", alertError(offersObj?.error || "Failed to load offers"));
    return;
  }

  const offers = Array.isArray(offersObj.offers) ? offersObj.offers : [];
  if (!offers.length) {
    list.insertAdjacentHTML("beforeend", `<div class="muted">No offers yet.</div>`);
    return;
  }

  const reqStatus = String(reqObj?.status || "").toLowerCase();
  const requestAlreadyAccepted =
    reqStatus === "accepted" || reqStatus === "picked_up" || reqStatus === "delivered" || reqStatus === "completed";

  for (const o of offers) {
    const driver = safeText(o.driver_name || o.driver_phone || "Driver");
    const rawPrice = offerPriceFromOfferObj(o);
    const price = rawPrice ? safeText(rawPrice) : "";
    const offerId = safeText(o.id);

    // Persist per-offer price for later auto-fill when this offer is accepted
    try { if (rawPrice) saveOfferPriceForRequestOffer(requestId, o.id, rawPrice); } catch (_) {}
    const status = safeText(o.status || "");

    list.insertAdjacentHTML("beforeend", `
      <div class="card compact" style="margin-top:10px;">
        <div style="display:flex; justify-content:space-between; gap:10px; align-items:center;">
          <div>
            <div><strong>${driver}</strong> ${status ? `<span class="muted">(${status})</span>` : ""}</div>
            <div class="muted">Offer #${offerId}${price ? ` · NZD ${price}` : ""}</div>
          </div>
          <div class="btn-row" style="justify-content:flex-end;">
            <button class="btn senderOfferAcceptBtn" type="button"
              data-request-id="${safeText(requestId)}"
              data-offer-id="${offerId}"
              data-offer-price="${price}"
              ${requestAlreadyAccepted || String(o.status || "").toLowerCase() === "accepted" ? "disabled" : ""}>
              ${String(o.status || "").toLowerCase() === "accepted"
                ? "Accepted"
                : (requestAlreadyAccepted ? "Not available" : "Accept")}
            </button>
          </div>
        </div>
      </div>
    `);
  }
}

function renderSenderHistoryList(histObj) {
  const list = document.getElementById("senderHistoryList");
  if (!list) return;
  list.innerHTML = "";

  if (!histObj || !histObj.ok) {
    list.insertAdjacentHTML("beforeend", alertError(histObj?.error || "Failed to load history"));
    return;
  }

  const events = Array.isArray(histObj.events) ? histObj.events : [];
  if (!events.length) {
    list.insertAdjacentHTML("beforeend", `<div class="muted">No history yet.</div>`);
    return;
  }

  list.insertAdjacentHTML("beforeend", `
    <div class="card compact">
      <ul style="margin:0; padding-left:18px;">
        ${events.slice(0, 12).map((ev) => {
          const when = ev.created_at ? new Date(ev.created_at).toLocaleString() : "";
          const note = ev.note || `${ev.from_status || ""} → ${ev.to_status || ""}`;
          return `<li><strong>${safeText(when)}</strong> — ${safeText(note)}</li>`;
        }).join("")}
      </ul>
    </div>
  `);
}

/* ---------------------------------------------------------
   View request + offers
--------------------------------------------------------- */

function applyAcceptedPriceToFundForm(requestId) {
  const form = document.getElementById("fundEscrowForm");
  if (!form || !form.amount_nzd) return;
  const amt = loadAcceptedPriceForRequest(requestId);
  if (!amt) return;

  // Only auto-fill if empty (never overwrite what the sender typed)
  if (!String(form.amount_nzd.value || "").trim()) {
    form.amount_nzd.value = amt;
  }
}

function setFundFormAmountFromRequest(r) {
  const form = document.getElementById("fundEscrowForm");
  if (!form || !form.amount_nzd) return;

  const rs = String(r?.status || "").toLowerCase();
  const es = String(r?.escrow_status || "").toLowerCase();

  const serverAmt =
    normaliseNzdAmount(r?.agreed_price_nzd) ||
    normaliseNzdAmount(r?.escrow_amount_nzd);

  const needsFunding =
    rs === "accepted" && (es === "" || es === "none" || es === "created");

  if (needsFunding) {
    if (serverAmt) form.amount_nzd.value = serverAmt;
    form.amount_nzd.readOnly = true;
    form.amount_nzd.title = "Auto-filled from accepted driver offer.";
    return;
  }

  if (es === "funded" || es === "pending_release" || es === "released") {
    if (serverAmt) form.amount_nzd.value = serverAmt;
    form.amount_nzd.readOnly = true;
    form.amount_nzd.title = "Escrow already funded.";
    return;
  }

  form.amount_nzd.readOnly = false;
  form.amount_nzd.title = "";
}

function updateSenderQuickButtonsFromRequest(r) {
  const payBtn = document.getElementById("senderQuickPayBtn");
  const relBtn = document.getElementById("senderQuickReleaseBtn");
  if (!payBtn || !relBtn) return;

  const rs = String(r?.status || "").toLowerCase();
  const es = String(r?.escrow_status || "").toLowerCase();

  const showPay = rs === "accepted" && (es === "" || es === "none" || es === "created");
  const showRelease = (es === "pending_release") || rs === "delivered" || rs === "pending_release";

  payBtn.classList.toggle("hidden", !showPay);
  relBtn.classList.toggle("hidden", !showRelease);
}

function setupViewRequest() {
  const form = document.getElementById("viewRequestForm");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const out = document.getElementById("viewRequestResult");
    const offersOut = document.getElementById("viewOffersResult");
    const histOut = document.getElementById("viewHistoryResult");

    const fd = getFormData(form);
    const requestId = String(fd.request_id || "").trim();
    if (!requestId) return;

    addRecentRequest(requestId);
    renderRecentRequests();

    // Cache sender token for this request (so accept/fund actions reuse auth)
    try {
      const tok = getSessionToken();
      if (tok) saveSenderTokenForRequest(requestId, tok);
    } catch (_) {}

    // Load request
    const req = await api(`/requests/${encodeURIComponent(requestId)}`, { method: "GET", role: "sender" });
    if (!req.ok) {
      if (out) setResult(out, alertError(req.error || "Failed to load request"));
      return;
    }

    if (out) setResult(out, alertSuccess("Request loaded"));
    try { renderRequestSummary(req.request); } catch (_) {}
    try { renderNextActionFromRequest(req.request); } catch (_) {}
    try { setFundFormAmountFromRequest(req.request); } catch (_) {}
    try { updateSenderQuickButtonsFromRequest(req.request); } catch (_) {}

    // Load offers
    const offers = await api(`/requests/${encodeURIComponent(requestId)}/offers`, { method: "GET", role: "sender" });
    if (!offers.ok) {
      if (offersOut) setResult(offersOut, alertError(offers.error || "Failed to load offers"));
    } else {
      if (offersOut) setResult(offersOut, alertSuccess("Offers loaded"));
    }
    try { renderSenderOffersList(requestId, offers, req?.request); } catch (_) {}

    // Load history
    const hist = await api(`/requests/${encodeURIComponent(requestId)}/history`, { method: "GET", role: "sender" });
    if (!hist.ok) {
      if (histOut) setResult(histOut, alertError(hist.error || "Failed to load history"));
    } else {
      if (histOut) setResult(histOut, alertSuccess("History loaded"));
    }
    try { renderSenderHistoryList(hist); } catch (_) {}

    // UX: if we already have an accepted offer price cached, try to auto-fill fund form
    try { applyAcceptedPriceToFundForm(requestId); } catch (_) {}
  });
}

/* ---------------------------------------------------------
   Create request
--------------------------------------------------------- */

function setupCreateRequest() {
  const form = document.getElementById("createRequestForm");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const out = document.getElementById("createRequestResult");
    const fd = getFormData(form);

    const body = {
      pickup_address: fd.pickup_address || "",
      pickup_suburb: fd.pickup_suburb || "",
      dropoff_address: fd.dropoff_address || "",
      dropoff_suburb: fd.dropoff_suburb || "",
      item_desc: fd.item_desc || "",
      notes: fd.notes || ""
    };

    const res = await api("/requests", { method: "POST", role: "sender", body });
    if (out) setResult(out, res.ok ? alertSuccess(`Request created (ID ${res.request_id})`) : alertError(res.error || "Failed"));

    if (res.ok && res.request_id) {
      addRecentRequest(res.request_id);
      renderRecentRequests();

      // Auto-load newly created request for convenience
      const viewForm = document.getElementById("viewRequestForm");
      if (viewForm && viewForm.request_id) {
        viewForm.request_id.value = res.request_id;
        viewForm.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      }
    }
  });
}

/* ---------------------------------------------------------
   Fund escrow (Stripe Checkout)
--------------------------------------------------------- */

function setupFundEscrow() {
  const form = document.getElementById("fundEscrowForm");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const out = document.getElementById("fundEscrowResult");
    const fd = getFormData(form);

    const requestId = String(fd.request_id || "").trim();
    const amt = normaliseNzdAmount(fd.amount_nzd || "");
    if (!requestId || !amt) {
      if (out) setResult(out, alertError("Request ID and amount are required"));
      return;
    }

    // Restore sender token if stored for this request
    try {
      const tok = loadSenderTokenForRequest(requestId);
      if (tok) sessionStorage.setItem(SENDER_TOKEN_KEY, tok);
    } catch (_) {}

    const res = await api(`/requests/${encodeURIComponent(requestId)}/escrow/fund`, {
      method: "POST",
      role: "sender",
      body: { amount_nzd: amt }
    });

    if (!res.ok) {
      if (out) setResult(out, alertError(res.error || "Failed to create payment"));
      return;
    }

    if (out) setResult(out, alertSuccess("Redirecting to Stripe Checkout…"));
    if (res.url) window.location.href = res.url;
  });
}

/* ---------------------------------------------------------
   Confirm + Release
--------------------------------------------------------- */

function setupConfirmRelease() {
  const form = document.getElementById("confirmReleaseForm");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const out = document.getElementById("confirmReleaseResult");
    const fd = getFormData(form);

    const requestId = String(fd.request_id || "").trim();
    if (!requestId) {
      if (out) setResult(out, alertError("Request ID is required"));
      return;
    }

    // Restore sender token if stored for this request
    try {
      const tok = loadSenderTokenForRequest(requestId);
      if (tok) sessionStorage.setItem(SENDER_TOKEN_KEY, tok);
    } catch (_) {}

    const res = await api(`/requests/${encodeURIComponent(requestId)}/release`, { method: "POST", role: "sender", body: {} });
    if (out) setResult(out, res.ok ? alertSuccess("Funds released") : alertError(res.error || "Failed"));
  });
}

/* ---------------------------------------------------------
   Offers accept button action (single place, single click)
--------------------------------------------------------- */

function setupSenderOffersActions() {
  document.addEventListener("click", async (e) => {
    const btn = e.target.closest(".senderOfferAcceptBtn");
    if (!btn) return;

    const requestId = String(btn.dataset.requestId || "").trim();
    const offerId = String(btn.dataset.offerId || "").trim();
    const offerPrice = normaliseNzdAmount(btn.dataset.offerPrice || "");
    if (!requestId || !offerId) return;

    if (btn.disabled) return;
    btn.disabled = true;

    const out =
      document.getElementById("viewOffersResult") ||
      document.getElementById("viewRequestResult") ||
      document.getElementById("acceptOfferResult"); // (in case manual form still exists)

    const old = btn.textContent;
    btn.textContent = "Accepting…";

    // Restore sender token (if any) for this request
    try {
      const tok = loadSenderTokenForRequest(requestId);
      if (tok) sessionStorage.setItem(SENDER_TOKEN_KEY, tok);
    } catch (_) {}

    const res = await api(
      `/requests/${encodeURIComponent(requestId)}/offers/${encodeURIComponent(offerId)}/accept`,
      { method: "POST", role: "sender", body: {} }
    );

    btn.textContent = old;

    if (res.ok) {
      if (out) setResult(out, alertSuccess("Offer accepted"));

      // Lock the UI immediately: only one accept per request
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
        try { applyAcceptedPriceToFundForm(requestId); } catch (_) {}
      }

      // Refresh current view
      try {
        const viewForm = document.getElementById("viewRequestForm");
        if (viewForm) viewForm.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      } catch (_) {}

      return;
    }

    // Failure: re-enable so sender can retry
    btn.disabled = false;

    const msg = String(res.error || "Failed");
    if (msg.toLowerCase().includes("cannot accept when request is accepted")) {
      if (out) setResult(out, alertError("This request already has an accepted offer. Please refresh to see the selected driver."));
    } else {
      if (out) setResult(out, alertError(msg || "Failed"));
    }
  });
}

/* ---------------------------------------------------------
   Paid redirect auto-refresh (Stripe return)
--------------------------------------------------------- */

function getQueryParam(name) {
  const u = new URL(window.location.href);
  return u.searchParams.get(name);
}

function handlePaidRedirectRefresh() {
  const paid = getQueryParam("paid");
  const requestId = getQueryParam("request_id");

  if (paid !== "1" || !requestId) return;

  const form = document.getElementById("viewRequestForm");
  if (!form) return;

  if (form.request_id) form.request_id.value = requestId;

  setTimeout(() => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  }, 800);

  setTimeout(() => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  }, 3000);
}

/* ---------------------------------------------------------
   Login + logout
--------------------------------------------------------- */

function setupSenderAuth() {
  const form = document.getElementById("senderLoginForm");
  if (!form) return;

form.addEventListener("submit", async (e) => {
  e.preventDefault();

  const fd = getFormData(form);
  const phone = String(fd.phone || "").trim();

  // Try form field first, otherwise use stored invite code for this phone
  let invite_code = String(fd.invite_code || "").trim();
  if (!invite_code) invite_code = loadInviteCodeForPhone(phone);

  // Single output declaration (ONLY ONCE)
  const out =
    document.getElementById("senderLoginResult") ||
    document.getElementById("senderAuthHint");

  if (!phone) {
    if (out) setResult(out, alertError("Phone is required."));
    return;
  }

  if (!invite_code) {
    if (out) setResult(out, alertError("Invite code is required the first time on this device."));
    return;
  }

const res = await api("/auth/login", { method: "POST", role: "sender", body: { phone, invite_code } });

// On success, remember invite code for future logins (phone-only)
if (res.ok) {
  try { saveInviteCodeForPhone(phone, invite_code); } catch (_) {}
}

    if (!res.ok) {
      if (out) setResult(out, alertError(res.error || "Login failed"));
      setAuthStatus("Not logged in");
      setDashboardVisible(false);
      return;
    }

    setSessionToken(res.user_token);
    saveUser({ phone });
    setAuthStatus(`Logged in as ${phone}`);
    setDashboardVisible(true);
    if (out) setResult(out, alertSuccess("Logged in"));

    renderRecentRequests();
  });

  const logoutBtn = document.getElementById("senderLogoutBtn");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", () => {
      setSessionToken("");
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

  if (payBtn) {
    payBtn.addEventListener("click", () => {
      document.getElementById("fundEscrowForm")?.scrollIntoView?.({ behavior: "smooth", block: "start" });
    });
  }

  if (relBtn) {
    relBtn.addEventListener("click", () => {
      document.getElementById("confirmReleaseForm")?.scrollIntoView?.({ behavior: "smooth", block: "start" });
    });
  }

  if (viewBtn) {
    viewBtn.addEventListener("click", () => {
      document.getElementById("viewRequestForm")?.scrollIntoView?.({ behavior: "smooth", block: "start" });
    });
  }

  const recentSel = document.getElementById("senderRecentSelect");
  if (recentSel) {
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
   Init
--------------------------------------------------------- */
export function initSenderPage() {
   setupSenderAuth();
   setupCreateRequest();
   setupViewRequest();
   setupFundEscrow();
   setupConfirmRelease();
   setupSenderOffersActions();
   setupQuickButtons();
   handlePaidRedirectRefresh();

   const tok = getSessionToken();
   const u = getSavedUser();

   if (tok) {
     setAuthStatus(u?.phone ? `Logged in as ${u.phone}` : "Logged in");
     setDashboardVisible(true);
   } else {
     setAuthStatus("Not logged in");
     setDashboardVisible(false);
   }

   renderRecentRequests();
}

