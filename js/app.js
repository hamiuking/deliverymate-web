// public/js/app.js

import { loadTokens } from "./utils.js";
import { api } from "./api.js";

// Feature modules
import { initSenderPage } from "./sender.js";
import { initDriverPage } from "./driver.js";
import { initAdminPage } from "./admin.js";

// Minimal router for multi-page mode
import { initRouter } from "./router.js";

export function initApp() {
  // Load any existing tokens for this session
  const t = loadTokens();

  // Hide admin nav unless token is present (pilot safety)
  const navAdmin = document.getElementById('navAdmin');
  if (navAdmin) navAdmin.style.display = t.admin ? '' : 'none';

  // Fetch acknowledgement versions once (used by sender/driver actions)
  // Safe: read-only endpoint; failures just leave defaults.
  (async () => {
    try {
      const v = await api('/ack/versions');
      if (v && v.ok) {
        if (v.sender_ack_version) sessionStorage.setItem('dm_sender_ack_version', String(v.sender_ack_version));
        if (v.driver_ack_version) sessionStorage.setItem('dm_driver_ack_version', String(v.driver_ack_version));
      }
    } catch (_) {}
  })();

  // Pilot banner + facilitator-only reminder (copy-only; no logic)
  try {
    injectPilotBanner();
  } catch (_) {}
  initRouter();
}

function injectPilotBanner() {
  // Only show banner on home page (index.html)
  // Sender/driver pages have their own acknowledgements
  const isHomePage = window.location.pathname === '/' || 
                     window.location.pathname === '/index.html' ||
                     window.location.pathname.endsWith('/');
  
  if (!isHomePage) return; // Skip banner on other pages
  
  // Place banner at the top of the main container, if present.
  const main = document.querySelector('main.container');
  if (!main) return;

  // Avoid duplicating if app.js is loaded more than once.
  if (main.querySelector('[data-dm-banner="pilot"]')) return;

  const div = document.createElement('div');
  div.className = 'banner';
  div.setAttribute('data-dm-banner', 'pilot');
  div.innerHTML = `
    <strong>Invite-only pilot (NZ).</strong> Please do not use for urgent or high-value deliveries.
    <div class="muted" style="margin-top:6px;">
      DeliveryMate is a facilitator only — not a courier, employer, or agent. No dispute resolution.
    </div>
  `;
  main.insertBefore(div, main.firstChild);
}

initApp();

// Copy-to-clipboard helper (pilot templates)
document.addEventListener('click', async (e) => {
  const btn = e.target && e.target.closest && e.target.closest('button[data-copy]');
  if (!btn) return;
  const sel = btn.getAttribute('data-copy');
  if (!sel) return;
  const el = document.querySelector(sel);
  if (!el) return;
  const text = el.textContent || '';
  try {
    await navigator.clipboard.writeText(text);
    const old = btn.textContent;
    btn.textContent = 'Copied';
    setTimeout(() => (btn.textContent = old), 1200);
  } catch {
    // Fallback: select text so user can copy manually
    const range = document.createRange();
    range.selectNodeContents(el);
    const s = window.getSelection();
    s.removeAllRanges();
    s.addRange(range);
  }
});
