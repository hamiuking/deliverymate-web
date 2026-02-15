// public/js/driver.js
// Full replacement (minimal additive UX improvements)
// - Populates #driverStatusSummary (Current job status card) when a job is loaded
// - On successful status update: auto-refresh current job + refresh recent jobs list
// - Login sends phone only (invite_code ignored if present), matching backend
// - Adds "Open jobs" list (client-filtered from /requests) + 1-click fill Offer/View
// - Keeps ack gating, photo handling, registration/login/logout, offer/status flows intact
// - NEW: Open-jobs "View" becomes safe Preview (no protected endpoints) unless job is assigned to driver

import { api } from "./api.js";
import { $ } from "./utils.js";
import { alertSuccess, alertError } from "./components/alerts.js";
import { getFormData } from "./components/forms.js";
import { statusPill, timeline, nextActionText } from "./components/status.js";
import { startPolling } from "./polling.js";

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
   NEW: Smart Next Action Banner for Drivers
----------------------------- */
function updateDriverNextActionBanner(requestData) {
  const banner = document.getElementById("driverNextActionBanner");
  if (!banner) return;

  if (!requestData || !requestData.id) {
    banner.innerHTML = `
      <div class="alert" style="background: rgba(59,130,246,.08); border-color: rgba(59,130,246,.2); color: #1e3a8a;">
        <strong>🔍 No active jobs</strong>
        <div class="muted" style="margin-top:4px;">Browse open jobs below and submit offers to get started.</div>
      </div>
    `;
    return;
  }

  const r = requestData;
  const status = String(r.status || "").toLowerCase();
  const escrowStatus = String(r.escrow_status || "none").toLowerCase();
  const driverName = r.driver_name || r.assigned_driver_name || "";
  const u = getSavedDriverUser();
  const myName = u?.full_name || u?.phone || "";
  
  // Check if this job is assigned to me
  const isMyJob = driverName && myName && String(driverName).toLowerCase().includes(String(myName).toLowerCase());

  let html = "";

  // State: Open (not assigned to me)
  if (status === "open" && !isMyJob) {
    html = `
      <div class="alert" style="background: rgba(59,130,246,.08); border-color: rgba(59,130,246,.2); color: #1e3a8a;">
        <strong>📋 Open job available</strong>
        <div class="muted" style="margin-top:4px;">Submit an offer if you're interested in this delivery.</div>
      </div>
    `;
  }

  // State: Offer submitted, waiting for acceptance
  if (status === "open" && isMyJob) {
    html = `
      <div class="alert" style="background: rgba(245,158,11,.08); border-color: rgba(245,158,11,.2); color: #78350f;">
        <strong>⏳ Offer submitted</strong>
        <div class="muted" style="margin-top:4px;">Waiting for sender to accept your offer on Request #${r.id}.</div>
      </div>
    `;
  }

  // State: Accepted, waiting for escrow funding
  if (status === "accepted" && escrowStatus === "none" && isMyJob) {
    html = `
      <div class="alert" style="background: rgba(245,158,11,.08); border-color: rgba(245,158,11,.2); color: #78350f;">
        <strong>✓ Offer accepted!</strong>
        <div class="muted" style="margin-top:4px;">Waiting for sender to fund escrow. You'll be notified when ready for pickup.</div>
      </div>
    `;
  }

  // State: Accepted, escrow funded, ready for pickup!
  if (status === "accepted" && escrowStatus === "funded" && isMyJob) {
    html = `
      <div class="alert" style="background: rgba(34,197,94,.08); border-color: rgba(34,197,94,.2); color: #166534;">
        <strong>💰 Payment confirmed - Ready for pickup!</strong>
        <div class="muted" style="margin-top:4px;">
          Pickup: ${escapeHtml(r.pickup_suburb || "—")} · Drop-off: ${escapeHtml(r.dropoff_suburb || "—")}
        </div>
        <div class="muted" style="margin-top:4px;">Mark as picked up when you collect the item.</div>
        <button class="btn mt-2" id="bannerPickupBtn" style="background: #16a34a; border-color: #16a34a;">Mark Picked Up</button>
      </div>
    `;
  }

  // State: Picked up, in transit
  if (status === "picked_up" && isMyJob) {
    html = `
      <div class="alert" style="background: rgba(59,130,246,.08); border-color: rgba(59,130,246,.2); color: #1e3a8a;">
        <strong>🚗 Item picked up - In transit</strong>
        <div class="muted" style="margin-top:4px;">Drop-off: ${escapeHtml(r.dropoff_suburb || "—")}</div>
        <div class="muted" style="margin-top:4px;">Mark as delivered when drop-off is complete (delivery photo required).</div>
        <button class="btn mt-2" id="bannerDeliverBtn" style="background: #0284c7; border-color: #0284c7;">Mark Delivered</button>
      </div>
    `;
  }

  // State: Delivered, pending release
  if (status === "delivered" && escrowStatus === "pending_release" && isMyJob) {
    html = `
      <div class="alert" style="background: rgba(245,158,11,.08); border-color: rgba(245,158,11,.2); color: #78350f;">
        <strong>✓ Marked delivered</strong>
        <div class="muted" style="margin-top:4px;">Waiting for sender confirmation (auto-release in 24 hours).</div>
      </div>
    `;
  }

  // State: Payment released!
  if (escrowStatus === "released" && isMyJob) {
    html = `
      <div class="alert success">
        <strong>💸 Payment released!</strong>
        <div class="muted" style="margin-top:4px;">Escrow released. Payout processing. Track with admin if needed.</div>
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
  const pickupBtn = document.getElementById("bannerPickupBtn");
  if (pickupBtn && !pickupBtn.__bound) {
    pickupBtn.__bound = true;
    pickupBtn.addEventListener("click", () => {
      const statusForm = document.getElementById("driverStatusForm");
      if (statusForm) {
        if (statusForm.request_id) statusForm.request_id.value = r.id;
        const statusSelect = document.getElementById("driverStatusSelect");
        if (statusSelect) statusSelect.value = "picked_up";
        statusForm.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
  }

  const deliverBtn = document.getElementById("bannerDeliverBtn");
  if (deliverBtn && !deliverBtn.__bound) {
    deliverBtn.__bound = true;
    deliverBtn.addEventListener("click", () => {
      const statusForm = document.getElementById("driverStatusForm");
      if (statusForm) {
        if (statusForm.request_id) statusForm.request_id.value = r.id;
        const statusSelect = document.getElementById("driverStatusSelect");
        if (statusSelect) statusSelect.value = "delivered";
        statusForm.scrollIntoView({ behavior: "smooth", block: "start" });
        
        // Focus on photo upload
        const photoInput = document.getElementById("delivered_photo_file");
        if (photoInput) {
          setTimeout(() => photoInput.scrollIntoView({ behavior: "smooth", block: "center" }), 500);
        }
      }
    });
  }
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
  const u = getSavedDriverUser();
  if (status) {
    status.textContent = locked
      ? "Please register or log in to access the driver dashboard."
      : (u?.phone ? `Logged in: ${u.phone}` : "Driver dashboard unlocked.");
  }

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
  // Backend only checks driver_ack_version.
  // We keep a timestamp locally for UI only.
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

  // Pre-tick if previously agreed on this device
  const prev = localStorage.getItem(DRIVER_ACK_KEY);
  if (prev) { a1.checked = true; a2.checked = true; a3.checked = true; }

  const refresh = () => {
    const ok = a1.checked && a2.checked && a3.checked;
    if (offerBtn) offerBtn.disabled = !ok;
    if (statusBtn) statusBtn.disabled = !ok;

    // Only set timestamp when all are checked
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

    // Backend login no longer requires invite_code (invite codes are onboarding only)
    const res = await api("/users/login", { method: "POST", body: { phone } });

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

    // clear tokens
    sessionStorage.removeItem("dm_driver_token");
    sessionStorage.removeItem("dm_user_token");
    localStorage.removeItem("dm_user_token");
    localStorage.removeItem("dm_driver_user_token");

    enforceDriverGate();
    if (hint) hint.textContent = "";
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

    // ✅ This is what the backend checks
    Object.assign(data, getDriverAckMeta());

    // Optional convenience fields
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
    
    // NEW: After successful offer, refresh assigned jobs and update banner
    if (res && res.ok) {
      try {
        refreshDriverAssignedJobs();
        
        // Show banner for submitted offer
        updateDriverNextActionBanner({
          id: requestId,
          status: "open",
          driver_name: getSavedDriverUser()?.full_name || "",
        });
      } catch (_) {}
    }
  });
}

/* -----------------------------
   Assigned jobs -> populate existing "Recent jobs" card
----------------------------- */
async function refreshDriverAssignedJobs() {
  const sel = document.getElementById("driverRecentSelect");
  if (!sel) return;

  sel.innerHTML = `<option value="">Loading…</option>`;

  const res = await api("/driver/requests", { method: "GET", role: "driver" });
  if (!res || !res.ok) {
    sel.innerHTML = `<option value="">(Failed to load jobs)</option>`;
    return;
  }

  const list = Array.isArray(res.requests) ? res.requests : [];

  // Track which requests are assigned to this driver (used to decide Preview vs Full View)
  dmAssignedJobIds = new Set(list.map(r => String(r?.id ?? "")));

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
  
  // NEW: Quick action buttons
  const quickViewBtn = document.getElementById("driverQuickViewBtn");
  const quickCopyBtn = document.getElementById("driverQuickCopyBtn");
  const quickUpdateBtn = document.getElementById("driverQuickUpdateBtn");
  
  if (!sel || !viewForm) return;

  const loadSelected = () => {
    const id = String(sel.value || "").trim();
    if (!id) return;

    // Fill the request id field in the View My Job form
    viewForm.request_id.value = id;

    // Trigger the existing load logic
    viewForm.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
  };

  // Keep the Use button (optional), but also auto-load when selecting
  if (useBtn) useBtn.addEventListener("click", loadSelected);
  sel.addEventListener("change", loadSelected);

  // NEW: Quick View button
  if (quickViewBtn && !quickViewBtn.__bound) {
    quickViewBtn.__bound = true;
    quickViewBtn.addEventListener("click", () => {
      const id = String(sel.value || "").trim();
      if (!id) return;
      viewForm.request_id.value = id;
      viewForm.scrollIntoView({ behavior: "smooth", block: "start" });
      viewForm.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
    });
  }

  // NEW: Quick Copy ID button
  if (quickCopyBtn && !quickCopyBtn.__bound) {
    quickCopyBtn.__bound = true;
    quickCopyBtn.addEventListener("click", async () => {
      const id = String(sel.value || "").trim();
      if (!id) return;
      try {
        await navigator.clipboard.writeText(id);
      } catch (_) {}
    });
  }

  // NEW: Quick Update Status button
  if (quickUpdateBtn && !quickUpdateBtn.__bound) {
    quickUpdateBtn.__bound = true;
    quickUpdateBtn.addEventListener("click", () => {
      const id = String(sel.value || "").trim();
      if (!id) return;
      const statusForm = document.getElementById("driverStatusForm");
      if (statusForm) {
        if (statusForm.request_id) statusForm.request_id.value = id;
        statusForm.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
  }

  // Clear just refreshes the list from server (your existing behaviour)
  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      refreshDriverAssignedJobs();
    });
  }

  // initial load
  refreshDriverAssignedJobs();
}

// Cache for open jobs preview + quick auth gating
let dmOpenJobsCache = {};          // id -> request summary
let dmAssignedJobIds = new Set();  // assigned request ids

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
function renderOpenJobPreview(r) {
  const jobSummary = document.getElementById("driverJobSummary");
  const historyList = document.getElementById("driverHistoryList");
  const statusSummary = document.getElementById("driverStatusSummary");
  const viewResult = document.getElementById("driverViewResult");

  const id = String(r?.id ?? "");
  const pickup = String(r?.pickup_suburb ?? "");
  const dropoff = String(r?.dropoff_suburb ?? "");
  const item = String(r?.item_description ?? r?.item ?? r?.description ?? "");
  const price = r?.price_nzd ?? r?.sender_price_nzd ?? r?.budget_nzd;
  const status = String(r?.status ?? "open");

  const line = formatOpenJobLine(r);

  const previewCard = `
    <div class="card compact">
      <div style="font-weight:600;">${escapeHtml(line)}</div>
      <div class="muted" style="margin-top:8px;">
        Preview only — full details and history appear after this job is assigned to you.
      </div>
      <div style="margin-top:10px;">
        <div><strong>Pickup:</strong> ${escapeHtml(pickup || "-")}</div>
        <div><strong>Drop-off:</strong> ${escapeHtml(dropoff || "-")}</div>
        ${item ? `<div style="margin-top:6px;"><strong>Item:</strong> ${escapeHtml(item)}</div>` : ``}
        ${price != null && price !== "" ? `<div style="margin-top:6px;"><strong>Sender budget:</strong> $${escapeHtml(price)}</div>` : ``}
        <div style="margin-top:6px;"><strong>Status:</strong> ${escapeHtml(status)}</div>
      </div>
    </div>
  `;

  if (statusSummary) statusSummary.innerHTML = previewCard;
  if (jobSummary) jobSummary.innerHTML = previewCard;

  if (historyList) {
    historyList.innerHTML = `<div class="muted">History is available after assignment.</div>`;
  }

  if (viewResult) {
    setResult(viewResult, alertSuccess("Preview loaded"));
  }
}

async function refreshDriverOpenJobs() {
  const listEl = document.getElementById("driverOpenJobsList");
  const resultEl = document.getElementById("driverOpenJobsResult");
  if (!listEl) return;

  listEl.innerHTML = `<div class="muted">Loading…</div>`;
  if (resultEl) resultEl.innerHTML = "";

  // Pull recent requests; filter open on the client
  const res = await api("/requests", { method: "GET", role: "driver" });
  if (!res || !res.ok) {
    listEl.innerHTML = `<div class="muted">(Failed to load open jobs)</div>`;
    if (resultEl) setResult(resultEl, alertError(res?.error || "Load failed"));
    return;
  }

  const all = Array.isArray(res.requests) ? res.requests : [];
  const open = all.filter(r => String(r?.status || "").toLowerCase() === "open");

  // Cache open jobs for safe preview (avoids calling protected endpoints for unassigned jobs)
  dmOpenJobsCache = {};
  for (const r of open) {
    const id = String(r?.id ?? "");
    if (id) dmOpenJobsCache[id] = r;
  }

  if (open.length === 0) {
    listEl.innerHTML = `<div class="muted">(No open jobs right now)</div>`;
    return;
  }

  // Render compact rows with Offer/View actions
  listEl.innerHTML = "";
  for (const r of open.slice(0, 30)) { // cap for UX
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

  // Event delegation
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
        // focus price if present
        if (offerForm.price_nzd) offerForm.price_nzd.focus();
      }
    }

  if (act === "view") {
  // If this job is assigned to this driver, allow full load (details + history)
  if (dmAssignedJobIds && dmAssignedJobIds.has(String(id))) {
    const viewForm = document.getElementById("driverViewForm");
    if (viewForm?.request_id) {
      viewForm.request_id.value = id;
      viewForm.scrollIntoView({ behavior: "smooth", block: "start" });
      viewForm.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
    }
    return;
  }

  // Otherwise: safe preview using cached marketplace data (no protected endpoints)
  const r = dmOpenJobsCache ? dmOpenJobsCache[String(id)] : null;

  if (r) {
    renderOpenJobPreview(r);
  } else {
    const viewResult = document.getElementById("driverViewResult");
    if (viewResult) setResult(viewResult, alertError("Preview unavailable."));
  }

  // Still fill the View form ID for convenience
  const viewForm = document.getElementById("driverViewForm");
  if (viewForm?.request_id) viewForm.request_id.value = id;

  // Scroll to the status card so "Preview" feels responsive
  const statusSummary = document.getElementById("driverStatusSummary");
  if (statusSummary) statusSummary.scrollIntoView({ behavior: "smooth", block: "start" });
}
  };
}

function setupDriverOpenJobs() {
  const btn = document.getElementById("driverOpenJobsRefreshBtn");
  if (btn) btn.addEventListener("click", refreshDriverOpenJobs);

  // Load once on init (safe even if card hidden)
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

  // New: top status card summary (from driver.html change)
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

    // Mirror a compact status summary into the "Current job status" card
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
    
    // NEW: Update next action banner
    if (req && req.ok && req.request) {
      try {
        updateDriverNextActionBanner(req.request);
      } catch (_) {}
    }
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

    // ✅ UX: after a successful update, refresh job view + recent jobs list
    if (res && res.ok) {
      try {
        const viewForm = document.getElementById("driverViewForm");
        if (viewForm && viewForm.request_id && viewForm.request_id.value) {
          viewForm.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
        }
      } catch (_) {}
      try {
        refreshDriverAssignedJobs();
      } catch (_) {}
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

  // Dashboard features (safe to init even when hidden)
  setupDriverAckGate();
  setupMakeOffer();
  setupViewJob();
  setupDriverRecentJobsAssigned(); // ✅ ensure dropdown loads
  setupDriverOpenJobs();           // ✅ open jobs list
  setupUpdateStatus();
  setupIssueReport_driver();
  
  // NEW: Start real-time polling for status updates
  try {
    const poller = startPolling({
      apiRole: 'driver',
      getRequestId: () => {
        const form = document.getElementById('driverViewForm');
        return form?.request_id?.value || null;
      },
      onUpdate: (request) => {
        // Silently update UI without showing "success" message
        try {
          // Update status summary card
          const statusSummary = document.getElementById("driverStatusSummary");
          if (statusSummary && request) {
            statusSummary.innerHTML = `
              <div class="card compact">
                ${statusPill({ request_status: request.status, escrow_status: request.escrow_status, payout_status: request.payout_status })}
                ${timeline({ request_status: request.status, escrow_status: request.escrow_status })}
                <div class="next-action" style="margin-top:8px;">
                  <strong>What happens next:</strong>
                  ${nextActionText({ role: "driver", request_status: request.status, escrow_status: request.escrow_status })}
                </div>
                <div class="muted" style="margin-top:10px;">
                  Request #${escapeHtml(request.id)} · ${escapeHtml(request.pickup_suburb)} → ${escapeHtml(request.dropoff_suburb)}
                </div>
              </div>
            `;
          }
          
          // Update next action banner
          updateDriverNextActionBanner(request);
        } catch (err) {
          console.error('Polling update error:', err);
        }
      },
      interval: 30000 // Poll every 30 seconds
    });
  } catch (err) {
    console.error('Failed to start polling:', err);
  }
}
