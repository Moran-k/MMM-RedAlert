/**
 * MMM-RedAlert — node_helper.js
 *
 * Runs in Node.js (server side). Polls the Pikud HaOref API every N seconds,
 * filters alerts by configured locations and categories, deduplicates by alert ID,
 * and forwards matching alerts to the frontend via socket notifications.
 *
 * API endpoint: https://www.oref.org.il/WarningMessages/alert/alerts.json
 * - Returns an active alert JSON when sirens are active, or empty/null when quiet.
 * - Requires Referer and X-Requested-With headers to return data correctly.
 * - The endpoint is geo-restricted to Israeli IP addresses.
 */

"use strict";

const NodeHelper = require("node_helper");
const { parseOrefResponse, filterByLocation, matchesCategory, shouldSendAlert } = require("./lib/helpers");

// ─── Constants ────────────────────────────────────────────────────────────────

const OREF_API_HOST = "www.oref.org.il";
const OREF_API_PATH = "/WarningMessages/alert/alerts.json";
const OREF_API_REFERER = "https://www.oref.org.il/";
// 8s timeout — DNS resolution alone can take ~4s on the Pi, so 5s was too tight.
const REQUEST_TIMEOUT_MS = 8000;

// ─── Module ───────────────────────────────────────────────────────────────────

module.exports = NodeHelper.create({

  // ── State ──────────────────────────────────────────────────────────────────

  config: null,
  pollTimer: null,
  lastAlertId: null,
  lastAlertSentAt: 0,       // timestamp of last alert sent to frontend
  isRunning: false,
  pollCount: 0,
  isPollInProgress: false,  // guard: skip tick if previous request still in flight
  consecutiveErrors: 0,     // for backoff log rate-limiting

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  start() {
    console.log("[MMM-RedAlert] node_helper started");
  },

  stop() {
    this.stopPolling();
  },

  // ── Socket messages from frontend ──────────────────────────────────────────

  socketNotificationReceived(notification, payload) {
    if (notification === "START_MONITORING") {
      if (this.isRunning) {
        console.log("[MMM-RedAlert] Already running, ignoring duplicate START");
        return;
      }
      this.config = payload;
      this.isRunning = true;
      console.log(
        `[MMM-RedAlert] Starting — locations: [${this.config.locations.join(", ")}], ` +
        `categories: [${this.config.categories.join(", ")}], ` +
        `poll interval: ${this.config.pollInterval}ms`
      );
      this.sendSocketNotification("MONITORING_STARTED", {});
      if (this.config.debug) {
        console.log("[MMM-RedAlert] Debug mode ON — heartbeat logged every 30 polls (~60s). Watch pm2 logs for output.");
      }
      this.poll();  // immediate first poll
      this.pollTimer = setInterval(() => this.poll(), this.config.pollInterval);
    }
  },

  // ── Polling ────────────────────────────────────────────────────────────────

  stopPolling() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.isRunning = false;
  },

  async poll() {
    // Skip this tick if the previous request is still in flight.
    // Prevents connection pile-up when the API is slow or unreachable.
    if (this.isPollInProgress) {
      return;
    }

    this.isPollInProgress = true;
    try {
      const alertData = await this.fetchOrefAlert();

      // Successful response — reset error counter and log recovery if needed
      if (this.consecutiveErrors > 0) {
        console.log(`[MMM-RedAlert] API reachable again after ${this.consecutiveErrors} consecutive errors`);
        this.consecutiveErrors = 0;
      }

      // Pikud HaOref returns empty string, null, or empty object when no alerts
      if (!alertData || !alertData.data || alertData.data.length === 0) {
        // Log a heartbeat every 30 polls (~60s at default interval) so debug mode
        // produces visible output even when it's quiet
        this.pollCount++;
        if (this.config.debug && this.pollCount % 30 === 0) {
          console.log(`[MMM-RedAlert] ✓ Polling — quiet (${this.pollCount} polls completed, API reachable)`);
        }
        return;
      }

      // ── Filter by category ──
      if (!matchesCategory(alertData.cat, this.config.categories)) {
        if (this.config.debug) {
          console.log(`[MMM-RedAlert] Ignoring alert — category ${alertData.cat} not in watch list`);
        }
        return;
      }

      // ── Filter by location ──
      const matchedCities = filterByLocation(alertData.data, this.config.locations);
      if (matchedCities.length === 0) {
        if (this.config.debug) {
          console.log(`[MMM-RedAlert] Alert received but no matching locations. Alert cities: [${alertData.data.join(", ")}]`);
        }
        return;
      }

      // ── Deduplication ──
      // The oref API sometimes changes the alert ID mid-event (e.g. when the
      // city list is updated), so ID-only dedup isn't enough.
      // Also suppress re-firing while the previous alert is still on screen.
      const now = Date.now();
      const cooldown = this.config.displayDuration || 90000;
      if (!shouldSendAlert(alertData.id, this.lastAlertId, this.lastAlertSentAt, cooldown, now)) {
        return;
      }
      this.lastAlertId = alertData.id || String(now);
      this.lastAlertSentAt = now;

      console.log(
        `[MMM-RedAlert] 🚨 Alert! Category: ${alertData.cat} | ` +
        `Matched cities: [${matchedCities.join(", ")}]`
      );

      // ── Send to frontend ──
      this.sendSocketNotification("ALERT_RECEIVED", {
        id: this.lastAlertId,
        type: Number(alertData.cat),
        title: alertData.title || "התרעה",
        cities: matchedCities,
        allCities: alertData.data,
        desc: alertData.desc || "",
        timestamp: Date.now(),
      });

    } catch (err) {
      this.consecutiveErrors++;
      // AbortSignal.timeout throws TimeoutError; normalize the message
      const msg = err.name === "TimeoutError"
        ? `Request timed out after ${REQUEST_TIMEOUT_MS}ms`
        : err.message;
      // Log first error immediately, then every 30th — avoids flooding PM2 logs during outages
      if (this.consecutiveErrors === 1 || this.consecutiveErrors % 30 === 0) {
        console.error(`[MMM-RedAlert] Poll error (${this.consecutiveErrors} consecutive): ${msg}`);
      }
      this.sendSocketNotification("POLL_ERROR", msg);
    } finally {
      this.isPollInProgress = false;
    }
  },

  // ── HTTP Request ───────────────────────────────────────────────────────────

  async fetchOrefAlert() {
    const response = await fetch(`https://${OREF_API_HOST}${OREF_API_PATH}`, {
      headers: {
        "Referer": OREF_API_REFERER,
        "X-Requested-With": "XMLHttpRequest",
        "User-Agent": "Mozilla/5.0 (compatible; MMM-RedAlert/1.0)",
        "Accept": "application/json, text/plain, */*",
      },
      // AbortSignal.timeout is available in Node.js 17.3+.
      // DNS resolution on the Pi can take ~4s, so 8s gives enough headroom.
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    return parseOrefResponse(await response.text());
  },
});
