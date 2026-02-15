// public/js/sender.js
// Aligned to 0215sender.html (minimal additive fixes)
// - Fix Create Request enablement (acks) + payload fields
// - Fix auth/dashboard IDs + release form IDs
// - Keep existing offer accept + fund escrow flows intact

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
  // 0215sender.html uses senderAuthStatusDash
  const el = document.getElementById("senderAuthStatusDash") || document.getElementById("senderAuthStatus");
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
  // 0215sender.html uses senderAuthArea (not senderAuthCard)
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

  // Update count (if present)
  const cnt = document.getElementById("senderRecentCount");
  if (cnt) cnt.textContent = list.length ? `${list.length} saved on this device` : `No saved requests on this device yet.`;

  sel.innerHTML = `<option value="">Select a request…</option>`;
  for (const id of list) {
    sel.insertAdjacentHTML("beforeend", `<option value="${safeText(id)}">Request #${safeText(id)}</option>`);
  }

  // Clear button (if present)
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
  if (!String(form.amount_nzd.value || "").trim()) form.amount_nzd.value = amt;
}

function setFundFormAmountFromRequest(r) {
  const form = document.getElementById("fundEscrowForm");
  if (!form || !form.amount_nzd) return;

  const rs = String(r?.status || "").toLowerCase();
  const es = String(r?.escrow_status || "").toLowerCase();

  const serverAmt =
    normaliseNzdAmount(r?.agreed_price_nzd) ||
    normaliseNzdAmount(r?.escrow_amount_nzd);

  const needsFunding = rs === "accepted" && (es === "" || es === "none" || es === "created");

  if (needsFunding) {
    if (serverAmt) form.amount_nzd.value = serverAmt;
    form.amount_nzd.readOnly = true;
    return;
  }

  if (es === "funded" || es === "pending_release" || es === "released") {
    if (serverAmt) form.amount_nzd.value = serverAmt;
    form.amount_nzd.readOnly = true;
    return;
  }

  form.amount_nzd.readOnly = false;
}

function setupViewRequest() {
  const form = document.getElementById("viewRequestForm");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const out = document.getElementById("viewRequestResult");
    const offersOut = document.getElementById("viewOffersResult");

    const fd = getFormData(form);
    const requestId = String(fd.request_id || "").trim();
    if (!requestId) return;

    addRecentRequest(requestId);
    renderRecentRequests();

    try {
      const tok = getSessionToken();
      if (tok) saveSenderTokenForRequest(requestId, tok);
    } catch (_) {}

    const req = await api(`/requests/${encodeURIComponent(requestId)}`, { method: "GET", role: "sender" });
    if (!req.ok) {
      if (out) setResult(out, alertError(req.error || "Failed to load request"));
      return;
    }

    if (out) setResult(out, alertSuccess("Request loaded"));
    try { renderRequestSummary(req.request); } catch (_) {}
    try { setFundFormAmountFromRequest(req.request); } catch (_) {}

    const offers = await api(`/requests/${encodeURIComponent(requestId)}/offers`, { method: "GET", role: "sender" });
    if (!offers.ok) {
      if (offersOut) setResult(offersOut, alertError(offers.error || "Failed to load offers"));
    } else {
      if (offersOut) setResult(offersOut, alertSuccess("Offers loaded"));
    }
    try { renderSenderOffersList(requestId, offers, req?.request); } catch (_) {}

    const hist = await api(`/requests/${encodeURIComponent(requestId)}/history`, { method: "GET", role: "sender" });
    try { renderSenderHistoryList(hist); } catch (_) {}

    try { applyAcceptedPriceToFundForm(requestId); } catch (_) {}
  });
}

/* ---------------------------------------------------------
   Create request (aligned to current form fields)
--------------------------------------------------------- */

