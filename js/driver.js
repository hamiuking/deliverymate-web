// public/js/driver.js

import { api } from "./api.js";
import { $, pretty, saveDriverToken } from "./utils.js";
import { alertSuccess, alertError } from "./components/alerts.js";
import { getFormData } from "./components/forms.js";

export function initDriverPage() {
  console.log("Driver page loaded");

  setupDriverRegistration();
  setupMakeOffer();
  setupViewJob();
  setupUpdateStatus();
}

/* ---------------------------------------------------------
   1. Driver Registration
--------------------------------------------------------- */
function setupDriverRegistration() {
  const form = $("#driverRegForm");
  const out = $("#driverRegOut");

  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const data = getFormData(form);

    const res = await api("/users/register-driver", {
      method: "POST",
      body: data,
    });

    out.textContent = pretty(res);

    if (res.ok && res.driver_token) {
      saveDriverToken(res.driver_token);
      out.insertAdjacentHTML("beforebegin", alertSuccess("Driver registered"));
    } else {
      out.insertAdjacentHTML("beforebegin", alertError(res.error || "Registration failed"));
    }
  });
}

/* ---------------------------------------------------------
   2. Make Offer
--------------------------------------------------------- */
function setupMakeOffer() {
  const form = $("#driverOfferForm");
  const out = $("#driverOfferOut");

  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const data = getFormData(form);

    const requestId = data.request_id;
    delete data.request_id;

    const res = await api(`/requests/${requestId}/offers`, {
      method: "POST",
      body: data,
    });

    out.textContent = pretty(res);

    if (res.ok) {
      out.insertAdjacentHTML("beforebegin", alertSuccess("Offer submitted"));
    } else {
      out.insertAdjacentHTML("beforebegin", alertError(res.error || "Failed to submit offer"));
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
  const statusLine = $("#dvStatus");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const requestId = form.request_id.value;

    const req = await api(`/requests/${requestId}`);
    reqOut.textContent = pretty(req);

    const hist = await api(`/requests/${requestId}/history`);
    histOut.textContent = pretty(hist);

    if (!req.ok) {
      statusLine.textContent = "Failed to load job";
      return;
    }

    statusLine.textContent = `Status: ${req.status}`;
  });
}

/* ---------------------------------------------------------
   4. Update Status
--------------------------------------------------------- */
function setupUpdateStatus() {
  const form = $("#driverStatusForm");
  const out = $("#dsOut");

  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const requestId = form.request_id.value;
    const status = form.status.value;
    const driverName = form.driver_name.value;

    const res = await api(`/requests/${requestId}/status`, {
      method: "PATCH",
      body: {
        status,
        driver_name: driverName,
      },
    });

    out.textContent = pretty(res);

    if (res.ok) {
      out.insertAdjacentHTML("beforebegin", alertSuccess("Status updated"));
    } else {
      out.insertAdjacentHTML("beforebegin", alertError(res.error || "Failed to update status"));
    }
  });
}