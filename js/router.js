// public/js/router.js

import { initSenderPage } from "./sender.js";
import { initDriverPage } from "./driver.js";
import { initAdminPage } from "./admin.js";

export function initRouter() {
  const path = window.location.pathname;

  if (path.endsWith("/sender.html")) {
    initSenderPage();
  }

  if (path.endsWith("/driver.html")) {
    initDriverPage();
  }

  if (path.endsWith("/admin.html")) {
    initAdminPage();
  }

  // index.html and about.html do not need JS initialization
}