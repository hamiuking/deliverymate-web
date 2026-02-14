// public/js/driver.js
// Full replacement (minimal additive UX improvements)
// - Adds counts: #driverAssignedCount and #driverOpenCount
// - Adds safe auto-refresh (open+assigned) when unlocked, pauses when tab hidden
// - Keeps existing flows intact

import { api } from "./api.js";
import { $ } from "./utils.js";
import { alertSuccess, alertError } from "./components/alerts.js";
import { getFormData } from "./components/forms.js";
import { statusPill, timeline, nextActionText } from "./components/status.js";

/* -----------------------------
   Small helpers
----------------------------- */
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

function escapeHtml(v) {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function saveUserToken(tok) {
  if (!tok) return;
  const t = String(tok);

  // What api.js expects:
  localStorage.setItem("dm_user_token", t);
  sessionStorage.setItem("dm_user_token", t);

  // Optional: driver-only backup (harmless)
  localStorage.setItem("dm_driver_user_token", t);
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

/* -----------------------------
   Auto-refresh (safe)
----------------------------- */
let dmDriverAutoTimer = null;

function stopDriverAutoRefresh() {
  if (dmDriverAutoTimer) {
    clearInterval(dmDriverAutoTimer);
    dmDriverAutoTimer = null;
  }
}

function startDriverAutoRefresh() {
  stopDriverAutoRefresh();

  // Only auto-refresh when unlocked
  if (!isDriverRegistered()) return;

  const tick = async () => {
    // Pause if tab hidden
    if (document.visibilityState !== "visible") return;

    try { await refreshDriverOpenJobs(); } catch (_) {}
    try { await refreshDriverAssignedJobs(); } catch (_) {}
  };

  // Initial tick
  tick();

  // Refresh cadence
  dmDriverAutoTimer = setInterval(tick, 25000); // 25s
}

/* -----------------------------
   Gate: show Auth area when locked; show Dashboard when unlocked
----------------------------- */
function enforceDriverGate() {
  const locked = !isDriverRegistered();

  const authArea = document.getElementById("driverAuthArea");
  const dash = document.getElementById("driverDashboard");
  if (authArea) authArea.classList.toggle("hidden", !locked);
  if (dash) dash.classList.toggle("hidden", locked);

  const status = document.getElementById("driverAuthStatus");
  const statusDash = document.getElementById("driverAuthStatusDash");

  const u = getSavedDriverUser();
  const msg = locked
    ? "Please register or log in to access the driver dashboard."
    : (u?.phone ? `Logged in: ${u.phone}` : "Driver dashboard unlocked.");

  if (status) status.textContent = msg;
  if (statusDash) statusDash.textContent = msg;

  const logoutBtn = document.getElementById("driverLogoutBtn");
  if (logoutBtn) logoutBtn.classList.toggle("hidden", locked);

  const hint = document.getElementById("driverAuthHint");
  if (hint) hint.textContent = locked ? "" : (u?.phone ? `Logged in as ${u.phone}` : "Logged in");
}

/* -----------------------------
   Driver acknowledgements gate
   IMPORTANT: must match backend DRIVER_ACK_VERSION (default 'v2')
----------------------------- */
const DRIVER_ACK_VERSION = "v2";
const DRIVER_ACK_KEY = "dm_driver_ack_v2_ts";

function getDriverAckMeta() {
  const ts = localStorage.getItem(DRIVER_ACK_KEY) || new Date().toISOString();
  return { driver_ack_version: DRIVER_ACK_VERSION, driver_ack_ts: ts };
}

function setupDriverAckGate() {
  const a1 = document.getElementById("dAck1");
  const a2 = document.getElementById("dAck2");
  const a3 = document.getElementById("dAck3");
  const offerBtn = document.getElementById("driverOfferBtn");
  const statusBtn = document.getElementById("driverStatusBtn");
  const lastEl = document.getElementById("driverAckLast");
  if (!a1 || !a2 || !a3) return;

  const renderLast = () => {
    if (!lastEl) return;
    const ts = localStorage.getItem(DRIVER_ACK_KEY);
    if (!ts) { lastEl.textContent = ""; return; }
    const d = new Date(ts);
    if (isNaN(d.getTime())) { lastEl.textContent = ""; return; }
    lastEl.textContent = `· Last agreed on this device: ${d.toLocaleString()}`;
  };

  const prev = localStorage.getItem(DRIVER_ACK_KEY);
  if (prev) { a1.checked = true; a2.checked = true; a3.checked = true; }

  const refresh = () => {
    const ok = a1.checked && a2.checked && a3.checked;
    if (offerBtn) offerBtn.disabled = !ok;
    if (statusBtn) statusBtn.disabled = !ok;

    if (ok) localStorage.setItem(DRIVER_ACK_KEY, new Date().toISOString());
    renderLast();
  };

  a1.addEventListener("change", refresh);
  a2.addEventListener("change", refresh);
  a3.addEventListener("change", refresh);
  refresh();
}

/* -----------------------------
   Image helper: 6MB original, compress to <=2MB dataURL
----------------------------- */
const MAX_ORIGINAL_BYTES = 6 * 1024 * 1024; // 6MB
const MAX_FINAL_BYTES = 2 * 1024 * 1024;    // 2MB compressed
const MAX_WIDTH = 1600;
const JPEG_QUALITY = 0.75;

function fmtMB(bytes) {
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(2)}MB`;
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

async function fileToDataUrl(file) {
  if (!file) throw new Error("No photo selected");
  if (file.size > MAX_ORIGINAL_BYTES) throw new Error(`Photo too large (${fmtMB(file.size)}). Max 6MB.`);

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
  if (byteSize > MAX_FINAL_BYTES) {
    throw new Error("Photo still too large after compression (max 2MB). Use a smaller image.");
  }
  return dataUrl;
}

/* -----------------------------
   Registration: cache selected files so submit-time checks never “lose” them
----------------------------- */
function setupDriverRegistration() {
  const form = $("#driverRegForm");
  const result = $("#driverRegResult");
  if (!form) return;

  const frontInput = form.querySelector("#driver_license_front_file");
  const backInput = form.querySelector("#driver_license_back_file");
  const applyBtn = form.querySelector('button[type="submit"]');

  const frontStatus = document.getElementById("dlFrontStatus");
  const backStatus = document.getElementById("dlBackStatus");

  let selectedFrontFile = null;
  let selectedBackFile = null;

  function setFileStatus(el, file) {
    if (!el) return;
    if (!file) { el.textContent = ""; return; }
    if (file.size > MAX_ORIGINAL_BYTES) {
      el.textContent = `Too large (${fmtMB(file.size)}). Max 6MB.`;
      return;
    }
    el.textContent = `Ready ✓ (${fmtMB(file.size)})`;
  }

  function canEnableApply() {
    const invite = String(form.invite_code?.value || "").trim();
    const phone = String(form.phone?.value || "").trim();
    const lic = String(form.license_number?.value || "").trim();
    const wof = String(form.wof_expiry?.value || "").trim();

    if (!selectedFrontFile || !selectedBackFile) return false;
    if (selectedFrontFile.size > MAX_ORIGINAL_BYTES) return false;
    if (selectedBackFile.size > MAX_ORIGINAL_BYTES) return false;

    return !!(invite && phone && lic && wof);
  }

  function refreshApplyEnabled() {
    if (!applyBtn) return;
    applyBtn.disabled = !canEnableApply();
  }

  refreshApplyEnabled();
  form.addEventListener("input", refreshApplyEnabled);
  form.addEventListener("change", refreshApplyEnabled);

  if (frontInput) {
    frontInput.addEventListener("change", () => {
      selectedFrontFile = frontInput.files?.[0] || null;
      setFileStatus(frontStatus, selectedFrontFile);
      refreshApplyEnabled();
    });
  }
  if (backInput) {
    backInput.addEventListener("change", () => {
      selectedBackFile = backInput.files?.[0] || null;
      setFileStatus(backStatus, selectedBackFile);
      refreshApplyEnabled();
    });
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!applyBtn) return;

    if (!canEnableApply()) {
      setResult(result, alertError("Please complete all required fields and upload both driver licence photos (max 6MB each)."));
      refreshApplyEnabled();
      return;
    }

    const done = setWorking(applyBtn, "Uploading & applying…");
    setResult(result, "");

    const data = getFormData(form);

    const frontFile = selectedFrontFile;
    const backFile = selectedBackFile;

    if (!frontFile || !backFile) {
      done(false);
      setResult(result, alertError("Driver licence photos are required (front + back)."));
      return;
    }

    try {
      data.driver_license_front_base64 = await fileToDataUrl(frontFile);
      data.driver_license_back_base64 = await fileToDataUrl(backFile);
    } catch (err) {
      done(false);
      setResult(result, alertError(err?.message || "Failed to process licence photos"));
      return;
    }

    const res = await api("/users/driver/apply", { method: "POST", body: data });

    done(!!res.ok);
    if (res.ok) {
      saveUserToken(res.user_token || res.userToken || res.auth_token);
      markDriverRegistered(res.user);
      enforceDriverGate();
      setResult(result, alertSuccess("Submitted"));
    } else {
      const msg = res.details
        ? `${res.error}<br><span class="muted">${escapeHtml(res.details)}</span>`
        : res.error;
      setResult(result, alertError(msg || "Failed"));
    }
  });
}

/* -----------------------------
   Login / Logout
----------------------------- */
function setupDriverLogin() {
  const form = document.getElementById("driverLoginForm");
  const hint = document.getElementById("driverAuthHint");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const phone = String(fd.get("phone") || "").trim();

    if (!phone) {
      if (hint) hint.textContent = "Phone is required";
      return;
    }

    if (hint) hint.textContent = "Logging in…";

    const res = await api("/users/login", { method: "POST", body: { phone } });

    if (!res.ok) {
      if (hint) hint.textContent = res.error || "Login failed";
      return;
    }

    saveUserToken(res.user_token);
    markDriverRegistered(res.user);
    enforceDriverGate();
    if (hint) hint.textContent = `Logged in as ${res.user?.phone || phone}`;

    // ✅ After login, refresh lists + start auto-refresh
    try { refreshDriverAssignedJobs(); } catch (_) {}
    try { startDriverAutoRefresh(); } catch (_) {}
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

    // clear tokens
    sessionStorage.removeItem("dm_driver_token");
    sessionStorage.removeItem("dm_user_token");
    localStorage.removeItem("dm_user_token");
    localStorage.removeItem("dm_driver_user_token");

    // ✅ stop auto-refresh
    stopDriverAutoRefresh();

    enforceDriverGate();
    if (hint) hint.textContent = "";

    // Clear counts (optional)
    const a = document.getElementById("driverAssignedCount");
    if (a) a.textContent = "";
    const o = document.getElementById("driverOpenCount");
    if (o) o.textContent = "";
  });
}

/* -----------------------------
   Make Offer
----------------------------- */
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

    const u = getSavedDriverUser();
    if (u?.phone) data.driver_phone = u.phone;
    if (u?.full_name) data.driver_name = u.full_name;

    const res = await api(`/requests/${requestId}/offers`, {
      method: "POST",
      body: data,
      role: "driver",
    });

    done(!!res.ok);
    if (res.ok) setResult(result, alertSuccess("Offer sent"));
    else setResult(result, alertError(res.error || "Failed"));
  });
}

/* -----------------------------
   Assigned jobs -> populate existing "Recent jobs" card
----------------------------- */
async function refreshDriverAssignedJobs() {
  const sel = document.getElementById("driverRecentSelect");
  if (!sel) return;

  const countEl = document.getElementById("driverAssignedCount");

  // ✅ Guard: don't call driver-only endpoint unless unlocked/authenticated
  if (!isDriverRegistered()) {
    sel.innerHTML = `<option value="">(Log in to see assigned jobs)</option>`;
    if (countEl) countEl.textContent = "";
    return;
  }

  sel.innerHTML = `<option value="">Loading…</option>`;
  if (countEl) countEl.textContent = "";

  const res = await api("/driver/requests", { method: "GET", role: "driver" });
  if (!res || !res.ok) {
    sel.innerHTML = `<option value="">(Failed to load jobs)</option>`;
    if (countEl) countEl.textContent = "Assigned jobs: ?";
    return;
  }

  const list = Array.isArray(res.requests) ? res.requests : [];
  if (countEl) countEl.textContent = `Assigned jobs: ${list.length}`;

  sel.innerHTML = "";

  if (list.length === 0) {
    sel.innerHTML = `<option value="">(No assigned jobs)</option>`;
    return;
  }

  sel.insertAdjacentHTML("beforeend", `<option value="">Select a job…</option>`);

  for (const r of list) {
    const id = String(r.id || "");
    const status = String(r.status || "");
    const pickup = String(r.pickup_suburb || "");
    const dropoff = String(r.dropoff_suburb || "");
    const label = `#${id} · ${pickup} → ${dropoff} · ${status}`;

    const opt = document.createElement("option");
    opt.value = id;
    opt.textContent = label;
    sel.appendChild(opt);
  }
}

