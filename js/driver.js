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
        <strong>💰 Payment escrowed — Ready for pickup!</strong>
        <div class="muted" style="margin-top:4px;">
          From: ${escapeHtml(r.pickup_suburb || "—")} · To: ${escapeHtml(r.dropoff_suburb || "—")}
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
        <div class="muted" style="margin-top:4px;">To: ${escapeHtml(r.dropoff_suburb || "—")}</div>
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

  const authStatusDash = document.getElementById("driverAuthStatusDash");
  if (authStatusDash && !locked && u) {
    authStatusDash.textContent = u.phone ? `Logged in as ${u.phone}` : "Logged in";
  }

  const logoutBtn = document.getElementById("driverLogoutBtn");
  if (logoutBtn) logoutBtn.classList.toggle("hidden", locked);

  const hint = document.getElementById("driverAuthHint");
  if (hint) hint.textContent = locked ? "" : (u?.phone ? `Logged in as ${u.phone}` : "Logged in");

  // Show/hide re-approval banner based on saved driver_status
  updateReapprovalBanner();
}

function updateReapprovalBanner() {
  const banner = document.getElementById("driverReapprovalBanner");
  if (!banner) return;
  const u = getSavedDriverUser();
  const ds = String(u?.driver_status || "").trim().toLowerCase();
  const isPending = ds === "pending_review";
  banner.classList.toggle("hidden", !isPending);

  // Disable offer buttons when pending_review
  const offerBtn = document.getElementById("driverOfferBtn");
  const inlineSubmit = document.getElementById("inlineOfferSubmitBtn");
  if (isPending) {
    if (offerBtn) { offerBtn.disabled = true; offerBtn.title = "Awaiting admin approval"; }
    if (inlineSubmit) { inlineSubmit.disabled = true; }
  }
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
    const email = String(fd.get("email") || "").trim() || undefined;

    if (!phone) {
      if (hint) hint.textContent = "Phone is required";
      return;
    }

    if (hint) hint.textContent = "Logging in…";

    // Backend login no longer requires invite_code (invite codes are onboarding only)
    const res = await api("/users/login", { method: "POST", body: { phone, ...(email && { email }) } });

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
   Active Jobs (jobs that need driver action)
----------------------------- */
async function renderDriverActiveJobs() {
  const listEl = document.getElementById("driverActiveJobsList");
  const countEl = document.getElementById("driverActiveJobsCount");
  const resultEl = document.getElementById("driverActiveJobsResult");
  
  if (!listEl) return;
  
  listEl.innerHTML = `<div class="muted">Loading...</div>`;
  if (countEl) countEl.textContent = "Loading...";
  
  const res = await api("/driver/requests", { method: "GET", role: "driver" });
  if (!res || !res.ok) {
    // ✅ Fail silently - token may not be ready yet, don't show scary errors
    listEl.innerHTML = `<div class="muted">No active jobs. Browse open jobs below to make offers!</div>`;
    if (countEl) countEl.textContent = "No active jobs.";
    if (resultEl) resultEl.innerHTML = "";
    return;
  }
  
  const all = Array.isArray(res.requests) ? res.requests : [];
  
  // Filter to jobs that need action
  const needsAction = all.filter(r => {
    const status = String(r?.status || "").toLowerCase();
    const escrowStatus = String(r?.escrow_status || "none").toLowerCase();
    
    // Show if: 
    // - Offer accepted, escrow funded, ready for pickup
    // - Picked up, ready for delivery
    return (status === "accepted" && escrowStatus === "funded") || 
           (status === "picked_up");
  });
  
  // Also show offers waiting for acceptance
  const offersPending = all.filter(r => {
    const status = String(r?.status || "").toLowerCase();
    const escrowStatus = String(r?.escrow_status || "none").toLowerCase();
    return (status === "open") || (status === "accepted" && escrowStatus === "none");
  });
  
  const allActive = [...needsAction, ...offersPending];
  
  if (allActive.length === 0) {
    listEl.innerHTML = `<div class="muted">No active jobs. Browse "Open Jobs" below to make offers!</div>`;
    if (countEl) countEl.textContent = "No active jobs.";
    return;
  }
  
  if (countEl) {
    const actionCount = needsAction.length;
    const pendingCount = offersPending.length;
    
    if (actionCount > 0 && pendingCount > 0) {
      countEl.textContent = `${actionCount} job${actionCount === 1 ? '' : 's'} ready for action, ${pendingCount} offer${pendingCount === 1 ? '' : 's'} pending.`;
    } else if (actionCount > 0) {
      countEl.textContent = `${actionCount} job${actionCount === 1 ? '' : 's'} ready for action!`;
    } else {
      countEl.textContent = `${pendingCount} offer${pendingCount === 1 ? '' : 's'} waiting for sender acceptance.`;
    }
  }
  
  listEl.innerHTML = "";

  // Count active jobs (accepted/picked_up only — not pending offers)
  const activeJobCount = allActive.filter(r => {
    const s = String(r?.status || "").toLowerCase();
    return s === "accepted" || s === "picked_up";
  }).length;

  const MAX_DISPLAY = 5;
  const displayed = allActive.slice(0, MAX_DISPLAY);
  const remaining = allActive.length - displayed.length;

  for (const r of displayed) {
    const id = String(r.id || "");
    const status = String(r.status || "").toLowerCase();
    const escrowStatus = String(r.escrow_status || "none").toLowerCase();
    const pickup = escapeHtml(r.pickup_suburb || "");
    const dropoff = escapeHtml(r.dropoff_suburb || "");
    const item = escapeHtml((r.item_description || "").slice(0, 60));
    
    const card = document.createElement("div");
    card.className = "card";
    card.style.margin = "8px 0";
    card.style.padding = "12px";
    
    // Determine status message and action button
    let statusMessage = "";
    let actionButton = "";
    let cardStyle = "";
    
    // State: Offer pending
    if (status === "open") {
      statusMessage = `⏳ <strong>Offer pending</strong> — Waiting for sender to accept`;
      cardStyle = "background: rgba(245,158,11,.05); border-color: rgba(245,158,11,.3);";
    }
    
    // State: Accepted but not funded
    else if (status === "accepted" && escrowStatus === "none") {
      statusMessage = `✓ <strong>Offer accepted!</strong> — Waiting for sender to fund escrow`;
      cardStyle = "background: rgba(245,158,11,.05); border-color: rgba(245,158,11,.3);";
    }
    
    // State: Ready for pickup
    else if (status === "accepted" && escrowStatus === "funded") {
      statusMessage = `💰 <strong>Payment escrowed</strong> — Ready for pickup`;
      cardStyle = "background: rgba(34,197,94,.05); border-color: rgba(34,197,94,.3);";
      actionButton = `<button class="btn activeJobPickupBtn" data-id="${escapeHtml(id)}" style="margin-top:10px; width:100%; background:#16a34a; border-color:#16a34a;">Mark as Picked Up</button>`;
    }
    
    // State: Picked up, in transit
    else if (status === "picked_up") {
      statusMessage = `🚗 <strong>In transit</strong> — Ready for delivery`;
      cardStyle = "background: rgba(59,130,246,.05); border-color: rgba(59,130,246,.3);";
      actionButton = `<button class="btn activeJobDeliverBtn" data-id="${escapeHtml(id)}" style="margin-top:10px; width:100%; background:#0284c7; border-color:#0284c7;">Mark as Delivered</button>`;
    }
    
    card.style.cssText += cardStyle;
    
    card.innerHTML = `
      <div>
        <div style="font-weight:700;">Request #${escapeHtml(id)}</div>
        <div style="margin-top:4px;"><strong>${pickup} → ${dropoff}</strong></div>
        <div class="muted" style="margin-top:4px;">${item}</div>
        <div style="margin-top:8px; font-size:14px;">${statusMessage}</div>
        ${actionButton}
      </div>
    `;
    
    listEl.appendChild(card);
  }

  // Show "X more" if capped
  if (remaining > 0) {
    const moreEl = document.createElement("div");
    moreEl.className = "muted";
    moreEl.style.cssText = "text-align:center; padding:8px; font-size:13px;";
    moreEl.textContent = `+ ${remaining} more job${remaining === 1 ? '' : 's'} — scroll down to "My Assigned Jobs" to view all`;
    listEl.appendChild(moreEl);
  }

  // Warn when approaching the 10-active-job limit
  if (activeJobCount >= 8) {
    const warnEl = document.createElement("div");
    warnEl.style.cssText = "margin-top:8px; padding:10px 12px; background:rgba(245,158,11,.08); border:1px solid rgba(245,158,11,.3); border-radius:6px; font-size:13px; color:#92400e;";
    if (activeJobCount >= 10) {
      warnEl.innerHTML = `⚠️ <strong>Job limit reached (${activeJobCount}/10).</strong> You cannot submit new offers until you complete an active delivery.`;
    } else {
      warnEl.innerHTML = `⚠️ You have ${activeJobCount}/10 active jobs. Complete deliveries to stay under the limit.`;
    }
    listEl.appendChild(warnEl);
  }
  listEl.onclick = (e) => {
    const pickupBtn = e.target?.closest?.(".activeJobPickupBtn");
    const deliverBtn = e.target?.closest?.(".activeJobDeliverBtn");
    
    if (pickupBtn) {
      const id = pickupBtn.dataset.id;
      handleQuickStatusUpdate(id, "picked_up");
    }
    
    if (deliverBtn) {
      const id = deliverBtn.dataset.id;
      handleQuickStatusUpdate(id, "delivered");
    }
  };
}

async function handleQuickStatusUpdate(requestId, newStatus) {
  // Check acknowledgements
  const statusBtn = document.getElementById("driverStatusBtn");
  if (statusBtn && statusBtn.disabled) {
    alert("Please confirm driver acknowledgements before updating status.");
    return;
  }
  
  // For delivered, need photo
  if (newStatus === "delivered") {
    // Scroll to status form for photo upload
    const statusForm = document.getElementById("driverStatusForm");
    if (statusForm) {
      statusForm.request_id.value = requestId;
      document.getElementById("driverStatusSelect").value = "delivered";
      
      // Expand the Quick Actions section if collapsed
      const quickActions = statusForm.closest("details");
      if (quickActions && !quickActions.open) {
        quickActions.open = true;
      }
      
      statusForm.scrollIntoView({ behavior: "smooth", block: "start" });
      
      // Focus on photo input
      setTimeout(() => {
        const photoInput = document.getElementById("delivered_photo_file");
        if (photoInput) photoInput.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 500);
    }
    return;
  }
  
  // For picked_up, can submit directly
  if (!confirm(`Mark Request #${requestId} as picked up?`)) return;
  
  const body = { 
    status: newStatus,
    ...getDriverAckMeta()
  };
  
  const res = await api(`/requests/${requestId}/status`, { 
    method: "PATCH", 
    body, 
    role: "driver" 
  });
  
  if (res.ok) {
    // Refresh active jobs list
    renderDriverActiveJobs();
    refreshDriverAssignedJobs();
  } else {
    alert(res.error || "Failed to update status");
  }
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
    // ✅ Fail silently - token may not be ready
    sel.innerHTML = `<option value="">(No assigned jobs)</option>`;
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
        <div><strong>From:</strong> ${escapeHtml(pickup || "-")}</div>
        <div><strong>To:</strong> ${escapeHtml(dropoff || "-")}</div>
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
  const countEl = document.getElementById("driverOpenCount"); // ✅ Add this
  if (!listEl) return;

  listEl.innerHTML = `<div class="muted">Loading…</div>`;
  if (resultEl) resultEl.innerHTML = "";

  // Pull recent requests; filter open on the client
  const res = await api("/requests", { method: "GET", role: "driver" });
  if (!res || !res.ok) {
    // ✅ Fail silently - token may not be ready
    listEl.innerHTML = `<div class="muted">(No open jobs right now)</div>`;
    if (resultEl) resultEl.innerHTML = "";
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
    if (countEl) countEl.textContent = "No open jobs available.";
    return;
  }

  // Update count display
  if (countEl) {
    if (open.length > 5) {
      countEl.textContent = `Showing 5 of ${open.length} open jobs. More coming soon with location-based filtering.`;
    } else {
      countEl.textContent = `${open.length} open job${open.length === 1 ? '' : 's'} available.`;
    }
  }

  // Render compact rows with Offer/View actions (limit to 5)
  listEl.innerHTML = "";
  for (const r of open.slice(0, 5)) { // Show only 5 most recent
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
      // NEW: Show inline offer form instead of scrolling
      const job = dmOpenJobsCache ? dmOpenJobsCache[String(id)] : null;
      if (job) {
        showInlineOfferForm(job);
      } else {
        // Fallback: scroll to form
        const offerForm = document.getElementById("driverOfferForm");
        if (offerForm?.request_id) {
          offerForm.request_id.value = id;
          offerForm.scrollIntoView({ behavior: "smooth", block: "start" });
          if (offerForm.price_nzd) offerForm.price_nzd.focus();
        }
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

  // Setup inline offer form
  setupInlineOfferForm();

  // Load once on init (safe even if card hidden)
  refreshDriverOpenJobs();
}

/* -----------------------------
   Inline Offer Form (Quick Offer from Open Jobs)
----------------------------- */
function showInlineOfferForm(job) {
  const section = document.getElementById("driverInlineOfferSection");
  const reqIdSpan = document.getElementById("inlineOfferRequestId");
  const reqIdInput = document.getElementById("inlineOfferRequestIdInput");
  const jobInfo = document.getElementById("inlineOfferJobInfo");
  const priceInput = document.getElementById("inlineOfferPrice");
  
  if (!section) return;
  
  // Populate form
  if (reqIdSpan) reqIdSpan.textContent = job.id;
  if (reqIdInput) reqIdInput.value = job.id;
  if (jobInfo) {
    const pickup = escapeHtml(job.pickup_suburb || "");
    const dropoff = escapeHtml(job.dropoff_suburb || "");
    const item = escapeHtml(job.item_description || "");
    jobInfo.innerHTML = `<strong>${pickup} → ${dropoff}</strong><br>${item}`;
  }
  
  // Show section and focus price
  section.classList.remove("hidden");
  if (priceInput) {
    setTimeout(() => priceInput.focus(), 100);
  }
  
  // Scroll to it
  section.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function hideInlineOfferForm() {
  const section = document.getElementById("driverInlineOfferSection");
  if (section) section.classList.add("hidden");
  
  // Clear form
  const form = document.getElementById("driverInlineOfferForm");
  if (form) form.reset();
  
  const result = document.getElementById("inlineOfferResult");
  if (result) result.innerHTML = "";
}

function setupInlineOfferForm() {
  const form = document.getElementById("driverInlineOfferForm");
  const cancelBtn = document.getElementById("inlineOfferCancelBtn");
  const result = document.getElementById("inlineOfferResult");
  
  if (!form) return;
  
  // Cancel button
  if (cancelBtn && !cancelBtn.__bound) {
    cancelBtn.__bound = true;
    cancelBtn.addEventListener("click", hideInlineOfferForm);
  }
  
  // Submit
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    
    const offerBtn = document.getElementById("driverOfferBtn");
    if (offerBtn && offerBtn.disabled) {
      if (result) setResult(result, alertError("Please confirm driver acknowledgements before submitting."));
      return;
    }
    
    const submitBtn = document.getElementById("inlineOfferSubmitBtn");
    const done = setWorking(submitBtn, "Submitting...");
    if (result) setResult(result, "");
    
    const requestId = document.getElementById("inlineOfferRequestIdInput")?.value;
    const price = document.getElementById("inlineOfferPrice")?.value;
    const note = document.getElementById("inlineOfferNote")?.value || "";
    
    const body = {
      price_nzd: price,
      note: note,
      ...getDriverAckMeta()
    };
    
    // Add optional convenience fields
    const u = getSavedDriverUser();
    if (u?.phone) body.driver_phone = u.phone;
    if (u?.full_name) body.driver_name = u.full_name;
    
    const res = await api(`/requests/${requestId}/offers`, {
      method: "POST",
      body: body,
      role: "driver",
    });
    
    done(!!res.ok);
    
    if (res.ok) {
      if (result) setResult(result, alertSuccess("Offer submitted!"));
      
      // Refresh assigned jobs and active jobs
      try {
        refreshDriverAssignedJobs();
        renderDriverActiveJobs(); // Show in active jobs section
        
        // Show banner
        updateDriverNextActionBanner({
          id: requestId,
          status: "open",
          driver_name: getSavedDriverUser()?.full_name || "",
        });
      } catch (_) {}
      
      // Hide form after 1.5 seconds
      setTimeout(() => {
        hideInlineOfferForm();
      }, 1500);
    } else {
      if (result) setResult(result, alertError(res.error || "Failed to submit offer"));
    }
  });
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
    
    // NEW: Show/hide details section
    const detailsSection = document.getElementById("driverJobDetails");
    if (detailsSection) {
      if (req && req.ok && req.request) {
        detailsSection.classList.remove("hidden");
      } else {
        detailsSection.classList.add("hidden");
      }
    }
    
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
   Refresh driver_status from server after login
   so the re-approval banner reflects the real backend state,
   not just the locally cached value.
----------------------------- */
async function refreshDriverStatusFromServer() {
  try {
    const res = await api("/users/me", { method: "GET", role: "driver" });
    if (res && res.ok && res.user) {
      const u = getSavedDriverUser() || {};
      u.driver_status = res.user.driver_status;
      u.full_name = res.user.full_name || u.full_name;
      u.email = res.user.email || u.email;
      markDriverRegistered(u);
      updateReapprovalBanner();
    }
  } catch (_) {}
}

/* -----------------------------
   Profile section
   - Loads current profile from GET /users/me on open
   - driverBasicProfileForm  → PATCH /users/me (name + email, no re-approval)
   - driverVehicleProfileForm → PATCH /drivers/profile (vehicle/WOF/photos, triggers re-approval)
----------------------------- */
async function loadDriverProfileSnapshot() {
  const snapshot = document.getElementById("driverProfileSnapshot");
  if (!snapshot) return;

  const res = await api("/users/me", { method: "GET", role: "driver" });
  if (!res || !res.ok || !res.user) {
    snapshot.innerHTML = `<span style="color:#dc2626;">Unable to load profile.</span>`;
    return;
  }

  const u = res.user;

  // Pre-fill basic form
  const nameInput = document.getElementById("driverProfileName");
  const emailInput = document.getElementById("driverProfileEmail");
  const addressInput = document.getElementById("driverProfileAddress");
  if (nameInput && u.full_name) nameInput.value = u.full_name;
  if (emailInput && u.email) emailInput.value = u.email;
  if (addressInput && u.default_address) addressInput.value = u.default_address;

  // Pre-fill vehicle form
  const plateInput = document.getElementById("driverProfilePlate");
  const wofInput = document.getElementById("driverProfileWof");
  if (plateInput && u.vehicle_plate) plateInput.value = u.vehicle_plate;
  if (wofInput && u.wof_expiry) wofInput.value = u.wof_expiry.split("T")[0];

  // Status badge
  const dsRaw = String(u.driver_status || "none").toLowerCase();
  const statusBadge = {
    approved:       `<span style="color:#16a34a; font-weight:700;">✅ Approved</span>`,
    pending_review: `<span style="color:#92400e; font-weight:700;">⏳ Pending Review</span>`,
    disabled:       `<span style="color:#dc2626; font-weight:700;">🚫 Disabled</span>`,
    none:           `<span class="muted">Not registered as driver</span>`,
  }[dsRaw] || `<span class="muted">${escapeHtml(u.driver_status)}</span>`;

  const wofDisplay = u.wof_expiry ? new Date(u.wof_expiry).toLocaleDateString("en-NZ", { day:"numeric", month:"short", year:"numeric" }) : "—";
  const payoutDisplay = u.payout_account_last4
    ? `Bank account ending ···${escapeHtml(u.payout_account_last4)}`
    : `<span class="muted">No bank details saved</span>`;

  snapshot.innerHTML = `
    <div style="display:grid; gap:6px; font-size:14px; padding:12px; background:rgba(0,0,0,.03); border-radius:8px; border:1px solid rgba(0,0,0,.06);">
      <div><strong>Name:</strong> ${escapeHtml(u.full_name || "—")}</div>
      <div><strong>Phone:</strong> ${escapeHtml(u.phone || "—")}</div>
      <div><strong>Email:</strong> ${escapeHtml(u.email || "—")}</div>
      <div><strong>Default address:</strong> ${escapeHtml(u.default_address || "—")}</div>
      <div><strong>Driver status:</strong> ${statusBadge}</div>
      <div><strong>Vehicle plate:</strong> ${escapeHtml(u.vehicle_plate || "—")}</div>
      <div><strong>WOF expiry:</strong> ${escapeHtml(wofDisplay)}</div>
      <div><strong>Payout:</strong> ${payoutDisplay}</div>
    </div>
  `;
}

function setupDriverProfile() {
  // Load profile when the collapsible section is opened
  const details = document.getElementById("driverProfileDetails");
  if (details) {
    details.addEventListener("toggle", () => {
      if (details.open) loadDriverProfileSnapshot();
    });
  }

  // ── Basic details form (name + email — no re-approval)
  const basicForm = document.getElementById("driverBasicProfileForm");
  const basicResult = document.getElementById("driverBasicProfileResult");
  if (basicForm) {
    basicForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = basicForm.querySelector("button[type=submit]");
      const done = setWorking(btn, "Saving…");
      if (basicResult) setResult(basicResult, "");

      const fd = new FormData(basicForm);
      const full_name = String(fd.get("full_name") || "").trim();
      const email = String(fd.get("email") || "").trim();
      const default_address = String(fd.get("default_address") || "").trim();

      if (!full_name && !email && !default_address) {
        done(false);
        if (basicResult) setResult(basicResult, alertError("Please enter at least one field to update."));
        return;
      }

      const body = {};
      if (full_name) body.full_name = full_name;
      if (email) body.email = email;
      if (fd.get("default_address") !== null) body.default_address = default_address || null;

      const res = await api("/users/me", {
        method: "PATCH",
        role: "driver",
        body,
      });

      done(!!res.ok);
      if (res.ok) {
        if (basicResult) setResult(basicResult, alertSuccess("Contact details saved."));
        const u = getSavedDriverUser() || {};
        if (full_name) u.full_name = full_name;
        if (email) u.email = email;
        markDriverRegistered(u);
        loadDriverProfileSnapshot();
      } else {
        if (basicResult) setResult(basicResult, alertError(res.error || "Failed to save."));
      }
    });
  }

  // ── Vehicle & licence form (triggers re-approval)
  const vehicleForm = document.getElementById("driverVehicleProfileForm");
  const vehicleResult = document.getElementById("driverVehicleProfileResult");

  const frontFileInput = document.getElementById("driverProfileFrontFile");
  const backFileInput = document.getElementById("driverProfileBackFile");
  const frontStatus = document.getElementById("driverProfileFrontStatus");
  const backStatus = document.getElementById("driverProfileBackStatus");

  let selectedFrontFile = null;
  let selectedBackFile = null;

  if (frontFileInput) {
    frontFileInput.addEventListener("change", () => {
      selectedFrontFile = frontFileInput.files?.[0] || null;
      if (frontStatus) frontStatus.textContent = selectedFrontFile ? `Ready ✓ (${fmtMB(selectedFrontFile.size)})` : "";
    });
  }
  if (backFileInput) {
    backFileInput.addEventListener("change", () => {
      selectedBackFile = backFileInput.files?.[0] || null;
      if (backStatus) backStatus.textContent = selectedBackFile ? `Ready ✓ (${fmtMB(selectedBackFile.size)})` : "";
    });
  }

  if (vehicleForm) {
    vehicleForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = document.getElementById("driverVehicleProfileBtn");
      const done = setWorking(btn, "Saving…");
      if (vehicleResult) setResult(vehicleResult, "");

      const fd = new FormData(vehicleForm);
      const vehicle_plate = String(fd.get("vehicle_plate") || "").trim();
      const wof_expiry = String(fd.get("wof_expiry") || "").trim();

      const body = {};
      if (vehicle_plate) body.vehicle_plate = vehicle_plate;
      if (wof_expiry) body.wof_expiry = wof_expiry;

      // Encode licence photos if selected
      if (selectedFrontFile) {
        try {
          body.driver_license_front_base64 = await fileToDataUrl(selectedFrontFile);
        } catch (err) {
          done(false);
          if (vehicleResult) setResult(vehicleResult, alertError(err?.message || "Failed to process front photo."));
          return;
        }
      }
      if (selectedBackFile) {
        try {
          body.driver_license_back_base64 = await fileToDataUrl(selectedBackFile);
        } catch (err) {
          done(false);
          if (vehicleResult) setResult(vehicleResult, alertError(err?.message || "Failed to process back photo."));
          return;
        }
      }

      if (!Object.keys(body).length) {
        done(false);
        if (vehicleResult) setResult(vehicleResult, alertError("Please enter at least one field to update."));
        return;
      }

      const res = await api("/drivers/profile", {
        method: "PATCH",
        role: "driver",
        body,
      });

      done(!!res.ok);
      if (res.ok) {
        const msg = res.requires_reapproval
          ? alertSuccess("Updated. Your account is now <strong>pending admin review</strong> and you cannot accept jobs until re-approved.")
          : alertSuccess("Profile updated.");
        if (vehicleResult) setResult(vehicleResult, msg);

        // Update locally stored driver_status if re-approval was triggered
        if (res.requires_reapproval) {
          const u = getSavedDriverUser() || {};
          u.driver_status = "pending_review";
          markDriverRegistered(u);
          updateReapprovalBanner();
        }

        // Clear file selections
        selectedFrontFile = null;
        selectedBackFile = null;
        if (frontFileInput) frontFileInput.value = "";
        if (backFileInput) backFileInput.value = "";
        if (frontStatus) frontStatus.textContent = "";
        if (backStatus) backStatus.textContent = "";

        loadDriverProfileSnapshot();
      } else {
        if (vehicleResult) setResult(vehicleResult, alertError(res.error || "Failed to update."));
      }
    });
  }
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
  setupDriverRecentJobsAssigned();
  setupDriverOpenJobs();
  setupUpdateStatus();
  setupIssueReport_driver();
  setupDriverProfile();         // ← NEW: profile section

  // Small delay so token is fully ready before first API calls
  setTimeout(() => {
    renderDriverActiveJobs();
    refreshDriverOpenJobs();
    refreshDriverAssignedJobs();
    // Refresh driver_status from server so re-approval banner is accurate
    refreshDriverStatusFromServer();
  }, 500);

  // Auto-refresh active jobs every 30 seconds
  setInterval(() => {
    try { renderDriverActiveJobs(); } catch (_) {}
  }, 30000);

  // Real-time polling for status updates
  try {
    startPolling({
      apiRole: "driver",
      getRequestId: () => {
        const form = document.getElementById("driverViewForm");
        return form?.request_id?.value || null;
      },
      onUpdate: (request) => {
        try {
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
          updateDriverNextActionBanner(request);
        } catch (err) {
          console.error("Polling update error:", err);
        }
      },
      interval: 30000,
    });
  } catch (err) {
    console.error("Failed to start polling:", err);
  }

  // Payout section
  setupDriverPayoutMethod();
  setTimeout(() => {
    renderDriverPayoutJobs();
    renderDriverPayoutHistory();
  }, 600);
}

