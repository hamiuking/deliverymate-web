// public/js/api.js

import { startLoading, finishLoading } from "./utils.js";

export const API_BASE = "https://deliverymate.onrender.com";

// Token getters
export function getSenderToken() {
  return sessionStorage.getItem("dm_sender_token") || "";
}
export function getDriverToken() {
  return sessionStorage.getItem("dm_driver_token") || "";
}
export function getAdminToken() {
  return sessionStorage.getItem("dm_admin_token") || "";
}

// Core API wrapper
export async function api(path, { method = "GET", body = null, headers = {} } = {}) {
  startLoading();

  const opts = { method, headers: { ...headers } };

  if (method !== "GET") {
    opts.headers["Idempotency-Key"] = crypto.randomUUID();
  }

  if (body) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }

  const sender = getSenderToken();
  const driver = getDriverToken();
  const admin = getAdminToken();

  if (sender) opts.headers["X-Sender-Token"] = sender;
  if (driver) opts.headers["X-Driver-Token"] = driver;
  if (admin) opts.headers["X-Admin-Token"] = admin;

  try {
    const res = await fetch(API_BASE + path, opts);
    const json = await res.json();
    finishLoading();
    return json;
  } catch (err) {
    finishLoading();
    return { ok: false, error: "Network error" };
  }
}
