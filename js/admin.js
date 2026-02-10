// public/js/admin.js

import { api } from "./api.js";
import { $, pretty, saveAdminToken } from "./utils.js";
import { alertSuccess, alertError } from "./components/alerts.js";

export function initAdminPage() {
  console.log("Admin page loaded");

  setupSaveAdminToken();
  setupLoadPendingDrivers();
  setupDriverActions();
  setupLedgerLookup();
  setupDashboardRefresh();
}

/* ---------------------------------------------------------
   1. Save Admin Token
--------------------------------------------------------- */
function setupSaveAdminToken() {
  const btn = $("#saveAdminTokenBtn");
  const input = $("#adminTokenInput");

  if (!btn) return;

  btn.addEventListener("click", () => {
    const token = input.value.trim();
    if (!token) {
      input.insertAdjacentHTML("afterend", alertError("Token cannot be empty"));
      return;
    }

    saveAdminToken(token);
    input.insertAdjacentHTML("afterend", alertSuccess("Admin token saved"));

    // Make admin link visible in the navbar (same session)
    const navAdmin = document.getElementById('navAdmin');
    if (navAdmin) navAdmin.style.display = '';
  });
}

/* ---------------------------------------------------------
   2. Load Pending Drivers
--------------------------------------------------------- */
function setupLoadPendingDrivers() {
  const btn = $("#loadPendingDriversBtn");
  const out = $("#pendingDriversOut");

  if (!btn) return;

  btn.addEventListener("click", async () => {
    const res = await api("/admin/drivers?status=pending_review");
    out.textContent = pretty(res);

    if (res.ok && Array.isArray(res.drivers)) {
      // Render quick action buttons under the JSON (pilot convenience)
      const list = res.drivers
        .map(d => {
          const id = d.id;
          const name = d.full_name || '';
          const phone = d.phone || '';
          return `<div class="row" style="margin:8px 0; gap:10px; align-items:center;">
            <div class="muted" style="flex:1;">#${id} ${escapeHtml(name)} · ${escapeHtml(phone)}</div>
            <button class="btn secondary approve-driver" type="button" data-id="${escapeHtml(String(id))}">Approve</button>
            <button class="btn secondary disable-driver" type="button" data-id="${escapeHtml(String(id))}">Disable</button>
          </div>`;
        }).join('');
      out.insertAdjacentHTML("beforebegin", `<div id="pendingDriversActions">${list || '<div class="muted">No pending drivers.</div>'}</div>`);
    } else if (!res.ok) {
      out.insertAdjacentHTML("beforebegin", alertError(res.error || "Failed to load pending drivers"));
    }
  });
}

/* ---------------------------------------------------------
   3. Approve / Disable Drivers
--------------------------------------------------------- */
function setupDriverActions() {
  const out = $("#pendingDriversOut");

  if (!out) return;

  document.addEventListener("click", async (e) => {
    if (e.target.matches(".approve-driver")) {
      const id = e.target.dataset.id;
      const res = await api(`/admin/drivers/${id}/approve`, { method: "POST" });

      if (res.ok) {
        e.target.insertAdjacentHTML("afterend", alertSuccess("Driver approved"));
      } else {
        e.target.insertAdjacentHTML("afterend", alertError(res.error || "Failed to approve driver"));
      }
    }

    if (e.target.matches(".disable-driver")) {
      const id = e.target.dataset.id;
      const res = await api(`/admin/drivers/${id}/disable`, { method: "POST" });

      if (res.ok) {
        e.target.insertAdjacentHTML("afterend", alertSuccess("Driver disabled"));
      } else {
        e.target.insertAdjacentHTML("afterend", alertError(res.error || "Failed to disable driver"));
      }
    }
  });
}

/* ---------------------------------------------------------
   4. Ledger Lookup
--------------------------------------------------------- */
function setupLedgerLookup() {
  const btn = $("#loadLedgerBtn");
  const input = $("#ledgerRequestId");
  const out = $("#ledgerOut");

  if (!btn) return;

  btn.addEventListener("click", async () => {
    const id = input.value.trim();
    if (!id) {
      out.insertAdjacentHTML("beforebegin", alertError("Request ID required"));
      return;
    }

    const res = await api(`/admin/requests/${encodeURIComponent(id)}/ledger`);

    out.textContent = pretty(res);

    if (!res.ok) {
      out.insertAdjacentHTML("beforebegin", alertError(res.error || "Failed to load ledger"));
    }
  });
}

/* ---------------------------------------------------------
   5. Dashboard Refresh
--------------------------------------------------------- */

