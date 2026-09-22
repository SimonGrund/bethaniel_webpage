import test from "node:test";
import assert from "node:assert/strict";
import { validateEvent, coarsePlatform } from "../api/_lib/validate.js";

const ROW_KEYS = [
  "event", "asset", "form", "source", "medium", "campaign", "content",
  "term", "click_id", "click_platform", "landing_path", "referrer_host",
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
