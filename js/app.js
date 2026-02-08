// public/js/app.js

import { loadTokens } from "./utils.js";

// Feature modules
import { initSenderPage } from "./sender.js";
import { initDriverPage } from "./driver.js";
import { initAdminPage } from "./admin.js";

// Minimal router for multi-page mode
import { initRouter } from "./router.js";

function updateNavVisibility() {
  const adminLink = document.getElementById("navAdmin");
  const adminToken = sessionStorage.getItem("dm_admin_token");

  if (adminLink) {
    adminLink.style.display = adminToken ? "inline-block" : "none";
  }
}

export function initApp() {
  loadTokens();
  updateNavVisibility();
  initRouter();
}

initApp();
