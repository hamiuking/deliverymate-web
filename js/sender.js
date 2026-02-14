// public/js/sender.js
// Full replacement (minimal additive UX improvements)
// - Adds a clear status summary (pill + timeline + next action) into #senderReqSummary when viewing a request
// - Keeps all existing working flows intact

import { api } from "./api.js";
import { $, pretty } from "./utils.js";
import { alertSuccess, alertError } from "./components/alerts.js";
import { getFormData } from "./components/forms.js";
import { statusPill, timeline, nextActionText } from "./components/status.js";

function setResult(el, html) {
  if (!el) return;
  el.innerHTML = html || "";
}

function setWorking(btn, workingText = "Working…") {
  if (!btn) return () => {};
  const oldText = btn.textContent;
  btn.disabled = true;
  btn.dataset._oldText = oldText;
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

function maybeOpenDetails(outEl, open) {
  const d = outEl && outEl.closest && outEl.closest("details");
  if (d) d.open = !!open;
}

// ✅ Null-safe helper so missing <pre>/<details> output boxes never crash the page
function safeOut(outEl, resObj, openOnError) {
  if (!outEl) return;
  outEl.textContent = pretty(resObj);
  try {
    maybeOpenDetails(outEl, !!openOnError);
  } catch (_) {}
}

/* ---------------------------------------------------------
   Auth persistence helpers (device-based pilot)
--------------------------------------------------------- */
const SENDER_REGISTERED_KEY = "dm_sender_registered";

function saveUserProfileAndToken(user, user_token) {
  if (user) {
    localStorage.setItem("dm_user", JSON.stringify(user));
    sessionStorage.setItem("dm_user", JSON.stringify(user));
  }
  if (user_token) {
    localStorage.setItem("dm_user_token", String(user_token));
    sessionStorage.setItem("dm_user_token", String(user_token));
  }
  localStorage.setItem(SENDER_REGISTERED_KEY, "1");
}

function clearSenderSession() {
  localStorage.removeItem(SENDER_REGISTERED_KEY);
  sessionStorage.removeItem("dm_user");
  localStorage.removeItem("dm_user");
  sessionStorage.removeItem("dm_user_token");
  localStorage.removeItem("dm_user_token");

  // sender tokens are per-request; keep them OR clear them?
  // For pilot clarity, we clear the active one but keep historical mapping.
  sessionStorage.removeItem("dm_sender_token");
}

function isSenderRegistered() {
  return localStorage.getItem(SENDER_REGISTERED_KEY) === "1";
}

function getSavedUser() {
  try {
    const raw = localStorage.getItem("dm_user") || sessionStorage.getItem("dm_user");
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function setAuthUI() {
  const locked = !isSenderRegistered();

  const logoutBtn = document.getElementById("senderLogoutBtn");
  const hint = document.getElementById("senderAuthHint");

  if (logoutBtn) logoutBtn.classList.toggle("hidden", locked);

  if (hint) {
    if (locked) {
      hint.textContent = "";
    } else {
      const u = getSavedUser();
      hint.textContent = u?.phone ? `Logged in as ${u.phone}` : "Logged in";
    }
  }
}

/* Gate dashboard sections (CSS-based) */
function enforceSenderGate() {
  const status = document.getElementById("senderAuthStatus");
  const statusDash = document.getElementById("senderAuthStatusDash");
  const locked = !isSenderRegistered();

  document.body.classList.toggle("locked", locked);
  document.body.classList.toggle("unlocked", !locked);

  // Mark sections that require sender
  const req = document.querySelectorAll(".requires-sender");
  req.forEach((el) => el.classList.toggle("hidden", locked));

  // Lock-only/unlock-only helpers
  const lockedOnly = document.querySelectorAll(".locked-only");
  lockedOnly.forEach((el) => el.classList.toggle("hidden", !locked));
  const unlockedOnly = document.querySelectorAll(".unlocked-only");
  unlockedOnly.forEach((el) => el.classList.toggle("hidden", locked));

  setAuthUI();

  const msg = locked
    ? "Please register or log in to access the sender dashboard."
    : (() => {
        const u = getSavedUser();
        return u?.phone ? `Sender dashboard unlocked (${u.phone}).` : "Sender dashboard unlocked.";
      })();

  if (status) status.textContent = msg;
  if (statusDash) statusDash.textContent = msg;
}
/* ---------------------------------------------------------
   Sender acknowledgement gate (before creating request)
--------------------------------------------------------- */
// Keep this <= 20 chars (backend requirement)
const SENDER_ACK_VERSION_FALLBACK = "sender_ack_v1";
const SENDER_ACK_KEY = "dm_sender_ack_v1_ts";

function currentSenderAckVersion() {
  // app.js may have fetched /ack/versions and stored this in sessionStorage
  const v = sessionStorage.getItem("dm_sender_ack_version");
  if (v && String(v).length <= 20) return String(v);
  return SENDER_ACK_VERSION_FALLBACK;
}

function setupSenderAckGate() {
  const btn = document.getElementById("createRequestBtn");
  const a1 = document.getElementById("sAck1");
  const a2 = document.getElementById("sAck2");
  const a3 = document.getElementById("sAck3");
  const a4 = document.getElementById("sAck4");

  if (!btn || !a1 || !a2 || !a3 || !a4) return;

  const prevTs = localStorage.getItem(SENDER_ACK_KEY);
  if (prevTs) {
    a1.checked = true;
    a2.checked = true;
    a3.checked = true;
    a4.checked = true;
  }

  const refresh = () => {
    const ok = a1.checked && a2.checked && a3.checked && a4.checked;
    btn.disabled = !ok;
    if (ok) localStorage.setItem(SENDER_ACK_KEY, new Date().toISOString());
  };

  a1.addEventListener("change", refresh);
  a2.addEventListener("change", refresh);
  a3.addEventListener("change", refresh);
  a4.addEventListener("change", refresh);

  refresh();
}

function getSenderAckMeta() {
  const ts = localStorage.getItem(SENDER_ACK_KEY) || new Date().toISOString();
  return { sender_ack_version: currentSenderAckVersion(), sender_ack_ts: ts };
}

/* ---------------------------------------------------------
   Recent requests + sender token helpers
--------------------------------------------------------- */
const SENDER_RECENT_KEY = "dm_sender_recent_requests";

function loadSenderRecent() {
  try {
    return JSON.parse(localStorage.getItem(SENDER_RECENT_KEY) || "[]");
  } catch {
    return [];
  }
}
function saveSenderRecent(list) {
  try {
    localStorage.setItem(SENDER_RECENT_KEY, JSON.stringify(list));
  } catch {}
}

function renderSenderRecent() {
  const sel = document.getElementById("senderRecentSelect");
  const countEl = document.getElementById("senderRecentCount");
  if (!sel) return;
  const list = loadSenderRecent();

  if (countEl) {
    countEl.textContent = list.length ? `${list.length} recent request(s) on this device` : "No recent requests on this device yet";
  }

  sel.innerHTML = "";

  const opt0 = document.createElement("option");
  opt0.value = "";
  opt0.textContent = list.length ? "Select a request…" : "No recent requests yet";
  sel.appendChild(opt0);

  for (const it of list) {
    const o = document.createElement("option");
    o.value = String(it.id);
    const route = it.pickup || it.dropoff ? ` — ${it.pickup} → ${it.dropoff}` : "";
    const st = it.status ? ` · ${humanRequestStatus(it.status)}` : "";
    o.textContent = `#${it.id}${st}${route}`;
    sel.appendChild(o);
  }
}

function addSenderRecent(req) {
  if (!req?.id) return;
  const id = String(req.id);
  const item = {
    id,
    pickup: req.pickup_suburb || "",
    dropoff: req.dropoff_suburb || "",
    status: req.status || "",
    ts: req.created_at || new Date().toISOString(),
  };
  const list = loadSenderRecent().filter((x) => String(x.id) !== id);
  list.unshift(item);
  saveSenderRecent(list.slice(0, 10));
  renderSenderRecent();
}

function saveSenderTokenForRequest(requestId, token) {
  if (!requestId || !token) return;
  try {
    const key = "dm_sender_tokens";
    const obj = JSON.parse(localStorage.getItem(key) || "{}");
    obj[String(requestId)] = String(token);
    localStorage.setItem(key, JSON.stringify(obj));
    sessionStorage.setItem("dm_sender_token", String(token));
  } catch {
    sessionStorage.setItem("dm_sender_token", String(token));
  }
}

function loadSenderTokenForRequest(requestId) {
  if (!requestId) return "";
  try {
    const obj = JSON.parse(localStorage.getItem("dm_sender_tokens") || "{}");
    return obj[String(requestId)] || "";
  } catch {
    return "";
  }
}

function applySenderRecent(requestId) {
  if (!requestId) return;
  const id = String(requestId);

  const formIds = ["viewRequestForm", "acceptOfferForm"];
  for (const formId of formIds) {
    const f = document.getElementById(formId);
    if (f && f.request_id) f.request_id.value = id;
  }

  const fund = document.getElementById("fundRequestId");
  if (fund) fund.value = id;

  const rel = document.getElementById("releaseRequestId");
  if (rel) rel.value = id;
}

function setupSenderRecentUI() {
  const sel = document.getElementById("senderRecentSelect");
  const clearBtn = document.getElementById("senderRecentClearBtn");
  if (!sel) return;

  renderSenderRecent();

  // Auto-fill all forms when selecting a request
  sel.addEventListener("change", () => {
    if (!sel.value) return;
    applySenderRecent(sel.value);

    // Auto-load the request to reduce friction
    const viewForm = document.getElementById("viewRequestForm");
    if (viewForm) {
      viewForm.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
    }
  });

  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      saveSenderRecent([]);
      renderSenderRecent();
      setNextActionBanner("");
    });
  }
}