function setupDriverRecentJobsAssigned() {
  const sel = document.getElementById("driverRecentSelect");
  const useBtn = document.getElementById("driverRecentUseBtn");
  const clearBtn = document.getElementById("driverRecentClearBtn");
  const viewForm = document.getElementById("driverViewForm");
  if (!sel || !useBtn || !clearBtn || !viewForm) return;

  const loadSelected = () => {
    const id = String(sel.value || "").trim();
    if (!id) return;

    viewForm.request_id.value = id;
    viewForm.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
  };

  useBtn.addEventListener("click", loadSelected);
  sel.addEventListener("change", loadSelected);

  clearBtn.addEventListener("click", () => {
    refreshDriverAssignedJobs();
  });

  refreshDriverAssignedJobs();
}

/* -----------------------------
   Open jobs (marketplace) list
----------------------------- */
function formatOpenJobLine(r) {
  const id = String(r?.id ?? "");
  const pickup = String(r?.pickup_suburb ?? "");
  const dropoff = String(r?.dropoff_suburb ?? "");
  const item = String(r?.item_description ?? r?.item ?? r?.description ?? "");
  const status = String(r?.status ?? "");
  const price = r?.price_nzd ?? r?.sender_price_nzd ?? r?.budget_nzd;

  const bits = [];
  bits.push(`#${id}`);
  if (pickup || dropoff) bits.push(`${pickup} → ${dropoff}`);
  if (item) bits.push(item.length > 60 ? item.slice(0, 60) + "…" : item);
  if (price != null && price !== "") bits.push(`$${price}`);
  if (status) bits.push(status);

  return bits.filter(Boolean).join(" · ");
}

