// public/js/api.js

// If you deploy frontend + backend on same domain, you can set API_BASE = "" to use same-origin.
export const API_BASE = "https://deliverymate.onrender.com";

// Token getters
export function getUserToken() {
  return (
    sessionStorage.getItem("dm_user_token") ||
    localStorage.getItem("dm_user_token") ||
    ""
  );
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

function buildUrl(path) {
  // Allow same-origin calls if API_BASE is empty or "/"
  const base = (API_BASE || "").trim();
  if (!base || base === "/") return path;
  return base.replace(/\/+$/, "") + path;
}

function safeSnippet(text, max = 400) {
  const t = String(text || "").trim();
  if (!t) return "";
  return t.length > max ? t.slice(0, max) + "…" : t;
}

function pickContentType(res) {
  try {
    return (res.headers.get("content-type") || "").toLowerCase();
  } catch {
    return "";
  }
}

// Core API wrapper
export async function api(
  path,
  { method = "GET", body = null, headers = {}, role = "" } = {}
) {
  const opts = { method, headers: { ...headers } };

  // Role header (backend uses X-Role to distinguish sender vs driver)
  if (role) opts.headers["X-Role"] = role;

  // Idempotency for write operations
  if (method && method.toUpperCase() !== "GET") {
    try {
      opts.headers["Idempotency-Key"] = crypto.randomUUID();
    } catch {
      // very old browsers only; ignore
      opts.headers["Idempotency-Key"] =
        String(Date.now()) + "-" + String(Math.random()).slice(2);
    }
  }

  // JSON body
  if (body !== null && body !== undefined) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }

  // Attach tokens
  const userTok = getUserToken();
  const senderTok = getSenderToken();
  const driverTok = getDriverToken();
  const adminTok = getAdminToken();

  if (userTok) opts.headers["X-User-Token"] = userTok;
  if (senderTok) opts.headers["X-Sender-Token"] = senderTok;
  if (driverTok) opts.headers["X-Driver-Token"] = driverTok;
  if (adminTok) opts.headers["X-Admin-Token"] = adminTok;

  let res;
  try {
    res = await fetch(buildUrl(path), opts);
  } catch (err) {
    return { ok: false, error: "Network error. Please try again." };
  }

  // Handle empty response (204 etc.)
  if (res.status === 204) {
    return { ok: res.ok, status: res.status };
  }

  const ct = pickContentType(res);

  // Read as text once; then try to parse as JSON
  let text = "";
  try {
    text = await res.text();
  } catch {
    text = "";
  }

  // If content-type says JSON (or looks like JSON), try parsing.
  const looksJson = (() => {
    const t = (text || "").trim();
    return t.startsWith("{") || t.startsWith("[");
  })();

  if (ct.includes("application/json") || looksJson) {
    try {
      const data = text ? JSON.parse(text) : {};
      // Preserve server payload; ensure ok/status exist
      if (typeof data.ok === "undefined") data.ok = res.ok;
      if (typeof data.status === "undefined") data.status = res.status;
      return data;
    } catch {
      // JSON parse failed: return a useful error snippet
      return {
        ok: false,
        status: res.status,
        error: `Server returned invalid JSON (HTTP ${res.status}).`,
        details: safeSnippet(text),
      };
    }
  }

  // Non-JSON response: return helpful debug info
  const snippet = safeSnippet(text);
  const msg =
    res.status === 413
      ? "Payload too large. Please use smaller photos (max 6MB original)."
      : `Server returned non-JSON response (HTTP ${res.status}).`;

  return {
    ok: false,
    status: res.status,
    error: msg,
    details: snippet,
  };
}
