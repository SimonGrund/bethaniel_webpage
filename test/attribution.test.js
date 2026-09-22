import test from "node:test";
import assert from "node:assert/strict";
import {
  parseAttribution,
  encodeAttribution,
  decodeAttribution,
  truncate,
} from "../api/_lib/attribution.js";

test("truncate caps at 200 characters and passes through null", () => {
  assert.equal(truncate("a".repeat(250)).length, 200);
  assert.equal(truncate("short"), "short");
  assert.equal(truncate(null), null);
  assert.equal(truncate(undefined), null);
  assert.equal(truncate(123), null);
});

test("parses utm params into the stored shape", () => {
  const attr = parseAttribution(
    "?utm_source=google&utm_medium=cpc&utm_campaign=autumn",
    "https://www.google.com/search?q=x",
    "/",
  );
  assert.equal(attr.source, "google");
  assert.equal(attr.medium, "cpc");
  assert.equal(attr.campaign, "autumn");
  assert.equal(attr.content, null);
  assert.equal(attr.term, null);
  assert.equal(attr.landing_path, "/");
  assert.equal(attr.referrer_host, "www.google.com");
});

test("recognises each platform's click id", () => {
  const cases = [
    ["gclid", "google"],
    ["fbclid", "meta"],
    ["rdt_cid", "reddit"],
    ["li_fat_id", "linkedin"],
    ["twclid", "x"],
    ["msclkid", "microsoft"],
  ];
  for (const [param, platform] of cases) {
    const attr = parseAttribution(`?${param}=abc123`, "", "/");
    assert.equal(attr.click_id, "abc123", param);
    assert.equal(attr.click_platform, platform, param);
  }
});

test("returns null when there is nothing to attribute", () => {
  assert.equal(parseAttribution("", "", "/"), null);
  assert.equal(parseAttribution("?foo=bar", "https://example.com", "/"), null);
});

test("truncates every field it stores", () => {
  const attr = parseAttribution(`?utm_campaign=${"x".repeat(400)}`, "", "/");
  assert.equal(attr.campaign.length, 200);
});

test("a malformed referrer does not throw", () => {
  const attr = parseAttribution("?utm_source=google", "not a url", "/");
  assert.equal(attr.referrer_host, null);
});

test("encode and decode round-trip", () => {
  const attr = parseAttribution("?utm_source=meta&utm_medium=paid", "", "/");
  assert.deepEqual(decodeAttribution(encodeAttribution(attr)), attr);
});

test("decode returns null rather than throwing on junk", () => {
  for (const junk of ["", "!!!!", "eyJhIjo", null, undefined, "bnVsbA"]) {
    assert.equal(decodeAttribution(junk), null, String(junk));
  }
});