async function refreshDriverOpenJobs() {
  const listEl = document.getElementById("driverOpenJobsList");
  const resultEl = document.getElementById("driverOpenJobsResult");
  if (!listEl) return;

  const countEl = document.getElementById("driverOpenCount");

  listEl.innerHTML = `<div class="muted">Loading…</div>`;
  if (resultEl) resultEl.innerHTML = "";

  const res = await api("/requests", { method: "GET", role: "driver" });
  if (!res || !res.ok) {
    listEl.innerHTML = `<div class="muted">(Failed to load open jobs)</div>`;
    if (countEl) countEl.textContent = "Open jobs: ?";
    if (resultEl) setResult(resultEl, alertError(res?.error || "Load failed"));
    return;
  }

  const all = Array.isArray(res.requests) ? res.requests : [];
  const open = all.filter(r => String(r?.status || "").toLowerCase() === "open");

  if (countEl) countEl.textContent = `Open jobs: ${open.length}`;

  if (open.length === 0) {
    listEl.innerHTML = `<div class="muted">(No open jobs right now)</div>`;
    return;
  }

  listEl.innerHTML = "";
  for (const r of open.slice(0, 30)) {
    const id = String(r.id || "");
    const row = document.createElement("div");
    row.className = "card";
    row.style.padding = "10px";
    row.style.margin = "8px 0";

    row.innerHTML = `
      <div style="display:flex; justify-content:space-between; gap:10px; align-items:flex-start;">
        <div style="flex:1; min-width:0;">
          <div style="font-weight:600;">${escapeHtml(formatOpenJobLine(r))}</div>
        </div>
        <div class="btn-row" style="flex-wrap:nowrap; gap:8px;">
          <button class="btn secondary" type="button" data-act="offer" data-id="${escapeHtml(id)}">Offer</button>
          <button class="btn ghost" type="button" data-act="view" data-id="${escapeHtml(id)}">View</button>
        </div>
      </div>
    `;

    listEl.appendChild(row);
  }

  listEl.onclick = (e) => {
    const btn = e.target?.closest?.("button[data-act]");
    if (!btn) return;
    const act = btn.getAttribute("data-act");
    const id = btn.getAttribute("data-id");
    if (!id) return;

    if (act === "offer") {
      const offerForm = document.getElementById("driverOfferForm");
      if (offerForm?.request_id) {
        offerForm.request_id.value = id;
        offerForm.scrollIntoView({ behavior: "smooth", block: "start" });
        if (offerForm.price_nzd) offerForm.price_nzd.focus();
      }
    }

    if (act === "view") {
      const viewForm = document.getElementById("driverViewForm");
      if (viewForm?.request_id) {
        viewForm.request_id.value = id;
        viewForm.scrollIntoView({ behavior: "smooth", block: "start" });
        viewForm.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
      }
    }
  };
}

