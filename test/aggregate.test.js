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
    raw: { source: "google", medium: "cpc", campaign: "autumn" },
    downloads: 2, enquiries: 1,
  });
  assert.deepEqual(out.byCampaign[1], {
    source: "direct", medium: "none", campaign: "none",
    raw: { source: null, medium: null, campaign: null },
    downloads: 1, enquiries: 0,
  });
});

test("byCampaign carries the raw values alongside the direct/none display placeholders", () => {
  const out = aggregate(ROWS);
  for (const entry of out.byCampaign) {
    assert.ok("raw" in entry);
    assert.ok("source" in entry.raw && "medium" in entry.raw && "campaign" in entry.raw);
  }
});

test("a campaign genuinely named 'none' is not merged with a null campaign", () => {
  const rows = [
    // Null campaign: displays as "none", raw is null.
    { occurred_at: new Date("2026-09-01T10:00:00Z"), event: "download", asset: "win",
      source: "google", medium: "cpc", campaign: null, click_platform: "google" },
    // A campaign literally named "none": displays the same, but is a
    // distinct, real value that must not be deleted alongside the null one.
    { occurred_at: new Date("2026-09-01T11:00:00Z"), event: "download", asset: "win",
      source: "google", medium: "cpc", campaign: "none", click_platform: "google" },
  ];
  const out = aggregate(rows);
  assert.equal(out.byCampaign.length, 2);
  const nullCampaign = out.byCampaign.find((e) => e.raw.campaign === null);
  const literalCampaign = out.byCampaign.find((e) => e.raw.campaign === "none");
  assert.ok(nullCampaign, "expected an entry for the null campaign");
  assert.ok(literalCampaign, "expected an entry for the literal 'none' campaign");
  assert.equal(nullCampaign.campaign, "none");
  assert.equal(literalCampaign.campaign, "none");
  assert.equal(nullCampaign.downloads, 1);
  assert.equal(literalCampaign.downloads, 1);
});

test("assets are counted from downloads only", () => {
  const out = aggregate(ROWS);
  assert.deepEqual(out.byAsset, [
    { asset: "win", downloads: 2 },
    { asset: "mac-arm64", downloads: 1 },
  ]);
});

test("platforms are grouped and sorted by total conversions, null as organic", () => {
  const out = aggregate(ROWS);
  assert.deepEqual(out.byPlatform, [
    { platform: "google", downloads: 2, enquiries: 1 },
    { platform: "organic", downloads: 1, enquiries: 0 },
  ]);
});

test("platforms sort by total conversions across more than two groups", () => {
  const rows = [
    { occurred_at: new Date("2026-09-01T10:00:00Z"), event: "download", asset: "win", click_platform: "meta" },
    { occurred_at: new Date("2026-09-01T11:00:00Z"), event: "download", asset: "win", click_platform: "google" },
    { occurred_at: new Date("2026-09-01T12:00:00Z"), event: "enquiry", asset: null, click_platform: "google" },
    { occurred_at: new Date("2026-09-01T13:00:00Z"), event: "enquiry", asset: null, click_platform: "google" },
    { occurred_at: new Date("2026-09-01T14:00:00Z"), event: "download", asset: "mac-arm64", click_platform: null },
  ];
  const out = aggregate(rows);
  assert.deepEqual(out.byPlatform, [
    { platform: "google", downloads: 1, enquiries: 2 },
    { platform: "meta", downloads: 1, enquiries: 0 },
    { platform: "organic", downloads: 1, enquiries: 0 },
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
  assert.deepEqual(out.byPlatform, []);
  assert.deepEqual(out.daily, []);
});
