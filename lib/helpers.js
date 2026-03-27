"use strict";

/**
 * Pure helper functions for MMM-RedAlert.
 * No dependencies — safe to import in tests without a MagicMirror runtime.
 */

/**
 * Parse a raw text response from the Pikud HaOref API.
 *
 * The API returns:
 *   - Empty string or whitespace when quiet
 *   - A UTF-8 BOM (\uFEFF) optionally prepended to the JSON
 *   - `{}` when quiet (no `data` field)
 *   - `{id, cat, title, desc, data: [...]}` when sirens are active
 *
 * @param {string} text  Raw response body
 * @returns {object|null}  Parsed alert object, or null if no active alert
 */
function parseOrefResponse(text) {
  if (!text) return null;
  const trimmed = text.trim();
  if (!trimmed || trimmed === "\uFEFF") return null;

  try {
    const parsed = JSON.parse(trimmed.replace(/^\uFEFF/, ""));
    return parsed?.data ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Filter alert cities against the configured location list.
 *
 * Matching is bidirectional substring:
 *   config "אשדוד"             matches alert "אשדוד - כל האזורים"
 *   config "תל אביב - מרכז"   matches alert "תל אביב"
 *
 * @param {string[]} alertCities  City list from the API response
 * @param {string[]} locations    Configured locations (["*"] = accept all)
 * @returns {string[]}            Subset of alertCities that matched
 */
function filterByLocation(alertCities, locations) {
  if (!locations || locations.includes("*")) return alertCities;

  return alertCities.filter((alertCity) =>
    locations.some((configLoc) => {
      const city = alertCity.trim();
      const loc = configLoc.trim();
      return city.includes(loc) || loc.includes(city);
    })
  );
}

/**
 * Return true if the alert category is in the configured watch list.
 * An empty or missing list accepts all categories.
 *
 * @param {number|string} cat       Alert category from the API (`alertData.cat`)
 * @param {number[]}      categories  Configured category filter
 * @returns {boolean}
 */
function matchesCategory(cat, categories) {
  if (!categories || categories.length === 0) return true;
  return categories.includes(Number(cat));
}

/**
 * Return true if this alert should be forwarded to the frontend.
 * Suppresses duplicates (same ID) and re-fires within the cooldown window.
 *
 * @param {string|null} alertId      ID from the current alert (`alertData.id`)
 * @param {string|null} lastAlertId  ID of the last alert that was sent
 * @param {number}      lastSentAt   Timestamp (ms) of the last alert sent
 * @param {number}      cooldown     Suppression window in ms (= displayDuration)
 * @param {number}      now          Current timestamp in ms
 * @returns {boolean}
 */
function shouldSendAlert(alertId, lastAlertId, lastSentAt, cooldown, now) {
  if (alertId && alertId === lastAlertId) return false;
  if (now - lastSentAt < cooldown) return false;
  return true;
}

module.exports = { parseOrefResponse, filterByLocation, matchesCategory, shouldSendAlert };
