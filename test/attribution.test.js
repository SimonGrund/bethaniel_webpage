import test from "node:test";
import assert from "node:assert/strict";
import { decodeAttribution, truncate } from "../api/_lib/attribution.js";

/* decodeAttribution is the only caller-facing encoder/decoder left — the
   browser has its own base64url encoder (js/campaign.js), so tests build
   input the same way rather than relying on a server-side encode function. */
function encode(obj) {
  return Buffer.from(JSON.stringify(obj), "utf8").toString("base64url");
}

test("truncate caps at 200 characters and passes through null", () => {
  assert.equal(truncate("a".repeat(250)).length, 200);
  assert.equal(truncate("short"), "short");
  assert.equal(truncate(null), null);
  assert.equal(truncate(undefined), null);
  assert.equal(truncate(123), null);
});

test("decode returns null rather than throwing on junk", () => {
  for (const junk of ["", "!!!!", "eyJhIjo", null, undefined, "bnVsbA"]) {
    assert.equal(decodeAttribution(junk), null, String(junk));
  }
});

test("decodeAttribution enforces shape and truncates overlong fields", () => {
  /* unknown_key stands in for any field decodeAttribution doesn't allowlist —
     including a per-click visitor id an attacker might try to smuggle back
     in through the query string. It is dropped exactly like this one. */
  const malicious = {
    source: "google",
    campaign: "x".repeat(300),
    unknown_key: "should be dropped",
  };
  const decoded = decodeAttribution(encode(malicious));

  assert.equal(decoded.campaign.length, 200);
  assert.equal(decoded.unknown_key, undefined);
  assert.equal(decoded.source, "google");
  assert.deepEqual(Object.keys(decoded).sort(), [
    "campaign", "content", "landing_path", "medium",
    "click_platform", "referrer_host", "source", "term",
  ].sort());
});