function setupCreateRequest() {
  const form = document.getElementById("createRequestForm");
  if (!form) return;

 form.addEventListener("submit", async (e) => {
  e.preventDefault();

  const out = document.getElementById("createRequestResult");
  const fd = getFormData(form);

  // Backend requires sender_ack_version (pilot acknowledgements)
  const ackOk =
    !!document.getElementById("sAck1")?.checked &&
    !!document.getElementById("sAck2")?.checked &&
    !!document.getElementById("sAck3")?.checked &&
    !!document.getElementById("sAck4")?.checked;

  if (!ackOk) {
    if (out) setResult(out, alertError("Please tick all acknowledgements to continue."));
    return;
  }

  // Backend requires sender_phone (pilot)
  const u = getSavedUser();
  const sender_phone = String(u?.phone || "").trim();
  if (!sender_phone) {
    if (out) setResult(out, alertError("Your login session is missing a phone number. Please log out and log in again."));
    return;
  }

  const pickup_suburb = String(fd.pickup_suburb || "").trim();
  const dropoff_suburb = String(fd.dropoff_suburb || "").trim();
  const item_desc = String(fd.item_desc || "").trim();
  const sender_note = String(fd.sender_note || "").trim();

  if (!pickup_suburb || !dropoff_suburb || !item_desc) {
    if (out) setResult(out, alertError("Pickup suburb, drop-off suburb, and item description are required."));
    return;
  }

  // Backend expects item_description (max 300 chars)
  let item_description = item_desc;
  if (sender_note) item_description = `${item_desc} | Note: ${sender_note}`;
  item_description = item_description.slice(0, 300);

  const body = {
    sender_phone,
    pickup_suburb,
    dropoff_suburb,
    item_description, // ✅ backend field name
    weight_kg: fd.weight_kg === "" || fd.weight_kg == null ? null : Number(fd.weight_kg),
    suggested_price_nzd:
      fd.suggested_price_nzd === "" || fd.suggested_price_nzd == null ? null : Number(fd.suggested_price_nzd),
    sender_ack_version: "v1" // ✅ required by backend
  };

  const res = await api("/requests", { method: "POST", role: "sender", body });

const createdId =
  res.request_id ??
  res.id ??
  res.request?.id ??
  res.request?.request_id ??
  res.data?.id ??
  res.data?.request_id;

if (out) {
  setResult(
    out,
    res.ok
      ? alertSuccess(`Request created (ID ${createdId ?? "unknown"})`)
      : alertError(res.error || "Failed")
  );
}

if (res.ok && createdId) {
  addRecentRequest(createdId);
  renderRecentRequests();

  const viewForm = document.getElementById("viewRequestForm");
  if (viewForm && viewForm.request_id) {
    viewForm.request_id.value = createdId;
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

try {
  const tok = loadSenderTokenForRequest(requestId);
  if (tok) {
    sessionStorage.setItem(SENDER_TOKEN_KEY, tok);
  } else {
    sessionStorage.removeItem(SENDER_TOKEN_KEY); // <-- critical
  }
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

const checkoutUrl =
  res.url ||
  res.checkout_url ||
  res.checkoutUrl ||
  res.session_url ||
  res.sessionUrl;

if (!checkoutUrl) {
  if (out) setResult(out, alertError("Payment session created, but no checkout URL was returned."));
  return;
}

// Prefer same-tab redirect (most reliable)
window.location.assign(checkoutUrl);

  });
}

/* ---------------------------------------------------------
   Confirm + Release (aligned to releaseEscrowForm)
--------------------------------------------------------- */

function setupConfirmRelease() {
  // 0215sender.html uses releaseEscrowForm / releaseEscrowResult
  const form = document.getElementById("releaseEscrowForm") || document.getElementById("confirmReleaseForm");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const out = document.getElementById("releaseEscrowResult") || document.getElementById("confirmReleaseResult");
    const fd = getFormData(form);

    const requestId = String(fd.request_id || "").trim();
    if (!requestId) {
      if (out) setResult(out, alertError("Request ID is required"));
      return;
    }

try {
  const tok = loadSenderTokenForRequest(requestId);
  if (tok) {
    sessionStorage.setItem(SENDER_TOKEN_KEY, tok);
  } else {
    sessionStorage.removeItem(SENDER_TOKEN_KEY); // <-- critical
  }
} catch (_) {}


const res = await api(`/requests/${encodeURIComponent(requestId)}/escrow/release`, {
  method: "POST",
  role: "sender",
  body: {}
});

    if (out) setResult(out, res.ok ? alertSuccess("Funds released") : alertError(res.error || "Failed"));
  });
}

/* ---------------------------------------------------------
   Offers accept action
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
      document.getElementById("viewRequestResult");

    const old = btn.textContent;
    btn.textContent = "Accepting…";

 try {
  const tok = loadSenderTokenForRequest(requestId);
  if (tok) {
    sessionStorage.setItem(SENDER_TOKEN_KEY, tok);
  } else {
    sessionStorage.removeItem(SENDER_TOKEN_KEY); // <-- critical
  }
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
    try { applyAcceptedPriceToFundForm(requestId); } catch (_) {}
  }

  // ✅ INSERT THIS BLOCK RIGHT HERE
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
  // ✅ END INSERT

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
   Stripe return auto-refresh
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
   Login + logout (use /users/login with phone)
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

    // Ensure api.js can always auth via X-User-Token
sessionStorage.setItem("dm_user_token", res.user_token);
localStorage.setItem("dm_user_token", res.user_token);

// DO NOT clear dm_sender_token here.
// It breaks Stripe return flow.


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
  const copyBtn = document.getElementById("senderQuickCopyBtn");

  if (payBtn && !payBtn.__bound) {
    payBtn.__bound = true;
    payBtn.addEventListener("click", () => {
      document.getElementById("fundEscrowForm")?.scrollIntoView?.({ behavior: "smooth", block: "start" });
    });
  }

  if (relBtn && !relBtn.__bound) {
    relBtn.__bound = true;
    relBtn.addEventListener("click", () => {
      (document.getElementById("releaseEscrowForm") || document.getElementById("confirmReleaseForm"))
        ?.scrollIntoView?.({ behavior: "smooth", block: "start" });
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
   Init
--------------------------------------------------------- */

export function initSenderPage() {

  // Restore dm_user_token (login token)
  try {
    const s = sessionStorage.getItem("dm_user_token");
    const l = localStorage.getItem("dm_user_token");
    if (!s && l) sessionStorage.setItem("dm_user_token", l);
  } catch (_) {}

  // Restore dm_sender_token (per-request token)
  try {
    const reqId = new URL(window.location.href).searchParams.get("request_id");
    if (reqId) {
      const saved = loadSenderTokenForRequest(reqId);
      if (saved) sessionStorage.setItem("dm_sender_token", saved);
    }
  } catch (_) {}

  // Immediately update UI based on restored token
  const tok = getSessionToken();
  const u = getSavedUser();

  if (tok) {
    setAuthStatus(u?.phone ? `Logged in as ${u.phone}` : "Logged in");
    setDashboardVisible(true);
  } else {
    setAuthStatus("Not logged in");
    setDashboardVisible(false);
  }

  // Load everything EXCEPT setupSenderAuth()
  setupCreateAcksGate();
  setupCreateRequest();
  setupViewRequest();
  setupFundEscrow();
  setupConfirmRelease();
  setupSenderOffersActions();
  setupQuickButtons();
  handlePaidRedirectRefresh();

  // 🔥 Call setupSenderAuth() LAST so it does NOT overwrite restored login state
  setupSenderAuth();

  renderRecentRequests();
}
