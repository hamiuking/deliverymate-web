// public/js/sender.js
import { api } from "./api.js";
import { $ } from "./utils.js";
import { alertSuccess, alertError } from "./components/alerts.js";
import { getFormData } from "./components/forms.js";

// ----- small helpers -----
function setResult(el, html) {
  if (!el) return;
  el.innerHTML = html || "";
}

function setWorking(btn, workingText = "Working…") {
  if (!btn) return () => {};
  const oldText = btn.textContent;
  btn.disabled = true;
  btn.textContent = workingText;
  return (ok) => {
    if (ok) {
      btn.textContent = "Done ✓";
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

function escapeHtml(v) {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function saveUserToken(tok) {
  if (!tok) return;
  localStorage.setItem("dm_user_token", String(tok));
  sessionStorage.setItem("dm_user_token", String(tok));
}

function markSenderRegistered(user) {
  localStorage.setItem("dm_sender_registered", "1");
  if (user) {
    localStorage.setItem("dm_user_sender", JSON.stringify(user));
    sessionStorage.setItem("dm_user_sender", JSON.stringify(user));
  }
}

function isSenderRegistered() {
  return localStorage.getItem("dm_sender_registered") === "1";
}

function getSavedSenderUser() {
  try {
    const raw = localStorage.getItem("dm_user_sender");
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function enforceSenderGate() {
  const locked = !isSenderRegistered();
  const authArea = document.getElementById("senderAuthArea");
  const dash = document.getElementById("senderDashboard");
  if (authArea) authArea.classList.toggle("hidden", !locked);
  if (dash) dash.classList.toggle("hidden", locked);

  const status = document.getElementById("senderAuthStatus");
  const u = getSavedSenderUser();
  if (status) {
    status.textContent = locked
      ? "Please register or log in to access the sender dashboard."
      : (u?.phone ? `Logged in: ${u.phone}` : "Sender dashboard unlocked.");
  }

  const logoutBtn = document.getElementById("senderLogoutBtn");
  if (logoutBtn) logoutBtn.classList.toggle("hidden", locked);

  const ident = document.getElementById("senderIdentityLine");
  if (ident) {
    const phone = sessionStorage.getItem("dm_sender_phone") || localStorage.getItem("dm_sender_phone") || (u?.phone || "");
    ident.innerHTML = phone ? `<span class="muted">Sender: ${escapeHtml(phone)}</span>` : "";
  }
}

// ----- sender ack gate -----
const SENDER_ACK_VERSION = "sender_terms_2026-01-06";
const SENDER_ACK_KEY = "dm_sender_ack_v1_ts";

function getSenderAckMeta() {
  const ts = localStorage.getItem(SENDER_ACK_KEY) || "";
  return { sender_ack_version: SENDER_ACK_VERSION, sender_ack_ts: ts };
}

function setupSenderAckGate() {
  const a1 = document.getElementById("sAck1");
  const a2 = document.getElementById("sAck2");
  const a3 = document.getElementById("sAck3");
  const a4 = document.getElementById("sAck4");
  const lastEl = document.getElementById("senderAckLast");
  const createBtn = document.getElementById("createRequestBtn");

  if (!a1 || !a2 || !a3 || !a4) return;

  const renderLast = () => {
    if (!lastEl) return;
    const ts = localStorage.getItem(SENDER_ACK_KEY);
    if (!ts) { lastEl.textContent = ""; return; }
    const d = new Date(ts);
    if (isNaN(d.getTime())) { lastEl.textContent = ""; return; }
    lastEl.textContent = `· Last agreed on this device: ${d.toLocaleString()}`;
  };

  const prevTs = localStorage.getItem(SENDER_ACK_KEY);
  if (prevTs) {
    a1.checked = true;
    a2.checked = true;
    a3.checked = true;
    a4.checked = true;
  }

  const refresh = () => {
    const ok = a1.checked && a2.checked && a3.checked && a4.checked;
    if (createBtn) createBtn.disabled = !ok;

    if (ok) localStorage.setItem(SENDER_ACK_KEY, new Date().toISOString());
    renderLast();
  };

  a1.addEventListener("change", refresh);
  a2.addEventListener("change", refresh);
  a3.addEventListener("change", refresh);
  a4.addEventListener("change", refresh);

  refresh();
}

// ----- register/login/logout -----
function setupSenderRegistration() {
  const form = $("#senderRegForm");
  const result = $("#senderRegResult");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button[type="submit"]');
    const done = setWorking(btn, "Registering…");
    setResult(result, "");

    const data = getFormData(form);
    const res = await api("/users/register", { method: "POST", body: data });

    done(!!res.ok);
    if (!res.ok) {
      setResult(result, alertError(res.error || "Failed"));
      return;
    }

    saveUserToken(res.user_token);
    markSenderRegistered(res.user);

    // Cache phone for create-request autofill
    const phone = String(res.user?.phone || data.phone || "");
    if (phone) {
      localStorage.setItem("dm_sender_phone", phone);
      sessionStorage.setItem("dm_sender_phone", phone);
    }

    enforceSenderGate();
    setResult(result, alertSuccess("Registered"));
  });
}

function setupSenderLogin() {
  const form = $("#senderLoginForm");
  const hint = document.getElementById("senderAuthHint");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const phone = String(fd.get("phone") || "").trim();
    const invite_code = String(fd.get("invite_code") || "").trim();
    if (hint) hint.textContent = "Logging in…";

    const res = await api("/users/login", { method: "POST", body: { phone, invite_code } });

    if (!res.ok) {
      if (hint) hint.textContent = res.error || "Login failed";
      return;
    }

    saveUserToken(res.user_token);
    markSenderRegistered(res.user);

    // Cache phone for create-request autofill
    const p = String(res.user?.phone || phone || "");
    if (p) {
      localStorage.setItem("dm_sender_phone", p);
      sessionStorage.setItem("dm_sender_phone", p);
    }

    enforceSenderGate();
    if (hint) hint.textContent = `Logged in as ${p || phone}`;
  });
}

function setupSenderLogout() {
  const btn = document.getElementById("senderLogoutBtn");
  const hint = document.getElementById("senderAuthHint");
  if (!btn) return;

  btn.addEventListener("click", () => {
    localStorage.removeItem("dm_sender_registered");
    localStorage.removeItem("dm_user_sender");
    localStorage.removeItem("dm_user_token");
    sessionStorage.removeItem("dm_user_token");
    sessionStorage.removeItem("dm_user_sender");
    // keep dm_sender_phone optional; you can remove it too if you prefer:
    // localStorage.removeItem("dm_sender_phone");
    // sessionStorage.removeItem("dm_sender_phone");

    enforceSenderGate();
    if (hint) hint.textContent = "";
  });
}

// ----- create request -----
function setupCreateRequest() {
  const form = $("#createRequestForm");
  const result = $("#createRequestResult");
  const out = document.getElementById("createRequestOut");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const btn = document.getElementById("createRequestBtn") || form.querySelector('button[type="submit"]');
    const done = setWorking(btn, "Creating…");
    setResult(result, "");
    if (out) out.textContent = "";

    const data = getFormData(form);

    // Autofill sender_phone for pilot backend requirement
    const u = getSavedSenderUser();
    const cachedPhone = sessionStorage.getItem("dm_sender_phone") || localStorage.getItem("dm_sender_phone") || "";
    if (u?.phone) data.sender_phone = u.phone;
    if (!data.sender_phone && cachedPhone) data.sender_phone = cachedPhone;

    // Attach sender acknowledgement meta (what backend expects)
    Object.assign(data, getSenderAckMeta());

    // If ack not recorded, show user where
    if (!data.sender_ack_ts) {
      done(false);
      setResult(result, alertError("Please complete Sender acknowledgements above before creating a request."));
      document.getElementById("senderAckSection")?.scrollIntoView?.({ behavior: "smooth", block: "start" });
      return;
    }

    const res = await api("/requests", { method: "POST", body: data, role: "sender" });

    done(!!res.ok);
    if (out) out.textContent = JSON.stringify(res, null, 2);

    if (res.ok) setResult(result, alertSuccess("Created"));
    else setResult(result, alertError(res.error || "Failed"));
  });
}

// ----- init -----
export function initSenderPage() {
  setupSenderRegistration();
  setupSenderLogin();
  setupSenderLogout();
  enforceSenderGate();

  // Dashboard features
  setupSenderAckGate();
  setupCreateRequest();
}