function setupDashboardRefresh() {
  const refreshBtn = $("#adminRefreshDashboardBtn");
  const runTickBtn = $("#adminRunTickBtn");

  const pendingEl = $("#adminCountPendingDrivers");
  const approvedEl = $("#adminCountApprovedDrivers");
  const disabledEl = $("#adminCountDisabledDrivers");

  const overdueReleaseEl = $("#adminCountOverdueRelease");
  const failedPayoutsEl = $("#adminCountFailedPayouts");
  const oldPendingPayoutsEl = $("#adminCountOldPendingPayouts");

  const statusEl = $("#adminDashboardStatus");
  const runTickOutEl = $("#adminRunTickOut");
  const actionItemsEl = $("#adminActionItemsOut");
  const recentEl = $("#adminRecentRequestsOut");

  if (!refreshBtn) return;

  refreshBtn.addEventListener("click", async () => {
    await refreshDashboard();
  });

  if (runTickBtn) {
    runTickBtn.addEventListener("click", async () => {
      runTickOutEl.textContent = "Running tick…";
      const r = await api("/admin/cron/tick", { method: "POST" });
      if (!r.ok) {
        runTickOutEl.textContent = "";
        runTickBtn.insertAdjacentHTML("afterend", alertError(r.error || "Tick failed"));
        return;
      }
      const done = (r.processed_count ?? "—");
      const skipped = (r.skipped_count ?? "—");
      runTickOutEl.textContent = `Tick complete. processed=${done}, skipped=${skipped}`;
      // Refresh stats after running tick
      await refreshDashboard();
    });
  }

  // Retry payout buttons (event delegation)
  document.addEventListener("click", async (e) => {
    const btn = e.target && e.target.closest && e.target.closest("button[data-retry-payout]");
    if (!btn) return;
    const id = btn.getAttribute("data-retry-payout");
    if (!id) return;

    btn.disabled = true;
    const r = await api(`/admin/requests/${encodeURIComponent(id)}/payout/retry`, { method: "POST" });
    if (!r.ok) {
      btn.disabled = false;
      btn.insertAdjacentHTML("afterend", alertError(r.error || "Retry failed"));
      return;
    }
    btn.insertAdjacentHTML("afterend", alertSuccess(`Retry requested for request #${id}`));
    await refreshDashboard();
    btn.disabled = false;
  });

  // Simulate payout success buttons (test-mode ops; event delegation)
  document.addEventListener("click", async (e) => {
    const btn = e.target && e.target.closest && e.target.closest("button[data-sim-success]");
    if (!btn) return;
    const id = btn.getAttribute("data-sim-success");
    if (!id) return;

    btn.disabled = true;
    const r = await api(`/admin/requests/${encodeURIComponent(id)}/payout/simulate_success`, { method: "POST" });
    if (!r.ok) {
      btn.disabled = false;
      btn.insertAdjacentHTML("afterend", alertError(r.error || "Simulate payout failed"));
      return;
    }
    btn.insertAdjacentHTML("afterend", alertSuccess(`Payout marked completed for request #${id}`));
    await refreshDashboard();
    btn.disabled = false;
  });

  async function refreshDashboard() {
    statusEl.textContent = "Loading…";

    // Drivers (existing endpoints)
    const p = await api("/admin/drivers?status=pending_review");
    const a = await api("/admin/drivers?status=approved");
    const d = await api("/admin/drivers?status=disabled");

    // Trial monitoring
    const s = await api("/admin/trial/summary");
    const t = await api("/admin/trial/action-items");

    if (!p.ok || !a.ok || !d.ok || !s.ok || !t.ok) {
      statusEl.textContent = "";
      refreshBtn.insertAdjacentHTML(
        "afterend",
        alertError((p.error || a.error || d.error || s.error || t.error || "Failed to load dashboard"))
      );
      return;
    }

    pendingEl.textContent = Array.isArray(p.drivers) ? p.drivers.length : "—";
    approvedEl.textContent = Array.isArray(a.drivers) ? a.drivers.length : "—";
    disabledEl.textContent = Array.isArray(d.drivers) ? d.drivers.length : "—";

    // Summary alerts
    overdueReleaseEl.textContent = s.alerts?.pending_release_overdue ?? "—";
    oldPendingPayoutsEl.textContent = s.alerts?.payouts_pending_old ?? "—";

    // Action items counts
    const failedCount = Array.isArray(t.payouts_failed) ? t.payouts_failed.length : 0;
    failedPayoutsEl.textContent = failedCount;

    statusEl.textContent = `Updated • ${s.now || ""} • build ${s.build_id || ""}`;

    // Render action items
    actionItemsEl.innerHTML = renderActionItems(t);

    // Render recent requests table (compact)
    recentEl.innerHTML = renderRecentRequestsTable(s.recent_requests || []);
  }

  // Auto-load once on page open (nice for ops)
  refreshDashboard();
}

