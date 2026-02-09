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
  initRouter();
}

initApp();