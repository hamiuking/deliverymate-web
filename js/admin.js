// public/js/admin.js

import { api } from "./api.js";
import { $, pretty, saveAdminToken, scrollToElement } from "./utils.js";
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
    const res = await api("/admin/drivers/pending");

    out.textContent = pretty(res);
    scrollToElement(out);

    if (!res.ok) {
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

      out.textContent = pretty(res);
      scrollToElement(out);

      if (res.ok) {
        e.target.insertAdjacentHTML("afterend", alertSuccess("Driver approved"));
      } else {
        e.target.insertAdjacentHTML("afterend", alertError(res.error || "Failed to approve driver"));
      }
    }

    if (e.target.matches(".disable-driver")) {
      const id = e.target.dataset.id;
      const res = await api(`/admin/drivers/${id}/disable`, { method: "POST" });

      out.textContent = pretty(res);
      scrollToElement(out);

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

    const res = await api(`/admin/ledger/${id}`);

    out.textContent = pretty(res);
    scrollToElement(out);

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

    const res = await api("/admin/dashboard");

    if (!res.ok) {
      statusEl.textContent = "";
      btn.insertAdjacentHTML("afterend", alertError(res.error || "Failed to load dashboard"));
      return;
    }

    pendingEl.textContent = res.pending_drivers ?? "—";
    approvedEl.textContent = res.approved_drivers ?? "—";
    disabledEl.textContent = res.disabled_drivers ?? "—";

    statusEl.textContent = "Updated";
    scrollToElement(statusEl);
  });
}