function renderActionItems(t) {
  const overdue = Array.isArray(t.overdue_release) ? t.overdue_release : [];
  const pendingOld = Array.isArray(t.payouts_pending_old) ? t.payouts_pending_old : [];
  const failed = Array.isArray(t.payouts_failed) ? t.payouts_failed : [];

  const parts = [];

  // Overdue releases
  parts.push(`<div class="card compact">
    <div class="muted">Overdue pending_release (should auto-release)</div>
    ${overdue.length ? actionTableOverdue(overdue) : `<div>None</div>`}
  </div>`);

  // Old pending payouts
  parts.push(`<div class="card compact mt-2">
    <div class="muted">Pending payouts (2h+)</div>
    ${pendingOld.length ? actionTablePending(pendingOld) : `<div>None</div>`}
  </div>`);

  // Failed payouts
  parts.push(`<div class="card compact mt-2">
    <div class="muted">Failed payouts</div>
    ${failed.length ? actionTableFailed(failed) : `<div>None</div>`}
  </div>`);

  return parts.join("");
}

function actionTableOverdue(rows) {
  const head = `<table class="table">
    <thead><tr><th>Request</th><th>Deadline</th></tr></thead><tbody>`;
  const body = rows.map(r => `<tr>
      <td>#${escapeHtml(r.id)}</td>
      <td>${escapeHtml(r.escrow_dispute_deadline_at || "")}</td>
    </tr>`).join("");
  return head + body + `</tbody></table>`;
}

function actionTablePending(rows) {
  const head = `<table class="table">
    <thead><tr><th>Request</th><th>Payout created</th><th>Amount</th><th></th></tr></thead><tbody>`;
  const body = rows.map(r => `<tr>
      <td>#${escapeHtml(r.id)}</td>
      <td>${escapeHtml(r.payout_created_at || "")}</td>
      <td>${escapeHtml(r.payout_amount_nzd ?? "")}</td>
      <td><button class="btn" data-sim-success="${escapeHtml(r.id)}">Mark completed</button></td>
    </tr>`).join("");
  return head + body + `</tbody></table>`;
}

function actionTableFailed(rows) {
  const head = `<table class="table">
    <thead><tr><th>Request</th><th>Failed at</th><th>Reason</th><th></th></tr></thead><tbody>`;
  const body = rows.map(r => `<tr>
      <td>#${escapeHtml(r.id)}</td>
      <td>${escapeHtml(r.payout_failed_at || "")}</td>
      <td>${escapeHtml(r.payout_fail_reason || "")}</td>
      <td><button class="btn" data-retry-payout="${escapeHtml(r.id)}">Retry payout</button></td>
    </tr>`).join("");
  return head + body + `</tbody></table>`;
}

function renderRecentRequestsTable(rows) {
  if (!Array.isArray(rows) || !rows.length) return `<div class="muted">No recent requests</div>`;

  const head = `<table class="table">
    <thead>
      <tr>
        <th>ID</th>
        <th>Status</th>
        <th>Escrow</th>
        <th>Payout</th>
        <th>Created</th>
      </tr>
    </thead><tbody>`;

  const body = rows.map(r => `<tr>
      <td>#${escapeHtml(r.id)}</td>
      <td>${escapeHtml(r.status || "")}</td>
      <td>${escapeHtml(r.escrow_status || "")}</td>
      <td>${escapeHtml(r.payout_status || "")}</td>
      <td>${escapeHtml(r.created_at || "")}</td>
    </tr>`).join("");

  return head + body + `</tbody></table>`;
}


function escapeHtml(s) {
  return String(s)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#39;');
}

function setupMarkPaid() {
  const form = document.getElementById('markPaidForm');
  const out = document.getElementById('markPaidOut');
  if (!form || !out) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    out.textContent = '';

    const fd = new FormData(form);
    const request_id = String(fd.get('request_id') || '').trim();
    const reference = String(fd.get('reference') || '').trim();

    const res = await api(`/admin/requests/${encodeURIComponent(request_id)}/payout/mark_paid`, {
      method: 'POST',
      body: { reference },
      role: 'admin'
    });

    out.textContent = JSON.stringify(res, null, 2);
  });
}
