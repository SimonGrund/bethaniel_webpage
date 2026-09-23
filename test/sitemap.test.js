import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { buildSitemap } = require("../tools/i18n/sitemap.cjs");

test("lists every page in every language", () => {
  const xml = buildSitemap();
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  assert.equal(locs.length, 30);
  assert.ok(locs.includes("https://www.bethaniel.eu/"));
  assert.ok(locs.includes("https://www.bethaniel.eu/de/how-it-works"));
  assert.ok(locs.includes("https://www.bethaniel.eu/fr/blog"));
});

test("every url is absolute on the www host", () => {
  const locs = [...buildSitemap().matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  assert.ok(locs.every((u) => u.startsWith("https://www.bethaniel.eu/")), "all on www");
});

test("the internal dashboard is not listed", () => {
  assert.equal(buildSitemap().includes("/stats"), false);
});

test("each entry carries hreflang alternates", () => {
  const xml = buildSitemap();
  assert.ok(xml.includes('xmlns:xhtml="http://www.w3.org/1999/xhtml"'));
  assert.equal([...xml.matchAll(/hreflang="x-default"/g)].length, 30);
});

test("the xml parses", () => {
  const xml = buildSitemap();
  assert.doesNotThrow(() => {
    if (!/^<\?xml/.test(xml)) throw new Error("no declaration");
    const opens = (xml.match(/<url>/g) || []).length;
    const closes = (xml.match(/<\/url>/g) || []).length;
    if (opens !== closes) throw new Error("unbalanced <url>");
  });
});
