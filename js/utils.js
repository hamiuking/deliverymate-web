// public/js/utils.js

// DOM helpers
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// Pretty JSON
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