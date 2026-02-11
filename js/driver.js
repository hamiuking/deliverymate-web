// public/js/driver.js

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

function markDriverRegistered(user) {
  localStorage.setItem("dm_driver_registered", "1");
  if (user) {
    localStorage.setItem("dm_user_driver", JSON.stringify(user));
    sessionStorage.setItem("dm_user_driver", JSON.stringify(user));
  }
}

function isDriverRegistered() {
  return localStorage.getItem("dm_driver_registered") === "1";
}

function getSavedDriverUser() {
  try {
    const raw = localStorage.getItem("dm_user_driver");
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function saveUserToken(tok) {
  if (!tok) return;
  localStorage.setItem("dm_user_token", String(tok));
  sessionStorage.setItem("dm_user_token", String(tok));
}

function enforceDriverGate() {
  const locked = !isDriverRegistered();
  document.body.classList.toggle("locked", locked);
  document.body.classList.toggle("unlocked", !locked);

  const status = document.getElementById("driverAuthStatus");
  const u = getSavedDriverUser();
  if (status) {
    status.textContent = locked
      ? "Please register or log in to access the driver dashboard."
      : (u?.phone ? `Logged in: ${u.phone}` : "Driver dashboard unlocked.");
  }

  // Hide register section once unlocked
  const reg = document.getElementById("driverRegisterSection");
  if (reg) reg.classList.toggle("hidden", !locked);

  // Logout only when unlocked
  const logoutBtn = document.getElementById("driverLogoutBtn");
  if (logoutBtn) logoutBtn.classList.toggle("hidden", locked);

  const hint = document.getElementById("driverAuthHint");
  if (hint) hint.textContent = locked ? "" : (u?.phone ? `Logged in as ${u.phone}` : "Logged in");
}

// --- Recent jobs (local-only; pilot convenience) ---
const DRIVER_RECENT_KEY = "dm_driver_recent_requests";

function loadDriverRecent() {
  try {
    return JSON.parse(localStorage.getItem(DRIVER_RECENT_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveDriverRecent(list) {
  try {
    localStorage.setItem(DRIVER_RECENT_KEY, JSON.stringify(list));
  } catch {}
}

function addDriverRecent(item) {
  const id = item?.id
    ? String(item.id)
    : item?.request_id
    ? String(item.request_id)
    : "";
  if (!id) return;
  const rec = {
    id,
    pickup: item.pickup_suburb || "",
    dropoff: item.dropoff_suburb || "",
    status: item.status || "",
    ts: item.updated_at || item.created_at || new Date().toISOString(),
  };
  const list = loadDriverRecent().filter((x) => String(x.id) !== id);
  list.unshift(rec);
  saveDriverRecent(list.slice(0, 10));
  renderDriverRecent();
}

function renderDriverRecent() {
  const sel = document.getElementById("driverRecentSelect");
  if (!sel) return;
  const list = loadDriverRecent();
  sel.innerHTML = "";
  const opt0 = document.createElement("option");
  opt0.value = "";
  opt0.textContent = list.length
    ? "Select a recent request…"
    : "No recent jobs yet";
  sel.appendChild(opt0);
  for (const it of list) {
    const o = document.createElement("option");
    o.value = String(it.id);
    const route =
      it.pickup || it.dropoff ? ` — ${it.pickup} → ${it.dropoff}` : "";
    const st = it.status ? ` [${it.status}]` : "";
    o.textContent = `#${it.id}${st}${route}`;
    sel.appendChild(o);
  }
}

function applyDriverRecent(requestId) {
  if (!requestId) return;
  const id = String(requestId);
  const forms = ["driverOfferForm", "driverViewForm", "driverStatusForm", "driverIssueForm"];
  for (const formId of forms) {
    const f = document.getElementById(formId);
    if (f && f.request_id) f.request_id.value = id;
  }
}

function setupDriverRecentUI() {
  const sel = document.getElementById("driverRecentSelect");
  const useBtn = document.getElementById("driverRecentUseBtn");
  const clearBtn = document.getElementById("driverRecentClearBtn");
  if (!sel) return;
  renderDriverRecent();

  if (useBtn) useBtn.addEventListener("click", () => applyDriverRecent(sel.value));
  sel.addEventListener("change", () => { if (sel.value) applyDriverRecent(sel.value); });
  if (clearBtn) clearBtn.addEventListener("click", () => { saveDriverRecent([]); renderDriverRecent(); });
}

/* ---------------------------------------------------------
   Driver acknowledgement gate
--------------------------------------------------------- */
const DRIVER_ACK_VERSION = "driver_ack_v1";
const DRIVER_ACK_KEY = "dm_driver_ack_v1_ts";

function setupDriverAckGate() {
  const a1 = document.getElementById("dAck1");
  const a2 = document.getElementById("dAck2");
  const a3 = document.getElementById("dAck3");

  const offerBtn = document.getElementById("driverOfferBtn");
  const statusBtn = document.getElementById("driverStatusBtn");

  if (!a1 || !a2 || !a3) return;

  const prevTs = localStorage.getItem(DRIVER_ACK_KEY);
  if (prevTs) { a1.checked = true; a2.checked = true; a3.checked = true; }

  const refresh = () => {
    const ok = a1.checked && a2.checked && a3.checked;
    if (offerBtn) offerBtn.disabled = !ok;
    if (statusBtn) statusBtn.disabled = !ok;
    if (ok) localStorage.setItem(DRIVER_ACK_KEY, new Date().toISOString());
  };

  a1.addEventListener("change", refresh);
  a2.addEventListener("change", refresh);
  a3.addEventListener("change", refresh);

  refresh();
}

function getDriverAckMeta() {
  const ts = localStorage.getItem(DRIVER_ACK_KEY) || new Date().toISOString();
  return { driver_ack_version: DRIVER_ACK_VERSION, driver_ack_ts: ts };
}

/* ---------------------------------------------------------
   Helpers: delivery photo compression + size limits
--------------------------------------------------------- */
const MAX_ORIGINAL_BYTES = 6 * 1024 * 1024; // 6MB
const MAX_FINAL_BYTES = 2 * 1024 * 1024;    // 2MB after compression
const MAX_WIDTH = 1600;
const JPEG_QUALITY = 0.75;

async function fileToDataUrl(file) {
  if (!file) throw new Error("No photo selected");
  if (file.size > MAX_ORIGINAL_BYTES) throw new Error("Photo too large (max 6MB). Please use a smaller image.");

  const img = await loadImage(file);
  const scale = Math.min(1, MAX_WIDTH / img.width);
  const width = Math.round(img.width * scale);
  const height = Math.round(img.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, width, height);

  const dataUrl = canvas.toDataURL("image/jpeg", JPEG_QUALITY);

  const base64 = dataUrl.split(",")[1] || "";
  const byteSize = Math.ceil((base64.length * 3) / 4);
  if (byteSize > MAX_FINAL_BYTES) throw new Error("Photo is still too large after compression (max 2MB). Please use a smaller image.");

  return dataUrl;
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Invalid image file"));
      img.src = String(reader.result || "");
    };
    reader.onerror = () => reject(new Error("Failed to read image"));
    reader.readAsDataURL(file);
  });
}

/* ---------------------------------------------------------
   Init
--------------------------------------------------------- */
export function initDriverPage() {
  console.log("Driver page loaded");

  setupDriverRegistration();
  setupDriverLogin();
  setupDriverLogout();

  enforceDriverGate();

  setupDriverAckGate();
  setupMakeOffer();
  setupViewJob();
  setupDriverRecentUI();
  setupUpdateStatus();
  setupIssueReport_driver();
}

/* ---------------------------------------------------------
   Registration / Login / Logout
--------------------------------------------------------- */
function setupDriverRegistration() {
  const form = $("#driverRegForm");
  const result = $("#driverRegResult");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button[type="submit"]');
    const done = setWorking(btn);
    setResult(result, "");

    const data = getFormData(form);
    const res = await api("/users/driver/apply", { method: "POST", body: data });

    done(!!res.ok);
    if (res.ok) {
      saveUserToken(res.user_token || res.userToken || res.auth_token);
      markDriverRegistered(res.user);
      enforceDriverGate();
      setResult(result, alertSuccess("Submitted"));
    } else {
      setResult(result, alertError(res.error || "Failed"));
    }
  });
}

function setupDriverLogin() {
  const form = document.getElementById("driverLoginForm");
  const hint = document.getElementById("driverAuthHint");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const phone = String(fd.get("phone") || "").trim();
    const invite_code = String(fd.get("invite_code") || "").trim();

    if (hint) hint.textContent = "Logging in…";

    const res = await api("/users/login", { method: "POST", body: { phone, invite_code } });
    if (!res.ok) {
      if (hint) hint.textContent = res.error || "Login failed";
      return;
    }

    saveUserToken(res.user_token);
    markDriverRegistered(res.user);
    enforceDriverGate();

    if (hint) hint.textContent = `Logged in as ${res.user?.phone || phone}`;
  });
}

