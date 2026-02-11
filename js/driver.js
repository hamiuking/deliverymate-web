// public/js/driver.js

import { api } from "./api.js";
import { $, pretty } from "./utils.js";
import { alertSuccess, alertError } from "./components/alerts.js";
import { getFormData } from "./components/forms.js";
import { statusPill, timeline, nextActionText } from "./components/status.js";



function setResult(el, html) {
  if (!el) return;
  el.innerHTML = html || '';
}

function setWorking(btn, workingText='Working…') {
  if (!btn) return () => {};
  const oldText = btn.textContent;
  btn.disabled = true;
  btn.dataset._oldText = oldText;
  btn.textContent = workingText;
  return (ok) => {
    if (ok) {
      btn.textContent = 'Done ✓';
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
  const d = outEl && outEl.closest && outEl.closest('details');
  if (d) d.open = !!open;
}

function markDriverRegistered(user) {
  localStorage.setItem('dm_driver_registered', '1');
  if (user) {
    localStorage.setItem('dm_user_driver', JSON.stringify(user));
    sessionStorage.setItem('dm_user_driver', JSON.stringify(user));
  }
}

function isDriverRegistered() {
  return localStorage.getItem('dm_driver_registered') === '1';
}

function getSavedDriverUser() {
  try {
    const raw = localStorage.getItem('dm_user_driver');
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function enforceDriverGate() {
  const locked = !isDriverRegistered();
  document.body.classList.toggle('locked', locked);
  document.body.classList.toggle('unlocked', !locked);

  const status = document.getElementById('driverAuthStatus');
  const u = getSavedDriverUser();
  if (status) {
    status.textContent = isDriverRegistered() && u?.phone ? `Registered: ${u.phone}` : 'Pilot: register once, then you can “Continue on this device” next time.';
  }

  // Optional: hide registration form if already registered (still accessible via logout)
  const regCard = document.querySelector('section.card');
  const form = document.getElementById('driverRegForm');
  if (form) {
    form.closest('section')?.classList.toggle('hidden', isDriverRegistered());
  }
}


function saveUserToken(tok) {
  if (!tok) return;
  localStorage.setItem('dm_user_token', String(tok));
  sessionStorage.setItem('dm_user_token', String(tok));
}

// --- Recent jobs (local-only; pilot convenience) ---
const DRIVER_RECENT_KEY = 'dm_driver_recent_requests';

function loadDriverRecent() {
  try { return JSON.parse(localStorage.getItem(DRIVER_RECENT_KEY) || '[]'); } catch { return []; }
}

function saveDriverRecent(list) {
  try { localStorage.setItem(DRIVER_RECENT_KEY, JSON.stringify(list)); } catch {}
}

function addDriverRecent(item) {
  const id = item?.id ? String(item.id) : (item?.request_id ? String(item.request_id) : '');
  if (!id) return;
  const rec = {
    id,
    pickup: item.pickup_suburb || '',
    dropoff: item.dropoff_suburb || '',
    status: item.status || '',
    ts: item.updated_at || item.created_at || new Date().toISOString()
  };
  const list = loadDriverRecent().filter(x => String(x.id) !== id);
  list.unshift(rec);
  saveDriverRecent(list.slice(0, 10));
  renderDriverRecent();
}

function renderDriverRecent() {
  const sel = document.getElementById('driverRecentSelect');
  if (!sel) return;
  const list = loadDriverRecent();
  sel.innerHTML = '';
  const opt0 = document.createElement('option');
  opt0.value = '';
  opt0.textContent = list.length ? 'Select a recent request…' : 'No recent jobs yet';
  sel.appendChild(opt0);
  for (const it of list) {
    const o = document.createElement('option');
    o.value = String(it.id);
    const route = (it.pickup || it.dropoff) ? ` — ${it.pickup} → ${it.dropoff}` : '';
    const st = it.status ? ` [${it.status}]` : '';
    o.textContent = `#${it.id}${st}${route}`;
    sel.appendChild(o);
  }
}

function applyDriverRecent(requestId) {
  if (!requestId) return;
  const id = String(requestId);
  const forms = ['driverOfferForm','driverViewForm','driverStatusForm','driverIssueForm'];
  for (const formId of forms) {
    const f = document.getElementById(formId);
    if (f && f.request_id) f.request_id.value = id;
  }
}

function setupDriverRecentUI() {
  const sel = document.getElementById('driverRecentSelect');
  const useBtn = document.getElementById('driverRecentUseBtn');
  const clearBtn = document.getElementById('driverRecentClearBtn');
  if (!sel) return;
  renderDriverRecent();

  if (useBtn) useBtn.addEventListener('click', () => applyDriverRecent(sel.value));
  sel.addEventListener('change', () => { if (sel.value) applyDriverRecent(sel.value); });
  if (clearBtn) clearBtn.addEventListener('click', () => { saveDriverRecent([]); renderDriverRecent(); });
}


export function initDriverPage() {
  console.log("Driver page loaded");

  setupDriverRegistration();
  enforceDriverGate();
  setupDriverAuthControls();
  setupMakeOffer();
  setupViewJob();
  setupDriverRecentUI();
  setupUpdateStatus();
  setupDriverPayoutMethod();
  setupIssueReport_driver();
}

/* ---------------------------------------------------------
   1. Driver Registration
--------------------------------------------------------- */
function setupDriverRegistration() {
  const form = $("#driverRegForm");
  const out = $("#driverRegOut");
  const result = $("#driverRegResult");

  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button[type="submit"]');
    const done = setWorking(btn);
    setResult(result, '');
    const data = getFormData(form);

    const res = await api("/users/driver/apply", {
      method: "POST",
      body: data,
    });

    out.textContent = pretty(res);
    maybeOpenDetails(out, !res.ok);
    done(!!res.ok);

    if (res.ok) {
      if (res.user) sessionStorage.setItem('dm_user', JSON.stringify(res.user));
      setResult(result, alertSuccess("Submitted"));
      saveUserToken(res.user_token || res.userToken || res.auth_token);
      markDriverRegistered(res.user);
      enforceDriverGate();
    } else {
      setResult(result, alertError(res.error || "Failed"));
    }
  });
}

/* ---------------------------------------------------------
   2. Make Offer
--------------------------------------------------------- */
function setupMakeOffer() {
  const form = $("#driverOfferForm");
  const out = $("#driverOfferOut");
  const result = $("#driverOfferResult");

  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button[type="submit"]');
    const done = setWorking(btn);
    setResult(result, '');
    const data = getFormData(form);

    const requestId = data.request_id;
    delete data.request_id;

    // Ack version required by backend
    if (!data.driver_ack_version) {
      data.driver_ack_version = sessionStorage.getItem('dm_driver_ack_version') || 'v2';
    }

    // Defaults from stored user profile (pilot convenience)
    try {
      const u = JSON.parse(sessionStorage.getItem('dm_user') || 'null');
      if (u && u.phone) data.driver_phone = data.driver_phone || u.phone;
      if (u && u.full_name) data.driver_name = data.driver_name || u.full_name;
    } catch (_) {}

    const res = await api(`/requests/${requestId}/offers`, {
      method: "POST",
      body: data,
      role: 'driver',
    });

    out.textContent = pretty(res);
    maybeOpenDetails(out, !res.ok);
    done(!!res.ok);

    if (res.ok) {
      setResult(result, alertSuccess("Offer sent"));
    } else {
      setResult(result, alertError(res.error || "Failed"));
    }
  });
}

