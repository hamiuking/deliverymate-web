import { initSenderPage } from "./sender.js";
import { initDriverPage } from "./driver.js";
import { initAdminPage } from "./admin.js";

export function initRouter() {
  const page = document.body?.dataset?.page || "";

  if (page === "sender") { initSenderPage(); return; }
  if (page === "driver") { initDriverPage(); return; }
  if (page === "admin") { initAdminPage(); return; }

  // fallback (optional)
  if (document.getElementById("senderLoginForm") || document.getElementById("senderDashboard")) { initSenderPage(); return; }
  if (document.getElementById("driverLoginForm") || document.getElementById("driverDashboard")) { initDriverPage(); return; }
  if (document.getElementById("adminLoginForm") || document.getElementById("adminDashboard")) { initAdminPage(); return; }
}