function setupSenderQuickActions() {
  const sel = document.getElementById("senderRecentSelect");
  const viewBtn = document.getElementById("senderQuickViewBtn");
  const payBtn = document.getElementById("senderQuickPayBtn");
  const relBtn = document.getElementById("senderQuickReleaseBtn");
  const copyBtn = document.getElementById("senderQuickCopyBtn");

  const getId = () => String(sel?.value || "").trim();

  if (viewBtn) {
    viewBtn.addEventListener("click", () => {
      const id = getId();
      if (!id) return;
      applySenderRecent(id);
      const viewForm = document.getElementById("viewRequestForm");
      if (viewForm) viewForm.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
      viewForm?.scrollIntoView?.({ behavior: "smooth", block: "start" });
    });
  }

  if (payBtn) {
    payBtn.addEventListener("click", () => {
      const id = getId();
      if (!id) return;
      applySenderRecent(id);
      const fundForm = document.getElementById("fundEscrowForm");
      if (fundForm) {
        fundForm.scrollIntoView({ behavior: "smooth", block: "start" });
        if (fundForm.amount_nzd) fundForm.amount_nzd.focus();
      }
    });
  }

  if (relBtn) {
    relBtn.addEventListener("click", () => {
      const id = getId();
      if (!id) return;
      applySenderRecent(id);
      const relForm = document.getElementById("releaseEscrowForm");
      if (relForm) relForm.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  if (copyBtn) {
    copyBtn.addEventListener("click", async () => {
      const id = getId();
      if (!id) return;
      try {
        await navigator.clipboard.writeText(id);
        setNextActionBanner(`<div class="banner"><strong>Copied</strong><div class="muted" style="margin-top:6px;">Request ID ${safeText(id)} copied to clipboard.</div></div>`);
      } catch {
        setNextActionBanner(`<div class="banner"><strong>Copy failed</strong><div class="muted" style="margin-top:6px;">Please copy manually: ${safeText(id)}</div></div>`);
      }
    });
  }
}

/* ---------------------------------------------------------
   1) Register + Login + Logout
--------------------------------------------------------- */
function setupRegistration() {
  const form = $("#senderRegForm");
  const out = $("#senderRegOut");
  const result = $("#senderRegResult");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button[type="submit"]');
    const done = setWorking(btn, "Registering…");
    setResult(result, "");

    const data = getFormData(form);
    const res = await api("/users/register", { method: "POST", body: data });

    safeOut(out, res, !res.ok);
    done(!!res.ok);

    if (res.ok) {
      saveUserProfileAndToken(res.user, res.user_token);
      setResult(result, alertSuccess("Registered on this device"));
      enforceSenderGate();
    } else {
      setResult(result, alertError(res.error || "Failed"));
    }
  });
}

function setupLogin() {
  const form = $("#senderLoginForm");
  const out = $("#senderLoginOut");
  const result = $("#senderLoginResult");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button[type="submit"]');
    const done = setWorking(btn, "Logging in…");
    setResult(result, "");

    const data = getFormData(form);
    const res = await api("/users/login", { method: "POST", body: data });

    safeOut(out, res, !res.ok);
    done(!!res.ok);

    if (res.ok) {
      saveUserProfileAndToken(res.user, res.user_token);
      setResult(result, alertSuccess("Logged in on this device"));
      enforceSenderGate();
    } else {
      setResult(result, alertError(res.error || "Failed"));
    }
  });
}