function setupDriverLogout() {
  const btn = document.getElementById("driverLogoutBtn");
  const hint = document.getElementById("driverAuthHint");
  if (!btn) return;

  btn.addEventListener("click", () => {
    localStorage.removeItem("dm_driver_registered");
    localStorage.removeItem("dm_user_driver");
    sessionStorage.removeItem("dm_user_driver");
    sessionStorage.removeItem("dm_driver_token");
    sessionStorage.removeItem("dm_user_token");
    localStorage.removeItem("dm_user_token");

    enforceDriverGate();
    if (hint) hint.textContent = "";
  });
}

/* ---------------------------------------------------------
   Make Offer (requires ack)
--------------------------------------------------------- */
function setupMakeOffer() {
  const form = $("#driverOfferForm");
  const result = $("#driverOfferResult");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const offerBtn = document.getElementById("driverOfferBtn");
    if (offerBtn && offerBtn.disabled) {
      setResult(result, alertError("Please confirm driver acknowledgements before submitting."));
      return;
    }

    const btn = form.querySelector('button[type="submit"]');
    const done = setWorking(btn);
    setResult(result, "");

    const data = getFormData(form);
    const requestId = data.request_id;
    delete data.request_id;

    Object.assign(data, getDriverAckMeta());

    try {
      const u = getSavedDriverUser();
      if (u && u.phone) data.driver_phone = u.phone;
      if (u && u.full_name) data.driver_name = u.full_name;
    } catch (_) {}

    const res = await api(`/requests/${requestId}/offers`, { method: "POST", body: data, role: "driver" });

    done(!!res.ok);
    if (res.ok) setResult(result, alertSuccess("Offer sent"));
    else setResult(result, alertError(res.error || "Failed"));
  });
}

