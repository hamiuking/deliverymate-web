// public/js/sender.js

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

  if (status) {
    if (locked) {
      status.textContent = "Please register or log in to access the sender dashboard.";
    } else {
      const u = getSavedUser();
      status.textContent = u?.phone ? `Sender dashboard unlocked (${u.phone}).` : "Sender dashboard unlocked.";
    }
  }
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
  if (!sel) return;
  const list = loadSenderRecent();
  sel.innerHTML = "";

  const opt0 = document.createElement("option");
  opt0.value = "";
  opt0.textContent = list.length ? "Select a recent request…" : "No recent requests yet";
  sel.appendChild(opt0);

  for (const it of list) {
    const o = document.createElement("option");
    o.value = String(it.id);
    const route = it.pickup || it.dropoff ? ` — ${it.pickup} → ${it.dropoff}` : "";
    const st = it.status ? ` [${it.status}]` : "";
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
  const useBtn = document.getElementById("senderRecentUseBtn");
  const clearBtn = document.getElementById("senderRecentClearBtn");
  if (!sel) return;

  renderSenderRecent();

  if (useBtn) useBtn.addEventListener("click", () => applySenderRecent(sel.value));
  sel.addEventListener("change", () => {
    if (sel.value) applySenderRecent(sel.value);
  });

  if (clearBtn)
    clearBtn.addEventListener("click", () => {
      saveSenderRecent([]);
      renderSenderRecent();
    });
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

    out.textContent = pretty(res);
    maybeOpenDetails(out, !res.ok);
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

    out.textContent = pretty(res);
    maybeOpenDetails(out, !res.ok);
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

    out.textContent = pretty(res);
    maybeOpenDetails(out, !res.ok);
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

    if (reqOut) reqOut.textContent = pretty(req);
    if (offersOut) offersOut.textContent = pretty(offers);
    if (historyOut) historyOut.textContent = pretty(hist);

    // Restore sender token for subsequent sender-only actions on this request
    try {
      const tok = loadSenderTokenForRequest(requestId);
      if (tok) sessionStorage.setItem("dm_sender_token", tok);
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

    // ✅ Fix: restore sender token if available (same as fund/release)
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

    if (out) out.textContent = pretty(res);
    maybeOpenDetails(out, !res.ok);
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

    // ✅ Correct backend endpoint
    const res = await api(`/requests/${encodeURIComponent(requestId)}/escrow/fund`, {
      method: "POST",
      role: "sender",
      body: { amount_nzd: amount }
    });

    if (out) out.textContent = pretty(res);
    maybeOpenDetails(out, !res.ok);
    done(!!res.ok);

    if (res.ok && res.url) {
      setResult(result, alertSuccess("Redirecting to Stripe Checkout…"));
      window.location.href = res.url;
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

    const res = await api(`/requests/${encodeURIComponent(requestId)}/release`, {
      method: "POST",
      role: "sender",
      body: {},
    });

    if (out) out.textContent = pretty(res);
    maybeOpenDetails(out, !res.ok);
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
        snapshot = `Status: ${r.status}\nEscrow: ${r.escrow_status}\nPayout: ${r.payout_status}\nPickup: ${safeText(r.pickup_suburb)}\nDrop-off: ${safeText(r.dropoff_suburb)}`;
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
  setupIssueReport_sender();
}
