import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const L = require("../tools/i18n/links.cjs");

test("page paths use a bare root for index", () => {
  assert.equal(L.pagePath("index"), "/");
  assert.equal(L.pagePath("how-it-works"), "/how-it-works");
});

test("language paths prefix everything but English", () => {
  assert.equal(L.langPath("index", "en"), "/");
  assert.equal(L.langPath("index", "de"), "/de/");
  assert.equal(L.langPath("how-it-works", "en"), "/how-it-works");
  assert.equal(L.langPath("how-it-works", "de"), "/de/how-it-works");
});

test("absolute urls are always on the www host", () => {
  assert.equal(L.absUrl("index", "en"), "https://www.bethaniel.eu/");
  assert.equal(L.absUrl("blog", "fr"), "https://www.bethaniel.eu/fr/blog");
});

test("api, stats, external, anchor and mail links are not internal", () => {
  for (const href of [
    "/api/download?asset=win", "/api/event", "/stats",
    "https://github.com/x", "http://example.com", "//cdn.example.com",
    "#top", "mailto:simon@bethaniel.eu", "tel:+4512345678",
  ]) {
    assert.equal(L.isInternal(href), false, href);
  }
});

test("real page links are internal", () => {
  for (const href of ["/", "/how-it-works", "/blog", "contact.html", "/contact"]) {
    assert.equal(L.isInternal(href), true, href);
  }
});

test("rewriting prefixes internal links and leaves the rest alone", () => {
  assert.equal(L.rewriteHref("/how-it-works", "de"), "/de/how-it-works");
  assert.equal(L.rewriteHref("/", "de"), "/de/");
  assert.equal(L.rewriteHref("/api/download?asset=win", "de"), "/api/download?asset=win");
  assert.equal(L.rewriteHref("/stats", "de"), "/stats");
  assert.equal(L.rewriteHref("https://github.com/x", "de"), "https://github.com/x");
  assert.equal(L.rewriteHref("#top", "de"), "#top");
});

test("English rewriting is a no-op", () => {
  assert.equal(L.rewriteHref("/how-it-works", "en"), "/how-it-works");
});

test("an already-prefixed link is not prefixed twice", () => {
  assert.equal(L.rewriteHref("/de/how-it-works", "de"), "/de/how-it-works");
  assert.equal(L.rewriteHref("/de/", "de"), "/de/");
});

test("a .html link is normalised to the cleanUrls form", () => {
  assert.equal(L.rewriteHref("contact.html", "de"), "/de/contact");
  assert.equal(L.rewriteHref("/blog.html", "de"), "/de/blog");
});

test("alternates cover five languages plus x-default", () => {
  const a = L.alternates("blog");
  assert.equal(a.length, 6);
  assert.deepEqual(a.map((x) => x.hreflang), ["en", "da", "de", "es", "fr", "x-default"]);
  assert.equal(a[0].href, "https://www.bethaniel.eu/blog");
  assert.equal(a[2].href, "https://www.bethaniel.eu/de/blog");
  assert.equal(a[5].href, "https://www.bethaniel.eu/blog");
});
