/* DeliveryMate — driver.js (fixed)
   Notes:
   - Fixes "Unexpected token '<'" by removing stray HTML fragment outside template strings.
   - Keeps existing behaviour: view job, quick actions, status updates, login/register helpers.
*/

import { api } from './api.js';
import { $ } from './utils.js';
import { alertError, alertSuccess } from './components/alerts.js';
import { statusPill, timeline, nextActionText } from './components/status.js';
function safeText(v) {
  if (v === null || v === undefined) return '';
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}


/* ---------------------------------------------------------
   Shared: user token storage (login)
--------------------------------------------------------- */
function saveUserToken(tok) {
  if (!tok) return;
  localStorage.setItem('dm_user_token', String(tok));
  sessionStorage.setItem('dm_user_token', String(tok));
}

/* ---------------------------------------------------------
   Driver "register once / continue later" helpers
--------------------------------------------------------- */
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
  const status = document.getElementById('driverAuthStatus');
  const u = getSavedDriverUser();
  if (status) {
    status.textContent =
      isDriverRegistered() && u?.phone
        ? `Registered: ${u.phone}`
        : 'Pilot: register once, then you can “Continue on this device” next time.';
  }

  // Optional: hide registration card if already registered (still accessible via logout)
  const form = document.getElementById('driverRegForm');
  if (form) {
    form.closest('section')?.classList.toggle('hidden', isDriverRegistered());
  }
}

export function initDriverPage() {
  setupDriverRegistration();
  enforceDriverGate();
  setupDriverAuthControls();

  setupViewJob();
  setupUpdateStatus();
}

/* ---------------------------------------------------------
   Auth controls (login / continue / logout)
--------------------------------------------------------- */
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

      const form = document.getElementById('driverRegForm');
      if (form) form.closest('section')?.classList.remove('hidden');

      if (hint) hint.textContent = 'Logged out. Please register again to use this device.';
    });
  }
}

/* ---------------------------------------------------------
   1) Driver registration / apply
--------------------------------------------------------- */
function setupDriverRegistration() {
  const form = document.getElementById('driverRegForm');
  const out = document.getElementById('driverRegOut');
  if (!form || !out) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    out.textContent = '';

    const fd = new FormData(form);
    const phone = String(fd.get('phone') || '').trim();
    const full_name = String(fd.get('full_name') || '').trim();
    const email = String(fd.get('email') || '').trim();
    const vehicle_plate = String(fd.get('vehicle_plate') || '').trim();

    const res = await api('/users/driver/apply', {
      method: 'POST',
      body: { phone, full_name, email, vehicle_plate },
      role: 'driver'
    });

    if (res.ok) {
      if (res.user) sessionStorage.setItem('dm_user', JSON.stringify(res.user));
      out.insertAdjacentHTML('beforebegin', alertSuccess('Driver application submitted'));
      saveUserToken(res.user_token || res.userToken || res.auth_token);
      markDriverRegistered(res.user);
      enforceDriverGate();
    } else {
      out.insertAdjacentHTML('beforebegin', alertError(res.error || 'Apply failed'));
    }

    out.textContent = JSON.stringify(res, null, 2);
  });
}

/* ---------------------------------------------------------
   2) View My Job
--------------------------------------------------------- */
function setupViewJob() {
  const form = document.getElementById('viewJobForm');
  const out = document.getElementById('viewJobOut');
  const summary = document.getElementById('driverJobSummary');
  const historyList = document.getElementById('driverHistoryList');
  if (!form || !out) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    out.textContent = '';

    const id = String(form.request_id.value || '').trim();
    if (!id) {
      out.insertAdjacentHTML('beforebegin', alertError('Request ID required'));
      return;
    }

    const req = await api(`/requests/${encodeURIComponent(id)}`, { role: 'driver' });
    const hist = await api(`/requests/${encodeURIComponent(id)}/history`, { role: 'driver' });

    out.textContent = JSON.stringify({ req, hist }, null, 2);
    renderDriverSummary({ req, hist, summary, historyList });
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

      <div class="mt-2">
        <div class="muted">Quick actions</div>
        <div class="btn-row" style="margin-top:6px;">
          <button class="btn secondary" id="qaPickedUpBtn" type="button">Mark picked up</button>
          <button class="btn" id="qaDeliveredBtn" type="button">Mark delivered</button>
        </div>
        <div class="muted" id="qaNote" style="margin-top:6px;"></div>
      </div>
    </div>
  `);

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

  // Enable conditions (adjustable if your backend uses different status names)
  const canPicked = (r.status === 'accepted' || r.status === 'open' || r.status === 'assigned');
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

  // History
  if (hist && hist.ok && Array.isArray(hist.events)) {
    const rows = hist.events
      .slice()
      .reverse()
      .map((ev) => `<li><strong>${safeText(ev.type)}</strong> · ${safeText(ev.created_at)} · ${safeText(ev.note || '')}</li>`)
      .join('');
    historyList.innerHTML = rows ? `<ul class="list">${rows}</ul>` : '<div class="muted">No history yet.</div>';
  } else {
    historyList.innerHTML = '<div class="muted">History unavailable.</div>';
  }
}

/* ---------------------------------------------------------
   3) Update Status
--------------------------------------------------------- */
function setupUpdateStatus() {
  const form = document.getElementById('driverStatusForm');
  const out = document.getElementById('driverStatusOut');
  if (!form || !out) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    out.textContent = '';

    const fd = new FormData(form);
    const request_id = String(fd.get('request_id') || '').trim();
    const status = String(fd.get('status') || '').trim();
    const driver_name = String(fd.get('driver_name') || '').trim();

    if (!request_id || !status) {
      out.insertAdjacentHTML('beforebegin', alertError('Request ID and status are required'));
      return;
    }

    const res = await api(`/requests/${encodeURIComponent(request_id)}/status`, {
      method: 'PATCH',
      body: { status, driver_name },
      role: 'driver'
    });

    if (res.ok) {
      out.insertAdjacentHTML('beforebegin', alertSuccess('Status updated'));
    } else {
      out.insertAdjacentHTML('beforebegin', alertError(res.error || 'Update failed'));
    }

    out.textContent = JSON.stringify(res, null, 2);
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

// Initialise issue helper if present (safe)
setupIssueReport_driver();