/* ---------------------------------------------------------
   View job
--------------------------------------------------------- */
function setupViewJob() {
  const form = $("#driverViewForm");
  if (!form) return;

  const summary = $("#driverJobSummary");
  const historyList = $("#driverHistoryList");
  const result = $("#driverViewResult");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button[type="submit"]');
    const done = setWorking(btn, "Loading…");
    setResult(result, "");

    const requestId = form.request_id.value;
    const req = await api(`/requests/${requestId}`);
    const hist = await api(`/requests/${requestId}/history`);

    if (req && req.ok && req.request) addDriverRecent(req.request);
    renderDriverSummary({ req, hist, summary, historyList });

    done(!!req.ok);
    if (req.ok) setResult(result, alertSuccess("Loaded"));
    else setResult(result, alertError(req.error || "Failed"));
  });
}

function renderDriverSummary({ req, hist, summary, historyList }) {
  if (!summary || !historyList) return;
  summary.innerHTML = "";
  historyList.innerHTML = "";

  if (!req || !req.ok || !req.request) {
    summary.insertAdjacentHTML("beforeend", alertError(req?.error || "Failed to load job"));
    return;
  }

  const r = req.request;
  summary.insertAdjacentHTML("beforeend", `
    <div class="card compact">
      ${statusPill({ request_status: r.status, escrow_status: r.escrow_status, payout_status: r.payout_status })}
      ${timeline({ request_status: r.status, escrow_status: r.escrow_status })}
      <div class="next-action"><strong>What happens next:</strong> ${nextActionText({ role: "driver", request_status: r.status, escrow_status: r.escrow_status })}</div>
      <div class="muted" style="margin-top:10px;">Request #${safeText(r.id)} · ${safeText(r.pickup_suburb)} → ${safeText(r.dropoff_suburb)}</div>
    </div>
  `);

  const h = hist && hist.ok && Array.isArray(hist.history) ? hist.history : [];
  if (hist && !hist.ok) {
    historyList.insertAdjacentHTML("beforeend", alertError(hist.error || "Failed to load history"));
  } else if (h.length === 0) {
    historyList.insertAdjacentHTML("beforeend", `<div class="muted">No history yet.</div>`);
  } else {
    historyList.insertAdjacentHTML("beforeend", `
      <div class="card compact">
        <ul style="margin:0; padding-left:18px;">
          ${h.slice(0, 12).map((ev) => {
            const when = ev.created_at ? new Date(ev.created_at).toLocaleString() : "";
            const note = ev.note || `${ev.from_status || ""} → ${ev.to_status || ""}`;
            return `<li><strong>${safeText(when)}</strong> — ${safeText(note)}</li>`;
          }).join("")}
        </ul>
      </div>
    `);
  }
}