/* ---------------------------------------------------------
   Payout - Bank details form + jobs ready for payout
--------------------------------------------------------- */

async function setupDriverPayoutMethod() {
  const form = document.getElementById("driverPayoutMethodForm");
  const result = document.getElementById("driverPayoutMethodResult");
  const statusMsg = document.getElementById("driverBankStatusMsg");
  if (!form) return;

  // Load existing payout details from profile
  try {
    const profile = await api("/users/me", { method: "GET", role: "driver" });
    if (profile.ok && profile.user) {
      const u = profile.user;
      if (u.payout_account_name && form.account_name) form.account_name.value = u.payout_account_name;
      if (u.payout_bank_name && form.bank_name) form.bank_name.value = u.payout_bank_name;
      if (u.payout_account_last4 && statusMsg) {
        statusMsg.innerHTML = `✅ Bank details saved (account ending ···${escapeHtml(u.payout_account_last4)}). Update below if needed.`;
        const details = document.getElementById("driverBankDetailsSection");
        if (details) details.open = false;
      } else if (statusMsg) {
        statusMsg.innerHTML = `⚠️ No bank details saved yet. Add them below to receive payouts.`;
      }
    }
  } catch (_) {}

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = form.querySelector("button[type=submit]");
    const done = setWorking(btn, "Saving...");

    const fd = new FormData(form);
    const account_name = String(fd.get("account_name") || "").trim();
    const bank_name = String(fd.get("bank_name") || "").trim();
    const bank_account = String(fd.get("bank_account") || "").trim();

    if (!account_name) {
      if (result) setResult(result, alertError("Full name is required."));
      done(false);
      return;
    }

    const res = await api("/drivers/payout-method", {
      method: "POST",
      role: "driver",
      body: { method: "bank", account_name, bank_name, bank_account },
    });

    done(!!res.ok);

    if (res.ok) {
      if (result) setResult(result, alertSuccess("Bank details saved!"));
      if (statusMsg) statusMsg.innerHTML = `✅ Bank details saved${res.payout_account_last4 ? ` (account ending ···${escapeHtml(String(res.payout_account_last4))})` : ""}.`;
      const details = document.getElementById("driverBankDetailsSection");
      if (details) details.open = false;
    } else {
      if (result) setResult(result, alertError(res.error || "Failed to save bank details"));
    }
  });
}

