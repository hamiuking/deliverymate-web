// public/js/components/alerts.js
// Minimal alert helpers (purely UI). Kept tiny to avoid changing platform logic.

export function alertSuccess(msg) {
  return `<div class="alert success" role="status">${escapeHtml(String(msg || 'Success'))}</div>`;
}

export function alertError(msg) {
  return `<div class="alert error" role="alert">${escapeHtml(String(msg || 'Error'))}</div>`;
}

function escapeHtml(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