function setupSenderAuthControls() {
  const logoutBtn = document.getElementById("senderLogoutBtn");
  if (!logoutBtn) return;

  logoutBtn.addEventListener("click", () => {
    clearSenderSession();
    enforceSenderGate();
  });
}

/* ---------------------------------------------------------
   2) Create Request (requires ack + sender_phone)
--------------------------------------------------------- */
function setupCreateRequest() {
  const form = $("#createRequestForm");
  const out = $("#senderOutput");
  const result = $("#createRequestResult");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    if (!isSenderRegistered()) {
      setResult(result, alertError("Please register or log in first."));
      return;
    }

    const createBtn = document.getElementById("createRequestBtn");
    if (createBtn && createBtn.disabled) {
      setResult(result, alertError("Please confirm all acknowledgement checkboxes before posting."));
      return;
    }

    const btn = form.querySelector('button[type="submit"]');
    const done = setWorking(btn, "Creating…");
    setResult(result, "");

    const data = getFormData(form);

    Object.assign(data, getSenderAckMeta());
    if (!data.sender_ack_version) data.sender_ack_version = currentSenderAckVersion();

    const u = getSavedUser();
    if (u?.phone) data.sender_phone = data.sender_phone || u.phone;
    if (u?.full_name) data.sender_name = data.sender_name || u.full_name;

    const res = await api("/requests", { method: "POST", body: data, role: "sender" });

    safeOut(out, res, !res.ok);
    done(!!res.ok);

    if (res.ok) {
      setResult(result, alertSuccess("Created"));
      renderCreateRequestInfo(res);
    } else {
      setResult(result, alertError(res.error || "Failed"));
    }
  });
}

