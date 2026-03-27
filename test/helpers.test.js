"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { parseOrefResponse, filterByLocation, matchesCategory, shouldSendAlert } = require("../lib/helpers");

// ─── parseOrefResponse ────────────────────────────────────────────────────────

describe("parseOrefResponse", () => {
  it("returns null for empty string", () => {
    assert.equal(parseOrefResponse(""), null);
  });

  it("returns null for null", () => {
    assert.equal(parseOrefResponse(null), null);
  });

  it("returns null for whitespace only", () => {
    assert.equal(parseOrefResponse("   "), null);
  });

  it("returns null for bare BOM", () => {
    assert.equal(parseOrefResponse("\uFEFF"), null);
  });

  it("returns null for empty object {}", () => {
    assert.equal(parseOrefResponse("{}"), null);
  });

  it("returns null for object without data field", () => {
    assert.equal(parseOrefResponse('{"id":"1","cat":"1"}'), null);
  });

  it("returns null for invalid JSON", () => {
    assert.equal(parseOrefResponse("not json"), null);
  });

  it("returns parsed object for valid JSON with empty data array", () => {
    // Empty data array is truthy — parseOrefResponse returns it as-is.
    // The data.length === 0 guard lives in poll(), not here.
    assert.deepEqual(parseOrefResponse('{"id":"1","cat":"1","data":[]}'), { id: "1", cat: "1", data: [] });
  });

  it("parses a valid alert response", () => {
    const payload = { id: "123", cat: "1", title: "ירי רקטות וטילים", desc: "היכנסו למרחב מוגן", data: ["אשדוד"] };
    const result = parseOrefResponse(JSON.stringify(payload));
    assert.deepEqual(result, payload);
  });

  it("strips leading BOM before parsing", () => {
    const payload = { id: "456", cat: "1", title: "test", desc: "", data: ["תל אביב"] };
    const result = parseOrefResponse("\uFEFF" + JSON.stringify(payload));
    assert.deepEqual(result, payload);
  });

  it("strips leading BOM with surrounding whitespace", () => {
    const payload = { id: "789", cat: "2", title: "test", desc: "", data: ["חיפה"] };
    const result = parseOrefResponse("  \uFEFF" + JSON.stringify(payload) + "  ");
    assert.deepEqual(result, payload);
  });
});

// ─── filterByLocation ─────────────────────────────────────────────────────────

describe("filterByLocation", () => {
  const cities = ["אשדוד - כל האזורים", "תל אביב - מרכז העיר", "חיפה"];

  it("returns all cities for wildcard [\"*\"]", () => {
    assert.deepEqual(filterByLocation(cities, ["*"]), cities);
  });

  it("returns all cities for null locations", () => {
    assert.deepEqual(filterByLocation(cities, null), cities);
  });

  it("returns all cities for undefined locations", () => {
    assert.deepEqual(filterByLocation(cities, undefined), cities);
  });

  it("matches when config term is substring of alert city", () => {
    // "אשדוד" is a substring of "אשדוד - כל האזורים"
    assert.deepEqual(filterByLocation(cities, ["אשדוד"]), ["אשדוד - כל האזורים"]);
  });

  it("matches when alert city is substring of config term", () => {
    // "חיפה" (alert) is a substring of "חיפה - כרמל" (config)
    assert.deepEqual(filterByLocation(["חיפה"], ["חיפה - כרמל"]), ["חיפה"]);
  });

  it("returns empty array when no cities match", () => {
    assert.deepEqual(filterByLocation(cities, ["באר שבע"]), []);
  });

  it("returns empty array for empty locations list", () => {
    assert.deepEqual(filterByLocation(cities, []), []);
  });

  it("matches multiple cities from a multi-location config", () => {
    const result = filterByLocation(cities, ["אשדוד", "חיפה"]);
    assert.deepEqual(result, ["אשדוד - כל האזורים", "חיפה"]);
  });

  it("trims whitespace from both sides before comparing", () => {
    assert.deepEqual(filterByLocation([" חיפה "], [" חיפה "]), [" חיפה "]);
  });
});

// ─── matchesCategory ──────────────────────────────────────────────────────────

describe("matchesCategory", () => {
  it("returns true for null categories (accept all)", () => {
    assert.equal(matchesCategory(1, null), true);
  });

  it("returns true for empty categories array (accept all)", () => {
    assert.equal(matchesCategory(1, []), true);
  });

  it("returns true when category is in the list", () => {
    assert.equal(matchesCategory(1, [1, 2, 3]), true);
  });

  it("returns false when category is not in the list", () => {
    assert.equal(matchesCategory(5, [1, 2, 3]), false);
  });

  it("coerces string cat to number before comparing", () => {
    // API returns cat as a string; config stores numbers
    assert.equal(matchesCategory("1", [1, 2, 3]), true);
  });

  it("coerces string cat that does not match", () => {
    assert.equal(matchesCategory("5", [1, 2, 3]), false);
  });
});

// ─── shouldSendAlert ──────────────────────────────────────────────────────────

describe("shouldSendAlert", () => {
  const COOLDOWN = 90_000;
  const BASE_TIME = 1_000_000;

  it("returns false for same alert ID", () => {
    assert.equal(shouldSendAlert("id-1", "id-1", 0, COOLDOWN, BASE_TIME), false);
  });

  it("returns true for new ID with cooldown elapsed", () => {
    assert.equal(shouldSendAlert("id-2", "id-1", BASE_TIME - COOLDOWN, COOLDOWN, BASE_TIME), true);
  });

  it("returns false when cooldown has not elapsed", () => {
    assert.equal(shouldSendAlert("id-2", "id-1", BASE_TIME - 1000, COOLDOWN, BASE_TIME), false);
  });

  it("returns true when there was no previous alert (lastSentAt = 0)", () => {
    assert.equal(shouldSendAlert("id-1", null, 0, COOLDOWN, BASE_TIME), true);
  });

  it("returns true for null alertId when cooldown elapsed", () => {
    // API sometimes omits the id field
    assert.equal(shouldSendAlert(null, null, BASE_TIME - COOLDOWN, COOLDOWN, BASE_TIME), true);
  });

  it("returns false for null alertId when cooldown has not elapsed", () => {
    assert.equal(shouldSendAlert(null, null, BASE_TIME - 1000, COOLDOWN, BASE_TIME), false);
  });

  it("returns true exactly at the cooldown boundary", () => {
    assert.equal(shouldSendAlert("id-2", "id-1", BASE_TIME - COOLDOWN, COOLDOWN, BASE_TIME), true);
  });
});