function setupDriverOpenJobs() {
  const btn = document.getElementById("driverOpenJobsRefreshBtn");
  if (btn) btn.addEventListener("click", refreshDriverOpenJobs);
  refreshDriverOpenJobs();
}

/* -----------------------------
   View Job
----------------------------- */
function setupViewJob() {
  const form = $("#driverViewForm");
  if (!form) return;

  const summary = document.getElementById("driverJobSummary");
  const historyList = document.getElementById("driverHistoryList");
  const result = document.getElementById("driverViewResult");

  const statusSummary = document.getElementById("driverStatusSummary");
  if (statusSummary) {
    statusSummary.innerHTML = `<div class="muted">Load a job to see its current status.</div>`;
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button[type="submit"]');
    const done = setWorking(btn, "Loading…");
    if (result) setResult(result, "");

    const requestId = form.request_id.value;
    const req = await api(`/requests/${requestId}`, { method: "GET", role: "driver" });
    const hist = await api(`/requests/${requestId}/history`, { method: "GET", role: "driver" });

    renderDriverSummary({ req, hist, summary, historyList });

    try {
      if (statusSummary) {
        if (!req || !req.ok || !req.request) {
          statusSummary.innerHTML = req?.error
            ? alertError(req.error)
            : `<div class="muted">Unable to load job status.</div>`;
        } else {
          const r = req.request;
          statusSummary.innerHTML = `
            <div class="card compact">
              ${statusPill({ request_status: r.status, escrow_status: r.escrow_status, payout_status: r.payout_status })}
              ${timeline({ request_status: r.status, escrow_status: r.escrow_status })}
              <div class="next-action" style="margin-top:8px;">
                <strong>What happens next:</strong>
                ${nextActionText({ role: "driver", request_status: r.status, escrow_status: r.escrow_status })}
              </div>
              <div class="muted" style="margin-top:10px;">
                Request #${escapeHtml(r.id)} · ${escapeHtml(r.pickup_suburb)} → ${escapeHtml(r.dropoff_suburb)}
              </div>
            </div>
          `;
        }
      }
    } catch (_) {}

    done(!!req.ok);
    if (result) setResult(result, req.ok ? alertSuccess("Loaded") : alertError(req.error || "Failed"));
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
      <div class="muted" style="margin-top:10px;">Request #${escapeHtml(r.id)} · ${escapeHtml(r.pickup_suburb)} → ${escapeHtml(r.dropoff_suburb)}</div>
    </div>
  `);

  const h = hist && hist.ok && Array.isArray(hist.events) ? hist.events : (hist?.history || []);
  if (hist && !hist.ok) {
    historyList.insertAdjacentHTML("beforeend", alertError(hist.error || "Failed to load history"));
    return;
  }
  if (!h || h.length === 0) {
    historyList.insertAdjacentHTML("beforeend", `<div class="muted">No history yet.</div>`);
    return;
  }

  historyList.insertAdjacentHTML("beforeend", `
    <div class="card compact">
      <ul style="margin:0; padding-left:18px;">
        ${h.slice(0, 12).map((ev) => {
          const when = ev.created_at ? new Date(ev.created_at).toLocaleString() : "";
          const note = ev.note || `${ev.from_status || ""} → ${ev.to_status || ""}`;
          return `<li><strong>${escapeHtml(when)}</strong> — ${escapeHtml(note)}</li>`;
        }).join("")}
      </ul>
    </div>
  `);
}

/* -----------------------------
   Update Status
----------------------------- */
function setupUpdateStatus() {
  const form = $("#driverStatusForm");
  const result = document.getElementById("driverStatusResult");
  if (!form) return;

  const deliveredFileInput = document.getElementById("delivered_photo_file");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const statusBtn = document.getElementById("driverStatusBtn");
    if (statusBtn && statusBtn.disabled) {
      if (result) setResult(result, alertError("Please confirm driver acknowledgements before submitting."));
      return;
    }

    const btn = form.querySelector('button[type="submit"]');
    const done = setWorking(btn);
    if (result) setResult(result, "");

    const requestId = form.request_id.value;
    const status = form.status.value;

    const body = { status, ...getDriverAckMeta() };

    if (status === "delivered") {
      const f = deliveredFileInput?.files?.[0];
      if (!f) {
        done(false);
        if (result) setResult(result, alertError("Delivery photo is required for delivered."));
        return;
      }
      try {
        body.delivered_photo_base64 = await fileToDataUrl(f);
      } catch (err) {
        done(false);
        if (result) setResult(result, alertError(err?.message || "Failed to process delivery photo"));
        return;
      }
    }

    const res = await api(`/requests/${requestId}/status`, { method: "PATCH", body, role: "driver" });

    done(!!res.ok);
    if (result) setResult(result, res.ok ? alertSuccess("Updated") : alertError(res.error || "Failed"));

    if (res && res.ok) {
      try {
        const viewForm = document.getElementById("driverViewForm");
        if (viewForm && viewForm.request_id && viewForm.request_id.value) {
          viewForm.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
        }
      } catch (_) {}
      try { refreshDriverAssignedJobs(); } catch (_) {}
    }
  });
}

/* -----------------------------
   Issue report (pilot helper)
----------------------------- */
function setupIssueReport_driver() {
  const form = document.getElementById("driverIssueForm");
  const out = document.getElementById("driverIssueOut");
  if (!form || !out) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const requestId = String(fd.get("request_id") || "").trim();
    const note = String(fd.get("note") || "").trim();

    const now = new Date().toISOString();
    const url = window.location.origin;
    out.textContent = [
      `DeliveryMate pilot issue report`,
      `Time: ${now}`,
      `Role: driver`,
      requestId ? `Request ID: ${requestId}` : `Request ID: (not provided)`,
      note ? `Note: ${note}` : "Note: (none)",
      `\nPlease include a screenshot if possible.`,
      `Site: ${url}`,
    ].join("\n");
  });
}

/* -----------------------------
   Init
----------------------------- */
export function initDriverPage() {
  setupDriverRegistration();
  setupDriverLogin();
  setupDriverLogout();

  enforceDriverGate();

  setupDriverAckGate();
  setupMakeOffer();
  setupViewJob();
  setupDriverRecentJobsAssigned();
  setupDriverOpenJobs();
  setupUpdateStatus();
  setupIssueReport_driver();

  // ✅ start auto-refresh if already logged in on this device
  startDriverAutoRefresh();

  // ✅ resume refresh on tab focus
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") startDriverAutoRefresh();
  });
}
