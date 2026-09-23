import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/* i18n.js is a browser IIFE, so the pure decision function is lifted out of
   the source and evaluated on its own. */
const src = readFileSync(new URL("../i18n.js", import.meta.url), "utf8");
/* Slice from the LANGS declaration so the function's dependency comes with
   it, and stop at the marker that follows the function. */
const body = src.slice(src.indexOf("var LANGS"), src.indexOf("// end chooseLang"));
const chooseLang = new Function(`${body}; return chooseLang;`)();

test("a stored choice wins", () => {
  assert.equal(chooseLang("de", "fr-FR", "/"), "de");
  assert.equal(chooseLang("en", "de-DE", "/"), "en");
});

test("browser language is used when nothing is stored", () => {
  assert.equal(chooseLang(null, "de-DE", "/"), "de");
  assert.equal(chooseLang(null, "da", "/"), "da");
});

test("an unknown browser language falls back to English", () => {
  assert.equal(chooseLang(null, "ja-JP", "/"), "en");
  assert.equal(chooseLang(null, "", "/"), "en");
  assert.equal(chooseLang(null, null, "/"), "en");
});

test("an unknown stored value is ignored rather than trusted", () => {
  assert.equal(chooseLang("klingon", "de-DE", "/"), "de");
});

test("a path that already carries a language never redirects", () => {
  for (const p of ["/de/", "/de/how-it-works", "/da/", "/fr/blog", "/es/contact"]) {
    assert.equal(chooseLang(null, "de-DE", p), null, p);
  }
});

test("a non-root English path never redirects", () => {
  assert.equal(chooseLang(null, "de-DE", "/how-it-works"), null);
  assert.equal(chooseLang(null, "de-DE", "/stats"), null);
});

test("English at the root means stay put", () => {
  assert.equal(chooseLang(null, "en-GB", "/"), "en");
});
