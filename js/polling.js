// polling.js - Real-time status polling for DeliveryMate
// Usage: import { startPolling } from './polling.js';

export class StatusPoller {
  constructor(options = {}) {
    this.interval = options.interval || 30000; // 30 seconds default
    this.onUpdate = options.onUpdate || (() => {});
    this.getRequestId = options.getRequestId || (() => null);
    this.getEndpoint = options.getEndpoint || ((id) => `/requests/${id}`);
    this.apiRole = options.apiRole || 'sender';
    
    this.timer = null;
    this.lastUpdateTime = null;
    this.isPaused = false;
    this.isActive = false;
  }

  /**
   * Start polling
   */
  start() {
    if (this.isActive) return;
    
    this.isActive = true;
    this._setupVisibilityListener();
    this._poll();
    this.timer = setInterval(() => this._poll(), this.interval);
  }

  /**
   * Stop polling
   */
  stop() {
    this.isActive = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Pause polling (when tab hidden)
   */
  pause() {
    this.isPaused = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Resume polling (when tab visible)
   */
  resume() {
    if (!this.isActive) return;
    
    this.isPaused = false;
    this._poll(); // Immediate poll on resume
    this.timer = setInterval(() => this._poll(), this.interval);
  }

  /**
   * Force an immediate poll
   */
  pollNow() {
    this._poll();
  }

  /**
   * Get time since last update (in seconds)
   */
  getSecondsSinceUpdate() {
    if (!this.lastUpdateTime) return null;
    return Math.floor((Date.now() - this.lastUpdateTime) / 1000);
  }

  /**
   * Get human-readable time since update
   */
  getTimeSinceUpdate() {
    const seconds = this.getSecondsSinceUpdate();
    if (seconds === null) return 'never';
    if (seconds < 5) return 'just now';
    if (seconds < 60) return `${seconds} seconds ago`;
    
    const minutes = Math.floor(seconds / 60);
    if (minutes === 1) return '1 minute ago';
    if (minutes < 60) return `${minutes} minutes ago`;
    
    const hours = Math.floor(minutes / 60);
    if (hours === 1) return '1 hour ago';
    return `${hours} hours ago`;
  }

  /**
   * Internal: Perform the poll
   */
  async _poll() {
    if (this.isPaused) return;
    
    const requestId = this.getRequestId();
    if (!requestId) return; // No request loaded, skip polling
    
    try {
      const endpoint = this.getEndpoint(requestId);
      
      // Use the shared api module
      const { api } = await import('./api.js');
      
      const res = await api(endpoint, {
        method: 'GET',
        role: this.apiRole
      });
      
      if (res.ok && res.request) {
        this.lastUpdateTime = Date.now();
        this.onUpdate(res.request);
      }
    } catch (err) {
      console.error('Polling error:', err);
      // Continue polling even on error
    }
  }

  /**
   * Internal: Setup visibility change listener
   */
  _setupVisibilityListener() {
    if (this._visibilityHandler) return; // Already setup
    
    this._visibilityHandler = () => {
      if (document.hidden) {
        this.pause();
      } else {
        this.resume();
      }
    };
    
    document.addEventListener('visibilitychange', this._visibilityHandler);
    
    // Cleanup on page unload
    window.addEventListener('beforeunload', () => {
      this.stop();
      if (this._visibilityHandler) {
        document.removeEventListener('visibilitychange', this._visibilityHandler);
      }
    });
  }
}

/**
 * Create and start a poller with simplified API
 * 
 * @param {Object} options
 * @param {Function} options.getRequestId - Function that returns current request ID
 * @param {Function} options.onUpdate - Callback when new data arrives
 * @param {string} options.apiRole - 'sender' or 'driver'
 * @param {number} options.interval - Poll interval in ms (default: 30000)
 * @returns {StatusPoller}
 */
export function startPolling(options) {
  const poller = new StatusPoller(options);
  poller.start();
  return poller;
}

/**
 * Utility: Update "last updated" timestamp in UI
 * 
 * @param {StatusPoller} poller
 * @param {string} elementId - ID of element to update
 */
export function updateLastUpdatedDisplay(poller, elementId) {
  const el = document.getElementById(elementId);
  if (!el) return;
  
  function update() {
    el.textContent = poller.getTimeSinceUpdate();
  }
  
  // Update every 5 seconds
  update();
  setInterval(update, 5000);
}

/**
 * Example usage in sender.js:
 * 
 * import { startPolling, updateLastUpdatedDisplay } from './polling.js';
 * 
 * const poller = startPolling({
 *   apiRole: 'sender',
 *   getRequestId: () => {
 *     const form = document.getElementById('viewRequestForm');
 *     return form?.request_id?.value || null;
 *   },
 *   onUpdate: (request) => {
 *     // Update UI without showing success message
 *     renderRequestSummary(request);
 *     updateNextActionBanner(request);
 *   },
 *   interval: 30000 // 30 seconds
 * });
 * 
 * // Show "Updated X ago" text
 * updateLastUpdatedDisplay(poller, 'lastUpdatedText');
 */

/**
 * Example usage in driver.js:
 * 
 * const poller = startPolling({
 *   apiRole: 'driver',
 *   getRequestId: () => {
 *     const form = document.getElementById('driverViewForm');
 *     return form?.request_id?.value || null;
 *   },
 *   onUpdate: (request) => {
 *     renderDriverSummary(request);
 *     updateDriverNextActionBanner(request);
 *   }
 * });
 */