/* ---------------------------------------------------------
   3. View Assigned Job
--------------------------------------------------------- */
function setupViewJob() {
  const form = $("#driverViewForm");
  if (!form) return;

  const reqOut = $("#dvRequest");
  const histOut = $("#dvHistory");
  const summary = $("#driverJobSummary");
  const historyList = $("#driverHistoryList");
  const result = $("#driverViewResult");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button[type="submit"]');
    const done = setWorking(btn, "Loading…");
    setResult(result, '');

    const requestId = form.request_id.value;

    const req = await api(`/requests/${requestId}`);
    reqOut.textContent = pretty(req);

    const hist = await api(`/requests/${requestId}/history`);
    histOut.textContent = pretty(hist);

    if (req && req.ok && req.request) addDriverRecent(req.request);
    renderDriverSummary({ req, hist, summary, historyList });

    done(!!req.ok);
    if (req.ok) {
      setResult(result, alertSuccess("Loaded"));
    } else {
      setResult(result, alertError(req.error || "Failed"));
      maybeOpenDetails(reqOut, true);
    }
  });
}

function renderDriverSummary({ req, hist, summary, historyList }) {
  if (!summary || !historyList) return;
  summary.innerHTML = '';
  historyList.innerHTML = '';

  if (!req || !req.ok || !req.request) {
    summary.insertAdjacentHTML('beforeend', alertError(req?.error || 'Failed to load job'));
    return;
  }

  const r = req.request;
  summary.insertAdjacentHTML('beforeend', `
    <div class="card compact">
      ${statusPill({ request_status: r.status, escrow_status: r.escrow_status, payout_status: r.payout_status })}
      ${timeline({ request_status: r.status, escrow_status: r.escrow_status })}
      <div class="next-action"><strong>What happens next:</strong> ${nextActionText({ role: 'driver', request_status: r.status, escrow_status: r.escrow_status })}</div>
      <div class="muted" style="margin-top:10px;">
        Request #${safeText(r.id)} · ${safeText(r.pickup_suburb)} → ${safeText(r.dropoff_suburb)}
      </div>

      <div clas

  // Autofill Update Status form with loaded request id and driver name (if present)
  const statusForm = document.getElementById('driverStatusForm');
  if (statusForm && statusForm.request_id) {
    statusForm.request_id.value = String(r.id);
  }
  if (statusForm && statusForm.driver_name && !statusForm.driver_name.value && r.driver_name) {
    statusForm.driver_name.value = String(r.driver_name);
  }

  const noteEl = document.getElementById('qaNote');
  const pickedBtn = document.getElementById('qaPickedUpBtn');
  const delBtn = document.getElementById('qaDeliveredBtn');

  const canPicked = (r.status === 'accepted' || r.status === 'open'); // open if driver already assigned in your flow
  const canDelivered = (r.status === 'picked_up');

  if (pickedBtn) pickedBtn.disabled = !canPicked;
  if (delBtn) delBtn.disabled = !canDelivered;

  if (pickedBtn) {
    pickedBtn.addEventListener('click', () => {
      if (!statusForm) return;
      statusForm.status.value = 'picked_up';
      if (noteEl) noteEl.textContent = 'Submitting status update…';
      statusForm.querySelector('button[type="submit"]')?.click();
    });
  }
  if (delBtn) {
    delBtn.addEventListener('click', () => {
      if (!statusForm) return;
      statusForm.status.value = 'delivered';
      if (noteEl) noteEl.textContent = 'Submitting status update…';
      statusForm.querySelector('button[type="submit"]')?.click();
    });
  }
s="mt-2">
        <div class="muted">Quick actions</div>
        <div class="btn-row" style="margin-top:6px;">
          <button class="btn secondary" id="qaPickedUpBtn" type="button">Mark picked up</button>
          <button class="btn" id="qaDeliveredBtn" type="button">Mark delivered</button>
        </div>
        <div class="muted" id="qaNote" style="margin-top:6px;"></div>
      </div>
    </div>
  `);

  const h = hist && hist.ok && Array.isArray(hist.history) ? hist.history : [];
  if (hist && !hist.ok) {
    historyList.insertAdjacentHTML('beforeend', alertError(hist.error || 'Failed to load history'));
  } else if (h.length === 0) {
    historyList.insertAdjacentHTML('beforeend', `<div class="muted">No history yet.</div>`);
  } else {
    historyList.insertAdjacentHTML('beforeend', `
      <div class="card compact">
        <ul style="margin:0; padding-left:18px;">
          ${h.slice(0, 12).map(ev => {
            const when = ev.created_at ? new Date(ev.created_at).toLocaleString() : '';
            const note = ev.note || `${ev.from_status || ''} → ${ev.to_status || ''}`;
            return `<li><strong>${safeText(when)}</strong> — ${safeText(note)}</li>`;
          }).join('')}
        </ul>
        ${h.length > 12 ? `<div class="muted" style="margin-top:8px;">Showing latest 12 events (debug JSON contains full history).</div>` : ''}
      </div>
    `);
  }
}

