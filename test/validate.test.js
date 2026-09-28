import test from "node:test";
import assert from "node:assert/strict";
import { validateEvent, coarsePlatform, normalisePage, isBot } from "../api/_lib/validate.js";

const ROW_KEYS = [
  "event", "asset", "form", "page", "entry", "source", "medium", "campaign",
  "content", "term", "click_platform", "landing_path", "referrer_host",
];

test("accepts a well-formed enquiry and returns the full row shape", () => {
  const result = validateEvent({
    event: "enquiry",
    props: { form: "companies" },
    attr: { source: "google", medium: "cpc", campaign: "autumn" },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(Object.keys(result.row).sort(), [...ROW_KEYS].sort());
  assert.equal(result.row.event, "enquiry");
  assert.equal(result.row.form, "companies");
  assert.equal(result.row.source, "google");
  assert.equal(result.row.asset, null);
});

test("accepts a download with an asset", () => {
  const result = validateEvent({ event: "download", props: { asset: "win" } });
  assert.equal(result.ok, true);
  assert.equal(result.row.asset, "win");
  assert.equal(result.row.form, null);
});

test("rejects an event outside the allowlist", () => {
  for (const bad of ["pageview", "", null, undefined, 1, "DOWNLOAD"]) {
    const result = validateEvent({ event: bad });
    assert.equal(result.ok, false, String(bad));
  }
});

test("rejects a form outside the allowlist", () => {
  const result = validateEvent({
    event: "enquiry",
    props: { form: "newsletter" },
  });
  assert.equal(result.ok, false);
});

test("rejects an asset outside the allowlist", () => {
  const result = validateEvent({
    event: "download",
    props: { asset: "solaris" },
  });
  assert.equal(result.ok, false);
});

test("rejects a body that is not an object", () => {
  for (const bad of [null, undefined, "x", 3, []]) {
    assert.equal(validateEvent(bad).ok, false, String(bad));
  }
});

test("truncates attribution fields and drops unknown ones", () => {
  const result = validateEvent({
    event: "download",
    props: { asset: "win" },
    attr: { campaign: "y".repeat(500), evil: "dropped" },
  });
  assert.equal(result.row.campaign.length, 200);
  assert.equal("evil" in result.row, false);
});

test("accepts a view with its page and entry flag", () => {
  const result = validateEvent({
    event: "view",
    props: { path: "/da/performance", entry: true },
    attr: { source: "google", campaign: "autumn" },
  });
  assert.equal(result.ok, true);
  assert.equal(result.row.page, "/da/performance");
  assert.equal(result.row.entry, true);
  assert.equal(result.row.campaign, "autumn");
});

test("a view's entry must be a real boolean, and only views carry page or entry", () => {
  assert.equal(validateEvent({ event: "view", props: { path: "/", entry: "yes" } }).row.entry, null);
  const dl = validateEvent({ event: "download", props: { asset: "win", path: "/", entry: true } });
  assert.equal(dl.row.page, null);
  assert.equal(dl.row.entry, null);
});

test("normalisePage gives each page one spelling and rejects the rest", () => {
  assert.equal(normalisePage("/"), "/");
  assert.equal(normalisePage("/index.html"), "/");
  assert.equal(normalisePage("/contact.html"), "/contact");
  assert.equal(normalisePage("/contact/"), "/contact");
  assert.equal(normalisePage("/da"), "/da/");
  assert.equal(normalisePage("/da/"), "/da/");
  assert.equal(normalisePage("/da/index.html"), "/da/");
  assert.equal(normalisePage("/fr/license"), "/fr/license");
  assert.equal(normalisePage("/stats"), null);
  assert.equal(normalisePage("/xx/contact"), null);
  assert.equal(normalisePage("/de/nonsense"), null);
  assert.equal(normalisePage("/" + "a".repeat(300)), null);
  assert.equal(normalisePage(null), null);
});

test("isBot catches crawlers and empty agents, not browsers", () => {
  assert.equal(isBot("Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"), true);
  assert.equal(isBot("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/120.0 Safari/537.36"), true);
  assert.equal(isBot(""), true);
  assert.equal(isBot(undefined), true);
  assert.equal(isBot("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36"), false);
  assert.equal(isBot("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"), false);
});

test("coarsePlatform buckets the client hint and never returns anything else", () => {
  assert.equal(coarsePlatform('"macOS"'), "mac");
  assert.equal(coarsePlatform("macOS"), "mac");
  assert.equal(coarsePlatform('"Windows"'), "windows");
  assert.equal(coarsePlatform('"Linux"'), "linux");
  assert.equal(coarsePlatform('"Android"'), "other");
  assert.equal(coarsePlatform(""), "other");
  assert.equal(coarsePlatform(null), "other");
  assert.equal(coarsePlatform(undefined), "other");
});