function renderCreateRequestInfo(res) {
  try {
    const box = document.getElementById("senderCreateInfo");
    if (!box) return;
    const id = res?.request?.id;
    const tok = res?.sender_token;
    if (!id) return;

    if (tok) saveSenderTokenForRequest(id, tok);
    addSenderRecent(res.request);
    try { renderNextActionFromRequest(res.request); } catch (_) {}

    const viewForm = document.getElementById("viewRequestForm");
    if (viewForm && viewForm.request_id) viewForm.request_id.value = String(id);

    const relInput = document.getElementById("releaseRequestId");
    if (relInput) relInput.value = String(id);

    const fundInput = document.getElementById("fundRequestId");
    if (fundInput) fundInput.value = String(id);

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

    const copyBtn = document.getElementById("copyRequestIdBtn");
    const loadBtn = document.getElementById("loadCreatedRequestBtn");
    const note = document.getElementById("copyRequestIdNote");

    if (copyBtn) {
      copyBtn.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(String(id));
          if (note) note.textContent = "Copied.";
        } catch {
          if (note) note.textContent = "Copy failed. Please copy manually.";
        }
      });
    }
    if (loadBtn) {
      loadBtn.addEventListener("click", () => {
        const f = document.getElementById("viewRequestForm");
        if (f) f.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
      });
    }
  } catch (_) {}
}