async function renderDriverPayoutJobs() {
  const listEl = document.getElementById("driverPayoutJobsList");
  const countEl = document.getElementById("driverPayoutJobsCount");
  if (!listEl) return;

  const res = await api("/driver/requests", { method: "GET", role: "driver" });
  if (!res || !res.ok) {
    listEl.innerHTML = `<div class="muted">Unable to load jobs.</div>`;
    return;
  }

  const all = Array.isArray(res.requests) ? res.requests : [];

  // Jobs ready for payout: delivered + escrow released
  const readyJobs = all.filter(r => {
    const status = String(r?.status || "").toLowerCase();
    const escrow = String(r?.escrow_status || "none").toLowerCase();
    const payout = String(r?.payout_status || "none").toLowerCase();
    return status === "delivered" && escrow === "released";
  });

  if (readyJobs.length === 0) {
    listEl.innerHTML = `<div class="muted">No jobs ready for payout yet. Completed deliveries will appear here once the sender confirms and escrow is released.</div>`;
    if (countEl) countEl.textContent = "";
    return;
  }

  const pending = readyJobs.filter(r => String(r?.payout_status || "none").toLowerCase() === "pending_manual");
  const paid = readyJobs.filter(r => String(r?.payout_status || "none").toLowerCase() === "paid");

  if (countEl) {
    if (pending.length > 0) {
      countEl.textContent = `${pending.length} job${pending.length === 1 ? '' : 's'} awaiting payout · ${paid.length} paid`;
    } else {
      countEl.textContent = `All ${paid.length} job${paid.length === 1 ? '' : 's'} paid ✅`;
    }
  }

  listEl.innerHTML = "";

  for (const r of readyJobs) {
    const id = String(r.id || "");
    const pickup = escapeHtml(r.pickup_suburb || "");
    const dropoff = escapeHtml(r.dropoff_suburb || "");
    const amount = r.payout_amount_nzd ? `NZD $${Number(r.payout_amount_nzd).toFixed(2)}` : "Amount TBC";
    const payoutStatus = String(r.payout_status || "none").toLowerCase();
    const isPaid = payoutStatus === "paid";

    const card = document.createElement("div");
    card.style.cssText = `
      padding:12px; border-radius:8px; margin:8px 0;
      border:1px solid ${isPaid ? "rgba(34,197,94,.3)" : "rgba(245,158,11,.3)"};
      background:${isPaid ? "rgba(34,197,94,.04)" : "rgba(245,158,11,.04)"};
    `;

    card.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px; flex-wrap:wrap;">
        <div>
          <div style="font-weight:700;">Request #${escapeHtml(id)}</div>
          <div class="muted" style="font-size:13px;">${pickup} → ${dropoff}</div>
        </div>
        <div style="font-weight:700; font-size:15px; color:${isPaid ? "#16a34a" : "#92400e"};">${amount}</div>
      </div>
      <div style="margin-top:8px; font-size:13px;">
        ${isPaid
          ? `<span style="color:#16a34a;">✅ Paid</span>`
          : `<span style="color:#92400e;">⏳ Payout pending</span>
             <div class="muted" style="margin-top:4px; font-size:12px;">We will transfer to your saved bank account. Allow 1–3 business days.</div>`
        }
      </div>
    `;

    listEl.appendChild(card);
  }

  // Show total pending amount
  const totalPending = readyJobs
    .filter(r => String(r?.payout_status || "none").toLowerCase() === "pending_manual")
    .reduce((sum, r) => sum + Number(r.payout_amount_nzd || 0), 0);

  if (totalPending > 0) {
    const totalEl = document.createElement("div");
    totalEl.style.cssText = "margin-top:12px; padding:10px 14px; background:rgba(59,130,246,.06); border:1px solid rgba(59,130,246,.2); border-radius:6px; font-size:14px;";
    totalEl.innerHTML = `<strong>Total pending payout: NZD $${totalPending.toFixed(2)}</strong><div class="muted" style="font-size:12px; margin-top:2px;">Make sure your bank details above are correct.</div>`;
    listEl.appendChild(totalEl);
  }
}

async function renderDriverPayoutHistory() {
  const histEl = document.getElementById("driverPayoutHistoryList");
  if (!histEl) return;

  const res = await api("/driver/requests", { method: "GET", role: "driver" });
  if (!res || !res.ok) {
    histEl.innerHTML = `<div class="muted">Unable to load history.</div>`;
    return;
  }

  const all = Array.isArray(res.requests) ? res.requests : [];

  // All delivered jobs (complete history)
  const history = all.filter(r => String(r?.status || "").toLowerCase() === "delivered");

  if (history.length === 0) {
    histEl.innerHTML = `<div class="muted">No completed deliveries yet.</div>`;
    return;
  }

  const rows = history.map(r => {
    const id = String(r.id || "");
    const pickup = escapeHtml(r.pickup_suburb || "");
    const dropoff = escapeHtml(r.dropoff_suburb || "");
    const amount = r.payout_amount_nzd ? `NZD $${Number(r.payout_amount_nzd).toFixed(2)}` : "—";
    const payoutStatus = String(r.payout_status || "none").toLowerCase();
    const escrowStatus = String(r.escrow_status || "none").toLowerCase();
    const deliveredAt = r.delivered_at ? new Date(r.delivered_at).toLocaleDateString("en-NZ", { day:"numeric", month:"short", year:"numeric" }) : "—";

    let badge = "";
    if (payoutStatus === "paid") {
      badge = `<span style="color:#16a34a; font-weight:600;">✅ Paid</span>`;
    } else if (escrowStatus === "released") {
      badge = `<span style="color:#92400e; font-weight:600;">⏳ Pending payout</span>`;
    } else if (escrowStatus === "pending_release" || escrowStatus === "funded") {
      badge = `<span style="color:#0284c7;">⏳ Awaiting sender confirmation</span>`;
    } else {
      badge = `<span class="muted">—</span>`;
    }

    return `
      <div style="display:flex; justify-content:space-between; align-items:center; padding:10px 0; border-bottom:1px solid rgba(0,0,0,.06); gap:8px; flex-wrap:wrap;">
        <div>
          <div style="font-weight:600; font-size:13px;">Request #${escapeHtml(id)} · ${pickup} → ${dropoff}</div>
          <div class="muted" style="font-size:12px;">Delivered ${deliveredAt}</div>
        </div>
        <div style="text-align:right;">
          <div style="font-weight:700;">${amount}</div>
          <div style="font-size:12px; margin-top:2px;">${badge}</div>
        </div>
      </div>
    `;
  }).join("");

  // Summary totals
  const totalEarned = history
    .filter(r => String(r?.payout_status || "").toLowerCase() === "paid")
    .reduce((sum, r) => sum + Number(r.payout_amount_nzd || 0), 0);
  const totalPending = history
    .filter(r => String(r?.escrow_status || "").toLowerCase() === "released" && String(r?.payout_status || "").toLowerCase() !== "paid")
    .reduce((sum, r) => sum + Number(r.payout_amount_nzd || 0), 0);

  histEl.innerHTML = `
    <div style="display:flex; gap:16px; margin-bottom:12px; flex-wrap:wrap;">
      <div style="padding:10px 14px; background:rgba(34,197,94,.06); border:1px solid rgba(34,197,94,.2); border-radius:6px; flex:1; min-width:120px;">
        <div class="muted" style="font-size:12px;">Total Paid</div>
        <div style="font-weight:700; font-size:16px; color:#16a34a;">NZD $${totalEarned.toFixed(2)}</div>
      </div>
      <div style="padding:10px 14px; background:rgba(245,158,11,.06); border:1px solid rgba(245,158,11,.2); border-radius:6px; flex:1; min-width:120px;">
        <div class="muted" style="font-size:12px;">Pending Payout</div>
        <div style="font-weight:700; font-size:16px; color:#92400e;">NZD $${totalPending.toFixed(2)}</div>
      </div>
      <div style="padding:10px 14px; background:rgba(59,130,246,.06); border:1px solid rgba(59,130,246,.2); border-radius:6px; flex:1; min-width:120px;">
        <div class="muted" style="font-size:12px;">Deliveries</div>
        <div style="font-weight:700; font-size:16px;">${history.length}</div>
      </div>
    </div>
    ${rows}
  `;
}
/* =============================================================
   DRIVER OPEN JOBS — Text List + Optional Map View
   Default: fast-loading text list
   Optional: toggle to map view for spatial navigation
============================================================= */

let currentView = 'list'; // 'list' or 'map'
let openJobsData = [];

// Load and render open jobs (called on page load and refresh)
async function loadAndRenderOpenJobs() {
  console.log('[Open Jobs] Fetching...');
  const countEl = document.getElementById('driverOpenCount');
  if (countEl) countEl.textContent = 'Loading jobs...';

  const res = await api('/driver/requests/available', { method: 'GET', role: 'driver' });
  
  if (!res || !res.ok || !res.requests) {
    console.error('[Open Jobs] Failed to load:', res);
    if (countEl) countEl.textContent = 'Failed to load jobs';
    return;
  }

  const jobs = res.requests.filter(r => r.status === 'open');
  openJobsData = jobs;

  if (countEl) {
    countEl.textContent = jobs.length === 0 
      ? 'No open jobs available at the moment'
      : `${jobs.length} job${jobs.length === 1 ? '' : 's'} available`;
  }

  console.log(`[Open Jobs] Found ${jobs.length} jobs`);

  // Render current view
  if (currentView === 'list') {
    renderJobsList(jobs);
  } else {
    loadJobsOntoMap();
  }
}

// Render jobs as text list
function renderJobsList(jobs) {
  const listEl = document.getElementById('driverOpenJobsList');
  if (!listEl) return;

  if (jobs.length === 0) {
    listEl.innerHTML = '<div class="muted" style="padding:20px; text-align:center;">No open jobs right now. Check back soon!</div>';
    return;
  }

  const jobCards = jobs.map(job => {
    const pickup = escapeHtml(job.pickup_suburb || '—');
    const dropoff = escapeHtml(job.dropoff_suburb || '—');
    const item = escapeHtml(job.item_description || '—');
    const suggested = job.suggested_price_nzd 
      ? `NZD $${Number(job.suggested_price_nzd).toFixed(2)}`
      : 'Not specified';
    const weight = job.weight_kg ? `${job.weight_kg}kg` : '';
    
    return `
      <div class="card" style="margin-bottom:12px; border-left:3px solid #3b82f6;">
        <div style="display:flex; justify-content:space-between; align-items:start; gap:12px;">
          <div style="flex:1;">
            <div style="font-weight:600; font-size:15px;">Request #${escapeHtml(job.id)}</div>
            <div class="muted" style="margin-top:4px; font-size:13px;">${pickup} → ${dropoff}</div>
            <div style="margin-top:6px;">${item}</div>
            <div class="muted" style="margin-top:4px; font-size:13px;">
              <span>Suggested: ${suggested}</span>
              ${weight ? ` · ${weight}` : ''}
            </div>
          </div>
          <button class="btn" onclick="showInlineOfferForm(${job.id})" style="white-space:nowrap;">Make Offer</button>
        </div>
      </div>
    `;
  }).join('');

  listEl.innerHTML = jobCards;
}

// Toggle between list and map view
function toggleJobView() {
  const toggleBtn = document.getElementById('driverToggleMapBtn');
  const listEl = document.getElementById('driverOpenJobsList');
  const mapContainer = document.getElementById('driverJobMapContainer');
  
  if (currentView === 'list') {
    // Switch to map
    currentView = 'map';
    if (toggleBtn) toggleBtn.textContent = '📋 View List';
    if (listEl) listEl.classList.add('hidden');
    if (mapContainer) mapContainer.classList.remove('hidden');
    
    // Initialize map if not already done
    if (!jobMap) {
      initializeJobMap();
    } else {
      loadJobsOntoMap();
    }
  } else {
    // Switch to list
    currentView = 'list';
    if (toggleBtn) toggleBtn.textContent = '🗺️ View Map';
    if (listEl) listEl.classList.remove('hidden');
    if (mapContainer) mapContainer.classList.add('hidden');
    
    renderJobsList(openJobsData);
  }
}

// Show inline offer form (called from both list and map views)
window.showInlineOfferForm = function(requestId) {
  const job = openJobsData.find(j => j.id === requestId);
  if (!job) {
    console.error('[Open Jobs] Job not found:', requestId);
    return;
  }

  const pickup = job.pickup_address_full || job.pickup_suburb || '—';
  const dropoff = job.dropoff_address_full || job.dropoff_suburb || '—';
  const item = escapeHtml(job.item_description || '—');

  document.getElementById('inlineOfferRequestId').textContent = requestId;
  document.getElementById('inlineOfferRequestIdInput').value = requestId;
  document.getElementById('inlineOfferJobInfo').innerHTML = `
    <div><strong>From:</strong> ${escapeHtml(pickup)}</div>
    <div><strong>To:</strong> ${escapeHtml(dropoff)}</div>
    <div><strong>Item:</strong> ${item}</div>
  `;

  document.getElementById('driverInlineOfferSection').classList.remove('hidden');
  document.getElementById('inlineOfferPrice').focus();
  document.getElementById('driverInlineOfferSection').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
};

/* =============================================================
   DRIVER JOB MAP — Interactive map (optional view)
============================================================= */

let jobMap = null;
let jobMarkers = [];
let mapInitRetries = 0;
const MAX_MAP_INIT_RETRIES = 20; // 10 seconds max

window.setupDriverJobMap = function() {
  console.log('[Job Map] Google Maps loaded, ready for initialization');
  // Don't initialize immediately - wait for user to click "View Map"
};

function initializeJobMap() {
  if (mapInitRetries >= MAX_MAP_INIT_RETRIES) {
    console.error('[Job Map] Failed to initialize after ' + MAX_MAP_INIT_RETRIES + ' attempts. Map disabled.');
    const countEl = document.getElementById('driverOpenCount');
    if (countEl) countEl.textContent = 'Map failed to load. Please refresh the page.';
    return;
  }
  
  const mapContainer = document.getElementById('driverJobMap');
  
  if (!mapContainer) {
    console.warn('[Job Map] Map container not found in DOM, retrying in 500ms... (attempt ' + (mapInitRetries + 1) + ')');
    mapInitRetries++;
    setTimeout(initializeJobMap, 500);
    return;
  }
  
  // Check if container is actually visible
  if (mapContainer.offsetParent === null) {
    console.warn('[Job Map] Map container exists but not visible yet, retrying in 500ms... (attempt ' + (mapInitRetries + 1) + ')');
    mapInitRetries++;
    setTimeout(initializeJobMap, 500);
    return;
  }

  // Check if already initialized
  if (jobMap) {
    console.log('[Job Map] Already initialized');
    return;
  }
  
  // Check if google.maps is loaded
  if (!window.google || !window.google.maps) {
    console.warn('[Job Map] Google Maps not loaded yet, retrying in 500ms... (attempt ' + (mapInitRetries + 1) + ')');
    mapInitRetries++;
    setTimeout(initializeJobMap, 500);
    return;
  }

  console.log('[Job Map] Initializing map on visible container...');

  try {
    // Center on New Zealand
    jobMap = new google.maps.Map(mapContainer, {
      zoom: 6,
      center: { lat: -40.9006, lng: 174.886 }, // Center of NZ
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: true,
    });

    console.log('[Job Map] Map initialized ✓');
    mapInitRetries = 0; // Reset counter on success
    
    // Load jobs once map is ready
    loadJobsOntoMap();
  } catch (error) {
    console.error('[Job Map] Error creating map:', error);
    mapInitRetries++;
    setTimeout(initializeJobMap, 1000);
  }
}

async function loadJobsOntoMap() {
  if (!jobMap) {
    console.warn('[Job Map] Map not initialized yet');
    return;
  }

  console.log('[Job Map] Rendering jobs on map...');
  
  // Use already-loaded data
  const openJobs = openJobsData.filter(r => r.status === 'open');

  // Clear existing markers
  jobMarkers.forEach(m => m.setMap(null));
  jobMarkers = [];

  // Group jobs by location (lat/lng rounded to 2 decimals for clustering)
  const locationGroups = {};
  
  openJobs.forEach(job => {
    // Only show jobs with coordinates on map
    if (!job.pickup_lat || !job.pickup_lng) return;
    
    // Convert to numbers (they come as strings from database)
    const lat = Number(job.pickup_lat);
    const lng = Number(job.pickup_lng);
    
    if (isNaN(lat) || isNaN(lng)) return; // Skip invalid coordinates
    
    // Round to ~1km precision for clustering
    const clusterKey = `${lat.toFixed(2)},${lng.toFixed(2)}`;
    
    if (!locationGroups[clusterKey]) {
      locationGroups[clusterKey] = {
        lat: lat,
        lng: lng,
        suburb: job.pickup_suburb || 'Unknown',
        jobs: [],
      };
    }
    
    locationGroups[clusterKey].jobs.push(job);
  });

  // Create markers for each location cluster
  Object.values(locationGroups).forEach(group => {
    const marker = new google.maps.Marker({
      position: { lat: group.lat, lng: group.lng },
      map: jobMap,
      title: `${group.jobs.length} job${group.jobs.length === 1 ? '' : 's'} in ${group.suburb}`,
      label: {
        text: String(group.jobs.length),
        color: '#ffffff',
        fontSize: '14px',
        fontWeight: 'bold',
      },
      icon: {
        path: google.maps.SymbolPath.CIRCLE,
        scale: 20,
        fillColor: '#3b82f6',
        fillOpacity: 1,
        strokeColor: '#ffffff',
        strokeWeight: 2,
      },
    });

    // Click marker to show jobs in that area
    marker.addListener('click', () => {
      showJobsInArea(group);
      
      // Center map on clicked location
      jobMap.panTo({ lat: group.lat, lng: group.lng });
      jobMap.setZoom(12);
    });

    jobMarkers.push(marker);
  });

  // If there are jobs, fit map to show all markers
  if (jobMarkers.length > 0) {
    const bounds = new google.maps.LatLngBounds();
    jobMarkers.forEach(m => bounds.extend(m.getPosition()));
    jobMap.fitBounds(bounds);
    
    // Don't zoom in too close if there's only one cluster
    google.maps.event.addListenerOnce(jobMap, 'bounds_changed', () => {
      if (jobMap.getZoom() > 10) jobMap.setZoom(10);
    });
  }

  console.log(`[Job Map] Created ${jobMarkers.length} location markers`);
}

function showJobsInArea(group) {
  const listEl = document.getElementById('driverJobMapList');
  if (!listEl) return;

  listEl.style.display = 'block';
  
  const jobCards = group.jobs.map(job => {
    const pickup = escapeHtml(job.pickup_suburb || '—');
    const dropoff = escapeHtml(job.dropoff_suburb || '—');
    const item = escapeHtml(job.item_description || '—');
    const suggested = job.suggested_price_nzd 
      ? `NZD $${Number(job.suggested_price_nzd).toFixed(2)}`
      : 'Not specified';
    
    return `
      <div class="card" style="margin-bottom:12px; border-left:3px solid #3b82f6;">
        <div style="display:flex; justify-content:space-between; align-items:start; gap:12px;">
          <div style="flex:1;">
            <div style="font-weight:600; font-size:15px;">Request #${escapeHtml(job.id)}</div>
            <div class="muted" style="margin-top:4px; font-size:13px;">${pickup} → ${dropoff}</div>
            <div style="margin-top:6px;">${item}</div>
            <div class="muted" style="margin-top:4px; font-size:13px;">Suggested: ${suggested}</div>
          </div>
          <button class="btn" onclick="showInlineOfferForm(${job.id})" style="white-space:nowrap;">Make Offer</button>
        </div>
      </div>
    `;
  }).join('');

  listEl.innerHTML = `
    <div style="margin-bottom:12px;">
      <h3 style="margin:0 0 4px 0;">${group.jobs.length} job${group.jobs.length === 1 ? '' : 's'} in ${escapeHtml(group.suburb)}</h3>
      <button class="btn ghost" onclick="closeJobList()" style="font-size:13px; padding:4px 8px;">Close</button>
    </div>
    ${jobCards}
  `;
}

window.closeJobList = function() {
  const listEl = document.getElementById('driverJobMapList');
  if (listEl) listEl.style.display = 'none';
};

// Wire up buttons
document.addEventListener('DOMContentLoaded', () => {
  // Toggle between list and map view
  const toggleBtn = document.getElementById('driverToggleMapBtn');
  if (toggleBtn) {
    toggleBtn.addEventListener('click', toggleJobView);
  }
  
  // Refresh button
  const refreshBtn = document.getElementById('driverOpenJobsRefreshBtn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      closeJobList();
      loadAndRenderOpenJobs();
    });
  }
  
  // Load jobs on page load
  setTimeout(() => {
    loadAndRenderOpenJobs();
  }, 1000);
});
