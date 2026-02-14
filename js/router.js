import { initSenderPage } from "./sender.js";
import { initDriverPage } from "./driver.js";
import { initAdminPage } from "./admin.js";

export function initRouter() {
  // Sender page
  if (document.getElementById("senderLoginForm") || document.getElementById("senderDashboard")) {
    initSenderPage();
    return;
  }

  // Driver page
  if (document.getElementById("driverLoginForm") || document.getElementById("driverDashboard")) {
    initDriverPage();
    return;
  }

  // Admin page
  if (document.getElementById("adminLoginForm") || document.getElementById("adminDashboard")) {
    initAdminPage();
    return;
  }

  // Index / other pages: do nothing
}