/* ---------------------------------------------------------
   View request / offers / history
--------------------------------------------------------- */
function setupViewRequest() {
  const form = document.getElementById("viewRequestForm");
  const result = document.getElementById("viewRequestResult");

  const reqOut = document.getElementById("viewRequestOut");
  const offersOut = document.getElementById("viewOffersOut");
  const historyOut = document.getElementById("viewHistoryOut");

  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const btn = form.querySelector('button[type="submit"]');
    const done = setWorking(btn, "Loading…");
    setResult(result, "");

    const requestId = String(form.request_id?.value || "").trim();
    if (!requestId) {
      done(false);
      setResult(result, alertError("Request ID is required."));
      return;
    }

    const req = await api(`/requests/${encodeURIComponent(requestId)}`, { role: "sender" });
    const offers = await api(`/requests/${encodeURIComponent(requestId)}/offers`, { role: "sender" });
    const hist = await api(`/requests/${encodeURIComponent(requestId)}/history`, { role: "sender" });

    // Debug outputs (safe even if missing)
    if (reqOut) reqOut.textContent = pretty(req);
    if (offersOut) offersOut.textContent = pretty(offers);
    if (historyOut) historyOut.textContent = pretty(hist);

    
    // ✅ UX: render Offers + History cards
    try { renderSenderOffersList(requestId, offers); } catch (_) {}
    try { renderSenderHistoryList(hist); } catch (_) {}
    // Restore sender token for subsequent sender-only actions on this request
    try {
      const tok = loadSenderTokenForRequest(requestId);
      if (tok) sessionStorage.setItem("dm_sender_token", tok);
    } catch (_) {}

    // ✅ UX: render a clear status summary into senderReqSummary (if present)
    try {
      const box = document.getElementById("senderReqSummary");
      if (box) {
        if (!req || !req.ok || !req.request) {
          box.innerHTML = req?.error ? alertError(req.error) : ""; try { setNextActionBanner(""); } catch (_) {}
        } else {
          const r = req.request;
          box.innerHTML = `
            <div class="card compact">
              ${statusPill({ request_status: r.status, escrow_status: r.escrow_status, payout_status: r.payout_status })}
              ${timeline({ request_status: r.status, escrow_status: r.escrow_status })}
              <div class="next-action" style="margin-top:8px;">
                <strong>What happens next:</strong>
                ${nextActionText({ role: "sender", request_status: r.status, escrow_status: r.escrow_status })}
              </div>
              <div class="muted" style="margin-top:10px;">
                Request #${safeText(r.id)} · ${safeText(r.pickup_suburb)} → ${safeText(r.dropoff_suburb)}
              </div>
            </div>
          `;
          try { renderNextActionFromRequest(r); } catch (_) {}
        }
      }
    } catch (_) {}

    done(!!req.ok);
    if (req.ok) setResult(result, alertSuccess("Loaded"));
    else setResult(result, alertError(req.error || "Failed"));
  });
}

/* ---------------------------------------------------------
   Accept offer
--------------------------------------------------------- */
function setupAcceptOffer() {
  const form = document.getElementById("acceptOfferForm");
  const out = document.getElementById("acceptOfferOut");
  const result = document.getElementById("acceptOfferResult");

  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const requestId = String(form.request_id?.value || "").trim();
    const offerId = String(form.offer_id?.value || "").trim();

    if (!requestId || !offerId) {
      setResult(result, alertError("Request ID and Offer ID are required."));
      return;
    }

    // Restore sender token if available (same as fund/release)
    try {
      const tok = loadSenderTokenForRequest(requestId);
      if (tok) sessionStorage.setItem("dm_sender_token", tok);
    } catch (_) {}

    const btn = form.querySelector('button[type="submit"]');
    const done = setWorking(btn, "Accepting…");
    setResult(result, "");

    const res = await api(
      `/requests/${encodeURIComponent(requestId)}/offers/${encodeURIComponent(offerId)}/accept`,
      { method: "POST", role: "sender", body: {} }
    );

    safeOut(out, res, !res.ok);
    done(!!res.ok);

    if (res.ok) setResult(result, alertSuccess("Offer accepted"));
    else setResult(result, alertError(res.error || "Failed"));
  });
}

/* ---------------------------------------------------------
   Fund escrow (Stripe)
--------------------------------------------------------- */
function setupFundEscrow() {
  const form = document.getElementById("fundEscrowForm");
  const out = document.getElementById("fundEscrowOut");
  const result = document.getElementById("fundEscrowResult");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const btn = form.querySelector('button[type="submit"]');
    const done = setWorking(btn, "Starting checkout…");
    setResult(result, "");

    const requestId = String(form.request_id?.value || "").trim();
    const amount = String(form.amount_nzd?.value || "").trim();

    if (!requestId) {
      done(false);
      setResult(result, alertError("Request ID is required."));
      return;
    }
    if (!amount) {
      done(false);
      setResult(result, alertError("Amount is required."));
      return;
    }

    // Restore sender token if available
    try {
      const tok = loadSenderTokenForRequest(requestId);
      if (tok) sessionStorage.setItem("dm_sender_token", tok);
    } catch (_) {}

    // Correct backend endpoint
    const res = await api(`/requests/${encodeURIComponent(requestId)}/escrow/fund`, {
      method: "POST",
      role: "sender",
      body: { amount_nzd: amount },
    });

    safeOut(out, res, !res.ok);
    done(!!res.ok);

    const checkoutUrl = res.url || res.checkout_url || res.checkoutUrl || res.session_url || res.sessionUrl;
    if (res.ok && checkoutUrl) {
      setResult(result, alertSuccess("Redirecting to Stripe Checkout…"));
      window.location.href = checkoutUrl;
      return;
    }

    if (res.ok) setResult(result, alertSuccess("OK"));
    else setResult(result, alertError(res.error || "Failed"));
  });
}