/* ---------------------------------------------------------
   Update Status (requires ack + delivered photo)
--------------------------------------------------------- */
function setupUpdateStatus() {
  const form = $("#driverStatusForm");
  const result = $("#driverStatusResult");
  if (!form) return;

  const deliveredFileInput = document.getElementById("delivered_photo_file");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const statusBtn = document.getElementById("driverStatusBtn");
    if (statusBtn && statusBtn.disabled) {
      setResult(result, alertError("Please confirm driver acknowledgements before submitting."));
      return;
    }

    const btn = form.querySelector('button[type="submit"]');
    const done = setWorking(btn);
    setResult(result, "");

    const requestId = form.request_id.value;
    const status = form.status.value;
    const driverName = form.driver_name ? form.driver_name.value : "";

    const body = { status, driver_name: driverName, ...getDriverAckMeta() };

    if (status === "delivered") {
      const f = deliveredFileInput?.files?.[0];
      if (!f) {
        done(false);
        setResult(result, alertError("Delivery photo is required for delivered."));
        deliveredFileInput?.focus();
        return;
      }
      try {
        body.delivered_photo_base64 = await fileToDataUrl(f);
      } catch (err) {
        done(false);
        setResult(result, alertError(err?.message || "Failed to process delivery photo"));
        return;
      }
    }

    const res = await api(`/requests/${requestId}/status`, { method: "PATCH", body, role: "driver" });

    done(!!res.ok);
    if (res.ok) setResult(result, alertSuccess("Updated"));
    else setResult(result, alertError(res.error || "Failed"));
  });
}

/* ---------------------------------------------------------
   Issue report
--------------------------------------------------------- */
function setupIssueReport_driver() {
  const form = document.getElementById("driverIssueForm");
  const out = document.getElementById("driverIssueOut");
  if (!form || !out) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const requestId = String(fd.get("request_id") || "").trim();
    const note = String(fd.get("note") || "").trim();

    let snapshot = "";
    if (requestId) {
      const req = await api(`/requests/${encodeURIComponent(requestId)}`, { role: "driver" });
      if (req && req.ok && req.request) {
        const r = req.request;
        snapshot = `Status: ${r.status}\nEscrow: ${r.escrow_status}\nPayout: ${r.payout_status}\nPickup: ${safeText(r.pickup_suburb)}\nDrop-off: ${safeText(r.dropoff_suburb)}`;
      } else {
        snapshot = `Status snapshot: (unable to load request)`;
      }
    }

    const now = new Date().toISOString();
    const url = window.location.origin;
    out.textContent = [
      `DeliveryMate pilot issue report`,
      `Time: ${now}`,
      `Role: driver`,
      requestId ? `Request ID: ${requestId}` : `Request ID: (not provided)`,
      snapshot ? `\n${snapshot}\n` : "",
      note ? `Note: ${note}` : "Note: (none)",
      `\nPlease include a screenshot if possible.`,
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