function safeText(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ---------------------------------------------------------
   4. Update Status
--------------------------------------------------------- */
function setupUpdateStatus() {
  const form = $("#driverStatusForm");
  const out = $("#dsOut");
  const result = $("#driverStatusResult");

  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button[type="submit"]');
    const done = setWorking(btn);
    setResult(result, '');

    const requestId = form.request_id.value;
    const status = form.status.value;
    const driverName = form.driver_name.value;

    const res = await api(`/requests/${requestId}/status`, {
      method: "PATCH",
      body: {
        status,
        driver_name: driverName,
      },
      role: 'driver',
    });

    out.textContent = pretty(res);
    maybeOpenDetails(out, !res.ok);
    done(!!res.ok);

    if (res.ok) {
      setResult(result, alertSuccess("Updated"));
    } else {
      setResult(result, alertError(res.error || "Failed"));
    }
  });
}

/* ---------------------------------------------------------
   Pilot: Report an issue helper
--------------------------------------------------------- */
function setupIssueReport_driver() {
  const form = document.getElementById('driverIssueForm');
  const out = document.getElementById('driverIssueOut');
  if (!form || !out) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const requestId = String(fd.get('request_id') || '').trim();
    const note = String(fd.get('note') || '').trim();

    let snapshot = '';
    if (requestId) {
      // Try to load request + (optional) offers/history where relevant
      const req = await api(`/requests/${encodeURIComponent(requestId)}`, { role: 'driver' });
      if (req && req.ok && req.request) {
        const r = req.request;
        snapshot = `Status: ${r.status}\nEscrow: ${r.escrow_status}\nPayout: ${r.payout_status}\nPickup: ${safeText(r.pickup_suburb)}\nDrop-off: ${safeText(r.dropoff_suburb)}`;
      } else {
        snapshot = `Status snapshot: (unable to load request)`;
      }
    }

    const now = new Date().toISOString();
    const url = window.location.origin;
    const msg = [
      `DeliveryMate pilot issue report`,
      `Time: ${now}`,
      `Role: driver`,
      requestId ? `Request ID: ${requestId}` : `Request ID: (not provided)`,
      snapshot ? `\n${snapshot}\n` : '',
      note ? `Note: ${note}` : 'Note: (none)',
      `\nPlease include a screenshot if possible.`,
      `Site: ${url}`
    ].join('\n');

    out.textContent = msg;
  });
}


