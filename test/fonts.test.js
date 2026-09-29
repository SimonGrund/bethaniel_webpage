import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

/* Every page loads the same Bunny Fonts URL. Two things went wrong before
   this test: pages drifted onto different font hosts, and a URL that
   repeated `&family=` quietly returned only the first family, so Inter
   never loaded. */
const PAGES = [
  ...readdirSync(".").filter((f) => f.endsWith(".html")),
  ...readdirSync("admin").filter((f) => f.endsWith(".html")).map((f) => `admin/${f}`),
  "api/newsletter.js",
];

function fontUrls(file) {
  return [...readFileSync(file, "utf8").matchAll(/https:\/\/fonts\.[a-z.]+\/css[^"'\s]*/g)].map((m) => m[0]);
}

test("every page loads exactly one font stylesheet, and the same one", () => {
  const urls = new Set();
  for (const page of PAGES) {
    const found = fontUrls(page);
    assert.equal(found.length, 1, `${page} loads ${found.length} font stylesheets`);
    urls.add(found[0]);
  }
  assert.equal(urls.size, 1, `pages disagree: ${[...urls].join(" / ")}`);
});

test("the font URL asks for every family in one parameter", () => {
  const url = fontUrls("index.html")[0];
  assert.match(url, /^https:\/\/fonts\.bunny\.net\//);
  assert.doesNotMatch(url, /&family=/, "a second &family= is ignored by Bunny Fonts");
  for (const family of ["cormorant-garamond", "inter", "jetbrains-mono"]) assert.ok(url.includes(family), family);
});

test("no page loads anything from Google Fonts", () => {
  for (const page of PAGES) assert.doesNotMatch(readFileSync(page, "utf8"), /fonts\.(googleapis|gstatic)\.com/, page);
});
