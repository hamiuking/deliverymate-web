// public/js/components/alerts.js

export function alertSuccess(msg) {
  return `<div class="alert success">${msg}</div>`;
}

export function alertError(msg) {
  const text = typeof msg === "string" ? msg : "Something went wrong";
  return `<div class="alert error">${text}</div>`;
}
