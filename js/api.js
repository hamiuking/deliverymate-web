// public/js/api.js

// Default to same-origin (works if frontend is served by the backend).
// Allow override in localStorage for testing: localStorage.setItem('dm_api_base','https://deliverymate.onrender.com')
export const API_BASE =
  (localStorage.getItem('dm_api_base') || '').trim() ||
  window.location.origin;

// Token getters
export function getUserToken() {
  return sessionStorage.getItem("dm_user_token") || localStorage.getItem("dm_user_token") || "";
}
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

  if (role) opts.headers["X-Role"] = role;

  if (method !== "GET") {
    opts.headers["Idempotency-Key"] = crypto.randomUUID();
  }

  if (body) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }

  const userTok = getUserToken();
  const sender = getSenderToken();
  const driver = getDriverToken();
  const admin = getAdminToken();

  if (userTok) opts.headers["X-User-Token"] = userTok;
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
