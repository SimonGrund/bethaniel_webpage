import test from "node:test";
import assert from "node:assert/strict";
import { aggregate, parseRange, trend, trendRange, bestCampaign } from "../api/_lib/aggregate.js";

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
  assert.deepEqual(out.totals, { visits: 0, views: 0, downloads: 3, enquiries: 1, links: 0, signups: 0, rate: null });
});

test("campaigns are grouped and sorted by total conversions", () => {
  const out = aggregate(ROWS);
  assert.equal(out.byCampaign.length, 2);
  assert.deepEqual(out.byCampaign[0], {
    source: "google", medium: "cpc", campaign: "autumn",
    raw: { source: "google", medium: "cpc", campaign: "autumn" },
    visits: 0, downloads: 2, enquiries: 1, links: 0, signups: 0, rate: null,
  });
  assert.deepEqual(out.byCampaign[1], {
    source: "direct", medium: "none", campaign: "none",
    raw: { source: null, medium: null, campaign: null },
    visits: 0, downloads: 1, enquiries: 0, links: 0, signups: 0, rate: null,
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
    { platform: "google", visits: 0, downloads: 2, enquiries: 1, links: 0, signups: 0, rate: null },
    { platform: "organic", visits: 0, downloads: 1, enquiries: 0, links: 0, signups: 0, rate: null },
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
  assert.deepEqual(out.byPlatform.map((p) => [p.platform, p.downloads, p.enquiries]), [
    ["google", 1, 2],
    ["meta", 1, 0],
    ["organic", 1, 0],
  ]);
});

test("ads are told apart by utm_content within a campaign, and devices by OS bucket", () => {
  const at = new Date("2026-10-01T10:00:00Z");
  const view = (content, ua_platform) => ({ occurred_at: at, event: "view", entry: true, source: "fb", medium: "paid_social", campaign: "launch_ab", content, ua_platform });
  const rows = [
    view("a", "ios"), view("a", "ios"), view("b", "android"), view(null, "ios"),
    { occurred_at: at, event: "signup", form: "phone-link", source: "fb", medium: "paid_social", campaign: "launch_ab", content: "b", ua_platform: "android" },
    { occurred_at: at, event: "download", asset: "win", source: null, medium: null, campaign: null, content: "stray", ua_platform: "windows" },
    { occurred_at: at, event: "view", entry: true, campaign: null },
  ];
  const out = aggregate(rows);
  assert.deepEqual(out.byAd.map((r) => [r.campaign, r.content, r.visits, r.links]), [
    ["launch_ab", "a", 2, 0],
    ["launch_ab", "b", 1, 1],
    ["launch_ab", "(not set)", 1, 0],
  ]);
  assert.deepEqual(out.byDevice.map((r) => [r.device, r.visits, r.downloads, r.links]), [
    ["windows", 0, 1, 0],
    ["ios", 3, 0, 0],
    ["android", 1, 0, 1],
    ["unknown", 1, 0, 0],
  ]);
});

test("daily series is ascending with one entry per day seen", () => {
  const out = aggregate(ROWS);
  assert.deepEqual(out.daily, [
    { date: "2026-09-01", visits: 0, downloads: 2, enquiries: 0, links: 0, signups: 0 },
    { date: "2026-09-02", visits: 0, downloads: 1, enquiries: 1, links: 0, signups: 0 },
  ]);
});

test("no rows yields zeroes rather than throwing", () => {
  const out = aggregate([]);
  assert.deepEqual(out.totals, { visits: 0, views: 0, downloads: 0, enquiries: 0, links: 0, signups: 0, rate: null });
  assert.deepEqual(out.byCampaign, []);
  assert.deepEqual(out.byAsset, []);
  assert.deepEqual(out.byPlatform, []);
  assert.deepEqual(out.byPage, []);
  assert.deepEqual(out.daily, []);
});

/* Two sessions from one campaign — each lands, then clicks on — and one
   direct session that only lands. Three visits, six views. */
const at = (h) => new Date(`2026-09-03T${String(h).padStart(2, "0")}:00:00Z`);
const autumn = { source: "google", medium: "cpc", campaign: "autumn", click_platform: "google" };
const VIEWS = [
  { occurred_at: at(9), event: "view", page: "/", entry: true, ...autumn },
  { occurred_at: at(9), event: "view", page: "/performance", entry: false, ...autumn },
  { occurred_at: at(10), event: "view", page: "/da/", entry: true, ...autumn },
  { occurred_at: at(10), event: "view", page: "/", entry: false, ...autumn },
  { occurred_at: at(10), event: "download", asset: "win", ...autumn },
  { occurred_at: at(11), event: "view", page: "/", entry: true, source: null, medium: null, campaign: null, click_platform: null },
  { occurred_at: at(12), event: "view", page: null, entry: null, source: null, medium: null, campaign: null, click_platform: null },
];

test("a visit is an entry view; every view is a page view", () => {
  const out = aggregate(VIEWS);
  assert.equal(out.totals.visits, 3);
  assert.equal(out.totals.views, 6);
  assert.equal(out.totals.downloads, 1);
  assert.equal(out.totals.rate, 33);
});

test("campaigns count visits, not page views, and carry a download rate", () => {
  const out = aggregate(VIEWS);
  const a = out.byCampaign.find((c) => c.campaign === "autumn");
  assert.equal(a.visits, 2);
  assert.equal(a.downloads, 1);
  assert.equal(a.rate, 50);
  const direct = out.byCampaign.find((c) => c.raw.campaign === null);
  assert.equal(direct.visits, 1);
  assert.equal(direct.rate, 0);
});

test("pages count views and landings, a bad page under its own label", () => {
  const out = aggregate(VIEWS);
  assert.deepEqual(out.byPage, [
    { page: "/", views: 3, landings: 2 },
    { page: "(unknown)", views: 1, landings: 0 },
    { page: "/da/", views: 1, landings: 1 },
    { page: "/performance", views: 1, landings: 0 },
  ]);
});

/* "Now" is midday on 30 September; today counts as day one of each window. */
const T_NOW = new Date("2026-09-30T12:00:00Z");
const day = (d, h = 10) => new Date(Date.UTC(2026, 8, d, h));
const v = (d) => ({ occurred_at: day(d), event: "view", entry: true });
const dl = (d) => ({ occurred_at: day(d), event: "download", asset: "win" });

test("trendRange spans the 60 UTC days ending with today", () => {
  const r = trendRange(T_NOW);
  assert.equal(r.to.toISOString(), "2026-10-01T00:00:00.000Z");
  assert.equal(r.from.toISOString(), "2026-08-02T00:00:00.000Z");
});

test("trend compares the last 7 days with the 7 before, today included", () => {
  const rows = [
    v(30), v(24), v(24),          // current 7: 24–30 Sep → 3
    v(23), v(17),                 // previous 7: 17–23 Sep → 2
    v(16),                        // outside both 7-day windows
    dl(29), dl(20), dl(19),       // downloads: 1 now, 2 before
    { occurred_at: day(30), event: "view", entry: false }, // not a visit
    { occurred_at: day(30, 23), event: "enquiry" },
  ];
  const t = trend(rows, T_NOW);
  assert.deepEqual(t.d7.visits, { current: 3, previous: 2, change: 50 });
  assert.deepEqual(t.d7.downloads, { current: 1, previous: 2, change: -50 });
  assert.deepEqual(t.d7.enquiries, { current: 1, previous: 0, change: null });
  assert.equal(t.d30.visits.current, 6);
  assert.equal(t.d30.visits.previous, 0);
});

test("trend ignores rows from the future", () => {
  const t = trend([{ occurred_at: new Date("2026-10-02T10:00:00Z"), event: "download" }], T_NOW);
  assert.equal(t.d7.downloads.current, 0);
});

test("bestCampaign waits for a real campaign with a download", () => {
  assert.equal(bestCampaign([]), null);
  const direct = { raw: { campaign: null }, campaign: "none", visits: 40, downloads: 9, rate: 23 };
  const noDownloads = { raw: { campaign: "spring" }, campaign: "spring", visits: 50, downloads: 0, rate: 0 };
  assert.equal(bestCampaign([direct, noDownloads]), null);
});

test("bestCampaign picks most downloads, then rate, and flags a thin rate", () => {
  const a = { raw: { campaign: "a" }, campaign: "a", visits: 10, downloads: 3, rate: 30 };
  const b = { raw: { campaign: "b" }, campaign: "b", visits: 100, downloads: 3, rate: 3 };
  const c = { raw: { campaign: "c" }, campaign: "c", visits: 200, downloads: 2, rate: 1 };
  const best = bestCampaign([c, b, a]);
  assert.equal(best.campaign, "a");
  assert.equal(best.thin, true);
  assert.equal(bestCampaign([b, c]).thin, false);
});

test("a group reached only by non-entry views is not listed as zeroes", () => {
  const out = aggregate([
    { occurred_at: at(9), event: "view", page: "/", entry: false, source: "x", medium: "y", campaign: "z", click_platform: null },
  ]);
  assert.deepEqual(out.byCampaign, []);
  assert.deepEqual(out.byPlatform, []);
  assert.deepEqual(out.daily, []);
  assert.equal(out.totals.views, 1);
});

/* ── Sign-ups ── */

const signupRows = [
  { occurred_at: new Date("2026-09-29T09:00:00Z"), event: "signup", form: "phone-link", source: "google", medium: "cpc", campaign: "autumn", click_platform: "google" },
  { occurred_at: new Date("2026-09-29T10:00:00Z"), event: "signup", form: "phone-newsletter", source: "google", medium: "cpc", campaign: "autumn", click_platform: "google" },
  { occurred_at: new Date("2026-09-29T11:00:00Z"), event: "signup", form: "download-modal", source: null, medium: null, campaign: null, click_platform: null },
  { occurred_at: new Date("2026-09-29T12:00:00Z"), event: "signup", form: "newsletter", source: null, medium: null, campaign: null, click_platform: null },
];

test("a phone link request is a link; with the box ticked it is a sign-up too", () => {
  const out = aggregate(signupRows);
  assert.equal(out.totals.links, 2);
  assert.equal(out.totals.signups, 3);
  const autumn = out.byCampaign.find((c) => c.campaign === "autumn");
  assert.deepEqual([autumn.links, autumn.signups, autumn.downloads], [2, 1, 0]);
  const direct = out.byCampaign.find((c) => c.source === "direct");
  assert.deepEqual([direct.links, direct.signups], [0, 2]);
});

test("a campaign with only sign-ups still gets a row, a platform and a day", () => {
  const out = aggregate(signupRows.slice(0, 1));
  assert.equal(out.byCampaign.length, 1);
  assert.equal(out.byPlatform.length, 1);
  assert.deepEqual(out.daily, [{ date: "2026-09-29", visits: 0, downloads: 0, enquiries: 0, links: 1, signups: 0 }]);
});

test("growth counts link requests and sign-ups", () => {
  const t = trend(signupRows, new Date("2026-09-29T18:00:00Z"));
  assert.deepEqual(t.d7.links, { current: 2, previous: 0, change: null });
  assert.deepEqual(t.d7.signups, { current: 3, previous: 0, change: null });
});
