// public/js/api.js

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
export async function api(path, { method = "GET", body = null, headers = {}, role = "" } = {}) {
  const opts = { method, headers: { ...headers } };

  // Role header (backend uses x-role to distinguish sender vs driver)
  if (role) {
    opts.headers["X-Role"] = role;
  }

  // Idempotency for write operations
  if (method !== "GET") {
    opts.headers["Idempotency-Key"] = crypto.randomUUID();
  }

  // JSON body
  if (body) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }

  // Attach tokens
  const sender = getSenderToken();
  const driver = getDriverToken();
  const admin = getAdminToken();

  if (sender) opts.headers["X-Sender-Token"] = sender;
  if (driver) opts.headers["X-Driver-Token"] = driver;
  if (admin) opts.headers["X-Admin-Token"] = admin;

  let res;
  try {
    res = await fetch(API_BASE + path, opts);
  } catch (err) {
    return { ok: false, error: "Network error. Please try again." };
  }

  try {
    return await res.json();
  } catch {
    return { ok: false, error: "Invalid JSON from server" };
  }
}