/* ---------------------------------------------------------
   Release escrow
--------------------------------------------------------- */
function setupReleaseEscrow() {
  const form = document.getElementById("releaseEscrowForm");
  const out = document.getElementById("releaseEscrowOut");
  const result = document.getElementById("releaseEscrowResult");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const btn = form.querySelector('button[type="submit"]');
    const done = setWorking(btn, "Releasing…");
    setResult(result, "");

    const requestId = String(form.request_id?.value || "").trim();
    if (!requestId) {
      done(false);
      setResult(result, alertError("Request ID is required."));
      return;
    }

    // Restore sender token if available
    try {
      const tok = loadSenderTokenForRequest(requestId);
      if (tok) sessionStorage.setItem("dm_sender_token", tok);
    } catch (_) {}

    // Correct backend endpoint
    const res = await api(`/requests/${encodeURIComponent(requestId)}/escrow/release`, {
      method: "POST",
      role: "sender",
      body: {},
    });

    safeOut(out, res, !res.ok);
    done(!!res.ok);

    if (res.ok) setResult(result, alertSuccess("Escrow released"));
    else setResult(result, alertError(res.error || "Failed"));
  });
}

/* ---------------------------------------------------------
   Issue report helper
--------------------------------------------------------- */
function setupIssueReport_sender() {
  const form = document.getElementById("senderIssueForm");
  const out = document.getElementById("senderIssueOut");
  if (!form || !out) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const requestId = String(fd.get("request_id") || "").trim();
    const note = String(fd.get("note") || "").trim();

    let snapshot = "";
    if (requestId) {
      const req = await api(`/requests/${encodeURIComponent(requestId)}`, { role: "sender" });
      if (req && req.ok && req.request) {
        const r = req.request;
        snapshot = `Status: ${r.status}\nEscrow: ${r.escrow_status}\nPayout: ${r.payout_status}\nPickup: ${safeText(
          r.pickup_suburb
        )}\nDrop-off: ${safeText(r.dropoff_suburb)}`;
      } else {
        snapshot = "Status snapshot: (unable to load request)";
      }
    }

    const now = new Date().toISOString();
    const url = window.location.origin;
    out.textContent = [
      "DeliveryMate pilot issue report",
      `Time: ${now}`,
      "Role: sender",
      requestId ? `Request ID: ${requestId}` : "Request ID: (not provided)",
      snapshot ? `\n${snapshot}\n` : "",
      note ? `Note: ${note}` : "Note: (none)",
      "\nPlease include a screenshot if possible.",
      `Site: ${url}`,
    ].join("\n");
  });
}

