/**
 * MMM-RedAlert
 * MagicMirror² module for Israeli missile alerts (Tzeva Adom / צבע אדום)
 *
 * Displays a full-screen alert overlay when rocket/missile warnings are
 * issued by Pikud HaOref for your configured locations.
 *
 * Author: Moran Kalmanovich
 * License: MIT
 */

Module.register("MMM-RedAlert", {

  defaults: {
    // Locations to watch — Hebrew city/area names as they appear in Pikud HaOref data.
    // Use partial names: "אשדוד" will match "אשדוד - כל האזורים", etc.
    // Use ["*"] to receive alerts for ALL locations in Israel.
    locations: ["*"],

    // Alert categories to monitor (empty array = all categories).
    // 1=missiles/rockets, 2=hostile aircraft, 3=earthquake,
    // 4=tsunami, 5=radiological, 6=terrorist infiltration, 7=hazmat, 13=unconventional missile
    categories: [1, 2, 6, 13],

    // Polling interval in milliseconds (recommended: 2000–3000)
    pollInterval: 2000,

    // How long to show the alert before it auto-dismisses (ms). Default: 90 seconds.
    displayDuration: 90000,

    // Title shown at the top of the alert (Hebrew default)
    alertTitle: "🚨 צבע אדום",

    // Show the list of affected cities
    showLocations: true,

    // Show Pikud HaOref's safety instructions
    showInstructions: true,

    // Slide-in animation on alert entry
    animateEntry: true,

    // Log polling activity to the browser console (useful for debugging)
    debug: false,
  },

  // ─── Module state ──────────────────────────────────────────────────────────

  alertData: null,
  alertVisible: false,
  dismissTimer: null,

  // ─── Lifecycle ─────────────────────────────────────────────────────────────

  start() {
    Log.info(`[MMM-RedAlert] Starting module`);
    this.alertData = null;
    this.alertVisible = false;
    this.dismissTimer = null;
    this.sendSocketNotification("START_MONITORING", this.config);
  },

  getStyles() {
    return ["MMM-RedAlert.css"];
  },

  // ─── DOM ───────────────────────────────────────────────────────────────────

  getDom() {
    const wrapper = document.createElement("div");
    wrapper.id = "red-alert-wrapper";
    wrapper.className = "red-alert-wrapper";

    if (!this.alertData || !this.alertVisible) {
      wrapper.classList.add("hidden");
      return wrapper;
    }

    // Outer container — pulsing red background
    wrapper.classList.add("red-alert-active");
    if (this.config.animateEntry) {
      wrapper.classList.add("red-alert-animate-in");
    }

    // ── Alert icon + title ──
    const header = document.createElement("div");
    header.className = "red-alert-header";

    const icon = document.createElement("div");
    icon.className = "red-alert-icon";
    icon.textContent = "⚠";
    header.appendChild(icon);

    const title = document.createElement("div");
    title.className = "red-alert-title";
    title.textContent = this.config.alertTitle;
    header.appendChild(title);

    wrapper.appendChild(header);

    // ── Alert type description (from Pikud HaOref) ──
    if (this.alertData.title) {
      const desc = document.createElement("div");
      desc.className = "red-alert-description";
      desc.textContent = this.alertData.title;
      wrapper.appendChild(desc);
    }

    // ── Affected cities ──
    if (this.config.showLocations && this.alertData.cities && this.alertData.cities.length > 0) {
      const locWrapper = document.createElement("div");
      locWrapper.className = "red-alert-locations-wrapper";

      const locLabel = document.createElement("div");
      locLabel.className = "red-alert-locations-label";
      locLabel.textContent = "אזורים:";
      locWrapper.appendChild(locLabel);

      const locList = document.createElement("div");
      locList.className = "red-alert-locations";

      // Show up to 10 cities; truncate if more
      const cities = this.alertData.cities;
      const displayCities = cities.slice(0, 10);
      locList.textContent = displayCities.join(" • ");

      if (cities.length > 10) {
        const more = document.createElement("span");
        more.className = "red-alert-more";
        more.textContent = ` ועוד ${cities.length - 10}...`;
        locList.appendChild(more);
      }

      locWrapper.appendChild(locList);
      wrapper.appendChild(locWrapper);
    }

    // ── Safety instructions ──
    if (this.config.showInstructions && this.alertData.desc) {
      const instructions = document.createElement("div");
      instructions.className = "red-alert-instructions";
      instructions.textContent = this.alertData.desc;
      wrapper.appendChild(instructions);
    }

    // ── Countdown bar ──
    const progressWrapper = document.createElement("div");
    progressWrapper.className = "red-alert-progress-wrapper";
    const progressBar = document.createElement("div");
    progressBar.className = "red-alert-progress-bar";
    progressBar.style.animationDuration = `${this.config.displayDuration}ms`;
    progressWrapper.appendChild(progressBar);
    wrapper.appendChild(progressWrapper);

    return wrapper;
  },

  // ─── Socket notifications from node_helper ─────────────────────────────────

  socketNotificationReceived(notification, payload) {
    if (notification === "ALERT_RECEIVED") {
      if (this.config.debug) {
        Log.info(`[MMM-RedAlert] Alert received:`, payload);
      }
      this.alertData = payload;
      this.showAlert();
    }

    if (notification === "MONITORING_STARTED") {
      Log.info(`[MMM-RedAlert] Monitoring started. Locations: ${this.config.locations.join(", ")}`);
    }

    if (notification === "POLL_ERROR") {
      if (this.config.debug) {
        Log.warn(`[MMM-RedAlert] Poll error: ${payload}`);
      }
    }
  },

  // ─── Alert show / hide ─────────────────────────────────────────────────────

  showAlert() {
    this.alertVisible = true;
    this.updateDom(400);

    // Reset dismiss timer on each new alert
    clearTimeout(this.dismissTimer);
    this.dismissTimer = setTimeout(() => {
      this.hideAlert();
    }, this.config.displayDuration);
  },

  hideAlert() {
    this.alertVisible = false;
    this.alertData = null;
    this.updateDom(800);
  },
});
