// public/js/components/alerts.js

export function alertSuccess(msg) {
  return `<div class="alert success">${msg}</div>`;
}

export function alertError(msg) {
  return `<div class="alert error">${msg}</div>`;
}