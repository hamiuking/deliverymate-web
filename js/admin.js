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
  const btn = $("#adminRefreshDashboardBtn");
  const pendingEl = $("#adminCountPendingDrivers");
  const approvedEl = $("#adminCountApprovedDrivers");
  const disabledEl = $("#adminCountDisabledDrivers");
  const statusEl = $("#adminDashboardStatus");

  if (!btn) return;

  btn.addEventListener("click", async () => {
    statusEl.textContent = "Loading…";

    // Backend does not have a single /admin/dashboard endpoint; compute counts from existing endpoints.
    const p = await api("/admin/drivers?status=pending_review");
    const a = await api("/admin/drivers?status=approved");
    const d = await api("/admin/drivers?status=disabled");

    if (!p.ok || !a.ok || !d.ok) {
      statusEl.textContent = "";
      btn.insertAdjacentHTML("afterend", alertError((p.error || a.error || d.error || "Failed to load dashboard")));
      return;
    }

    pendingEl.textContent = Array.isArray(p.drivers) ? p.drivers.length : "—";
    approvedEl.textContent = Array.isArray(a.drivers) ? a.drivers.length : "—";
    disabledEl.textContent = Array.isArray(d.drivers) ? d.drivers.length : "—";

    statusEl.textContent = "Updated";
  });
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#39;');
}