function safeText(v) {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/* ---------------------------------------------------------
   UX helpers: human-readable labels + next-action banner
--------------------------------------------------------- */
function humanRequestStatus(s) {
  const v = String(s || "").toLowerCase();
  const map = {
    open: "Open for offers",
    accepted: "Driver selected",
    in_transit: "In progress",
    delivered: "Delivered (awaiting your confirmation)",
    pending_release: "Awaiting release",
    released: "Paid out",
    cancelled: "Cancelled",
  };
  return map[v] || (s ? String(s) : "");
}

function humanEscrowStatus(s) {
  const v = String(s || "").toLowerCase();
  const map = {
    none: "Not funded",
    created: "Not funded",
    funded: "Funded",
    pending_release: "Pending release",
    released: "Released",
  };
  return map[v] || (s ? String(s) : "");
}

function setNextActionBanner(html) {
  const el = document.getElementById("senderNextActionBanner");
  if (!el) return;
  el.innerHTML = html || "";
}

function renderNextActionFromRequest(r) {
  if (!r) { setNextActionBanner(""); return; }

  const reqStatus = humanRequestStatus(r.status);
  const escrow = humanEscrowStatus(r.escrow_status);
  const next = nextActionText({ role: "sender", request_status: r.status, escrow_status: r.escrow_status });

  setNextActionBanner(`
    <div class="banner">
      <strong>Next step</strong>
      <div class="muted" style="margin-top:6px;">${safeText(next)}</div>
      <div class="muted" style="margin-top:8px;">
        Status: ${safeText(reqStatus)} · Escrow: ${safeText(escrow)}
      </div>
    </div>
  `);
}

/* ---------------------------------------------------------
   UX: Render offers + history into sender dashboard cards
   (minimal additive; uses existing endpoints + forms)
--------------------------------------------------------- */
function renderSenderOffersList(requestId, offersObj) {
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

  for (const o of offers) {
    const driver = safeText(o.driver_name || o.driver_phone || "Driver");
    const price = (o.price_nzd != null && o.price_nzd !== "") ? safeText(o.price_nzd) : "";
    const offerId = safeText(o.id);
    const status = safeText(o.status || "");

    list.insertAdjacentHTML("beforeend", `
      <div class="card compact" style="margin-top:10px;">
        <div style="display:flex; justify-content:space-between; gap:10px; align-items:center;">
          <div>
            <div><strong>${driver}</strong> ${status ? `<span class="muted">(${status})</span>` : ""}</div>
            <div class="muted">Offer #${offerId}${price ? ` · NZD ${price}` : ""}</div>
          </div>
          <div class="btn-row" style="justify-content:flex-end;">
            <button class="btn secondary senderOfferUseBtn" type="button"
              data-request-id="${safeText(requestId)}"
              data-offer-id="${offerId}">Use</button>
            <button class="btn senderOfferAcceptBtn" type="button"
              data-request-id="${safeText(requestId)}"
              data-offer-id="${offerId}">Accept</button>
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

function setupSenderOffersActions() {
  document.addEventListener("click", async (e) => {
    const useBtn = e.target.closest(".senderOfferUseBtn");
    const accBtn = e.target.closest(".senderOfferAcceptBtn");

    const btn = useBtn || accBtn;
    if (!btn) return;

    const requestId = String(btn.dataset.requestId || "").trim();
    const offerId = String(btn.dataset.offerId || "").trim();
    if (!requestId || !offerId) return;

    // Fill the accept form for transparency (optional)
    const acceptForm = document.getElementById("acceptOfferForm");
    if (acceptForm) {
      if (acceptForm.request_id) acceptForm.request_id.value = requestId;
      if (acceptForm.offer_id) acceptForm.offer_id.value = offerId;
    }

    if (useBtn) {
      // Just fill the form; do not submit.
      const out = document.getElementById("acceptOfferResult");
      if (out) setResult(out, alertSuccess("Offer ID filled below. Click Accept when ready."));
      return;
    }

    // Accept now (same endpoint as existing accept form)
    const out = document.getElementById("acceptOfferResult") || document.getElementById("viewOffersResult") || document.getElementById("viewRequestResult");
    btn.disabled = true;
    const old = btn.textContent;
    btn.textContent = "Accepting…";

    // Restore sender token (if any) for this request
    try {
      const tok = loadSenderTokenForRequest(requestId);
      if (tok) sessionStorage.setItem("dm_sender_token", tok);
    } catch (_) {}

    const res = await api(
      `/requests/${encodeURIComponent(requestId)}/offers/${encodeURIComponent(offerId)}/accept`,
      { method: "POST", role: "sender", body: {} }
    );

    btn.disabled = false;
    btn.textContent = old;

    if (out) setResult(out, res.ok ? alertSuccess("Offer accepted") : alertError(res.error || "Failed"));

    // Refresh current view
    try {
      const viewForm = document.getElementById("viewRequestForm");
      if (viewForm) viewForm.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    } catch (_) {}
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
   Init
--------------------------------------------------------- */
export function initSenderPage() {
  console.log("Sender page loaded");

  setupRegistration();
  setupLogin();
  setupSenderAuthControls();

  setupSenderAckGate();
  enforceSenderGate();

  setupCreateRequest();
  setupViewRequest();
  setupAcceptOffer();
  setupFundEscrow();
  setupReleaseEscrow();
  setupSenderRecentUI();
  setupSenderQuickActions();
  setupIssueReport_sender();

  setupSenderOffersActions();
  handlePaidRedirectRefresh();
}
