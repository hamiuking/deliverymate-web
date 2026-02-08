// public/js/utils.js

// DOM helpers
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function pretty(obj) {
  return JSON.stringify(obj, null, 2);
}

// Token storage
export function saveSenderToken(t) {
  sessionStorage.setItem("dm_sender_token", t);
}
export function saveDriverToken(t) {
  sessionStorage.setItem("dm_driver_token", t);
}
export function saveAdminToken(t) {
  sessionStorage.setItem("dm_admin_token", t);
}

export function loadTokens() {
  return {
    sender: sessionStorage.getItem("dm_sender_token") || "",
    driver: sessionStorage.getItem("dm_driver_token") || "",
    admin: sessionStorage.getItem("dm_admin_token") || "",
  };
}

// Loading bar
export function startLoading() {
  const bar = document.getElementById("loadingBar");
  if (bar) bar.style.width = "70%";
}

export function finishLoading() {
  const bar = document.getElementById("loadingBar");
  if (bar) {
    bar.style.width = "100%";
    setTimeout(() => (bar.style.width = "0%"), 300);
  }
}

// Auto-scroll to updated output
export function scrollToElement(el) {
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.style.outline = "2px solid #0f172a";
  setTimeout(() => (el.style.outline = "none"), 800);
}
