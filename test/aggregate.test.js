import test from "node:test";
import assert from "node:assert/strict";
import { aggregate, parseRange } from "../api/_lib/aggregate.js";

const NOW = new Date("2026-09-22T12:00:00Z");

test("parseRange defaults to the last 30 days", () => {
  const r = parseRange(undefined, undefined, NOW);
  assert.equal(r.ok, true);
  assert.equal(r.from.toISOString().slice(0, 10), "2026-08-24");
});

test("parseRange accepts an explicit range and makes the end exclusive", () => {
  const r = parseRange("2026-09-01", "2026-09-07", NOW);
  assert.equal(r.ok, true);
  assert.equal(r.from.toISOString(), "2026-09-01T00:00:00.000Z");
  assert.equal(r.to.toISOString(), "2026-09-08T00:00:00.000Z");
});

test("parseRange rejects junk and inverted ranges", () => {
  assert.equal(parseRange("not-a-date", "2026-09-07", NOW).ok, false);
  assert.equal(parseRange("2026-09-07", "2026-09-01", NOW).ok, false);
  assert.equal(parseRange("2026-09-01", "not-a-date", NOW).ok, false);
});

const ROWS = [
  { occurred_at: new Date("2026-09-01T10:00:00Z"), event: "download", asset: "win", source: "google", medium: "cpc", campaign: "autumn", click_platform: "google" },
  { occurred_at: new Date("2026-09-01T11:00:00Z"), event: "download", asset: "win", source: "google", medium: "cpc", campaign: "autumn", click_platform: "google" },
  { occurred_at: new Date("2026-09-02T10:00:00Z"), event: "enquiry", asset: null, source: "google", medium: "cpc", campaign: "autumn", click_platform: "google" },
  { occurred_at: new Date("2026-09-02T10:30:00Z"), event: "download", asset: "mac-arm64", source: null, medium: null, campaign: null, click_platform: null },
];

test("totals count each event type", () => {
  const out = aggregate(ROWS);
  assert.deepEqual(out.totals, { downloads: 3, enquiries: 1 });
});

test("campaigns are grouped and sorted by total conversions", () => {
  const out = aggregate(ROWS);
  assert.equal(out.byCampaign.length, 2);
  assert.deepEqual(out.byCampaign[0], {
    source: "google", medium: "cpc", campaign: "autumn",
    downloads: 2, enquiries: 1,
  });
  assert.deepEqual(out.byCampaign[1], {
    source: "direct", medium: "none", campaign: "none",
    downloads: 1, enquiries: 0,
  });
});

test("assets are counted from downloads only", () => {
  const out = aggregate(ROWS);
  assert.deepEqual(out.byAsset, [
    { asset: "win", downloads: 2 },
    { asset: "mac-arm64", downloads: 1 },
  ]);
});

test("daily series is ascending with one entry per day seen", () => {
  const out = aggregate(ROWS);
  assert.deepEqual(out.daily, [
    { date: "2026-09-01", downloads: 2, enquiries: 0 },
    { date: "2026-09-02", downloads: 1, enquiries: 1 },
  ]);
});

test("no rows yields zeroes rather than throwing", () => {
  const out = aggregate([]);
  assert.deepEqual(out.totals, { downloads: 0, enquiries: 0 });
  assert.deepEqual(out.byCampaign, []);
  assert.deepEqual(out.byAsset, []);
  assert.deepEqual(out.daily, []);
});