function setupDriverAuthControls() {
  setupDriverLogin();
  const continueBtn = document.getElementById('driverContinueBtn');
  const logoutBtn = document.getElementById('driverLogoutBtn');
  const hint = document.getElementById('driverAuthHint');

  const u = getSavedDriverUser();
  if (hint) hint.textContent = u?.phone ? `Saved on this device: ${u.phone}` : 'No saved login on this device yet.';

  if (continueBtn) {
    continueBtn.addEventListener('click', () => {
      const u2 = getSavedDriverUser();
      if (!u2) {
        if (hint) hint.textContent = 'No saved login found. Please register below.';
        return;
      }
      localStorage.setItem('dm_driver_registered', '1');
      sessionStorage.setItem('dm_user_driver', JSON.stringify(u2));
      enforceDriverGate();
      if (hint) hint.textContent = `Continuing as ${u2.phone}`;
    });
  }

  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      localStorage.removeItem('dm_driver_registered');
      localStorage.removeItem('dm_user_driver');
      sessionStorage.removeItem('dm_user_driver');
      sessionStorage.removeItem('dm_driver_token');
      sessionStorage.removeItem('dm_user_token');
      localStorage.removeItem('dm_user_token');
      enforceDriverGate();
      // show registration again
      const form = document.getElementById('driverRegForm');
      if (form) form.closest('section')?.classList.remove('hidden');
      if (hint) hint.textContent = 'Logged out. Please register again to use this device.';
    });
  }
}


function setupDriverLogin() {
  const form = document.getElementById('driverLoginForm');
  const hint = document.getElementById('driverAuthHint');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const phone = String(fd.get('phone') || '').trim();
    const invite_code = String(fd.get('invite_code') || '').trim();

    if (hint) hint.textContent = 'Logging in…';

    const res = await api('/users/login', { method: 'POST', body: { phone, invite_code } });
    if (!res.ok) {
      if (hint) hint.textContent = res.error || 'Login failed';
      return;
    }

    saveUserToken(res.user_token);
    markDriverRegistered(res.user);
    sessionStorage.setItem('dm_user_driver', JSON.stringify(res.user));
    enforceDriverGate();

    if (hint) hint.textContent = `Logged in as ${res.user?.phone || phone}`;
  });
}


function setupDriverPayoutMethod() {
  const form = document.getElementById('driverPayoutForm');
  const out = document.getElementById('driverPayoutOut');
  const result = document.getElementById('driverPayoutResult');
  if (!form || !out) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button[type="submit"]');
    const done = setWorking(btn);
    setResult(result, '');
    out.textContent = '';

    const fd = new FormData(form);
    const method = String(fd.get('method') || 'manual').trim();
    const bank_name = String(fd.get('bank_name') || '').trim();
    const account_name = String(fd.get('account_name') || '').trim();
    const bank_account = String(fd.get('bank_account') || '').trim();

    const res = await api('/drivers/payout-method', {
      method: 'POST',
      body: { method, bank_name, account_name, bank_account },
      role: 'driver'
    });

    out.textContent = JSON.stringify(res, null, 2);
    maybeOpenDetails(out, !res.ok);
    done(!!res.ok);
    if (res.ok) {
      setResult(result, alertSuccess('Saved'));
    } else {
      setResult(result, alertError(res.error || 'Failed'));
    }
  });
}
