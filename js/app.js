// public/js/app.js

import { loadTokens } from "./utils.js";

// Feature modules
import { initSenderPage } from "./sender.js";
import { initDriverPage } from "./driver.js";
import { initAdminPage } from "./admin.js";

// Minimal router for multi-page mode
import { initRouter } from "./router.js";

export function initApp() {
  loadTokens();
  initRouter();
}

initApp();