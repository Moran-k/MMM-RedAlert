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
const https = require("https");

// ─── Constants ────────────────────────────────────────────────────────────────

const OREF_API_HOST = "www.oref.org.il";
const OREF_API_PATH = "/WarningMessages/alert/alerts.json";
const OREF_API_REFERER = "https://www.oref.org.il/";
const REQUEST_TIMEOUT_MS = 5000;

// ─── Module ───────────────────────────────────────────────────────────────────

module.exports = NodeHelper.create({

  // ── State ──────────────────────────────────────────────────────────────────

  config: null,
  pollTimer: null,
  lastAlertId: null,
  isRunning: false,

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
    try {
      const alertData = await this.fetchOrefAlert();

      // Pikud HaOref returns empty string, null, or empty object when no alerts
      if (!alertData || !alertData.data || alertData.data.length === 0) {
        // No active alert — nothing to do
        return;
      }

      // ── Filter by category ──
      if (this.config.categories && this.config.categories.length > 0) {
        const cat = Number(alertData.cat);
        if (!this.config.categories.includes(cat)) {
          if (this.config.debug) {
            console.log(`[MMM-RedAlert] Ignoring alert — category ${cat} not in watch list`);
          }
          return;
        }
      }

      // ── Filter by location ──
      const matchedCities = this.filterByLocation(alertData.data);
      if (matchedCities.length === 0) {
        if (this.config.debug) {
          console.log(`[MMM-RedAlert] Alert received but no matching locations. Alert cities: [${alertData.data.join(", ")}]`);
        }
        return;
      }

      // ── Deduplication — skip if same alert ID already sent ──
      if (alertData.id && alertData.id === this.lastAlertId) {
        return;
      }
      this.lastAlertId = alertData.id || String(Date.now());

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
      if (this.config && this.config.debug) {
        console.error(`[MMM-RedAlert] Poll error: ${err.message}`);
      }
      this.sendSocketNotification("POLL_ERROR", err.message);
    }
  },

  // ── HTTP Request ───────────────────────────────────────────────────────────

  fetchOrefAlert() {
    return new Promise((resolve, reject) => {
      const options = {
        hostname: OREF_API_HOST,
        path: OREF_API_PATH,
        method: "GET",
        headers: {
          "Referer": OREF_API_REFERER,
          "X-Requested-With": "XMLHttpRequest",
          "User-Agent": "Mozilla/5.0 (compatible; MMM-RedAlert/1.0)",
          "Accept": "application/json, text/plain, */*",
        },
      };

      const req = https.request(options, (res) => {
        let raw = "";

        res.setEncoding("utf8");
        res.on("data", (chunk) => { raw += chunk; });

        res.on("end", () => {
          const trimmed = raw.trim();

          // Quiet state: API returns empty string or just whitespace
          if (!trimmed || trimmed === "\ufeff") {
            resolve(null);
            return;
          }

          try {
            // Strip optional BOM (the API sometimes includes one)
            const cleaned = trimmed.replace(/^\uFEFF/, "");
            const parsed = JSON.parse(cleaned);

            // API may return {} when quiet
            if (!parsed || typeof parsed !== "object" || !parsed.data) {
              resolve(null);
            } else {
              resolve(parsed);
            }
          } catch (parseErr) {
            // Not valid JSON — treat as no alert
            resolve(null);
          }
        });
      });

      req.on("error", reject);

      // Hard timeout — don't let a slow response hold up the next poll cycle
      req.setTimeout(REQUEST_TIMEOUT_MS, () => {
        req.destroy(new Error(`Request timed out after ${REQUEST_TIMEOUT_MS}ms`));
      });

      req.end();
    });
  },

  // ── Location Filtering ─────────────────────────────────────────────────────

  /**
   * Given the full list of cities in the alert, returns only those
   * that match the configured locations.
   *
   * Matching is bidirectional substring so:
   *   - config "אשדוד" matches alert city "אשדוד - כל האזורים"
   *   - config "תל אביב" matches alert city "תל אביב - מרכז העיר"
   *   - config "*" matches everything
   */
  filterByLocation(alertCities) {
    if (!this.config.locations || this.config.locations.includes("*")) {
      return alertCities;
    }

    return alertCities.filter((alertCity) =>
      this.config.locations.some((configLoc) => {
        const city = alertCity.trim();
        const loc = configLoc.trim();
        return city.includes(loc) || loc.includes(city);
      })
    );
  },
});
