import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const D = require("../tools/i18n/dom-i18n.cjs");
const { parseHTML } = require("linkedom");

function body(html) {
  return parseHTML(`<!doctype html><html><body>${html}</body></html>`).document.body;
}

test("norm collapses whitespace", () => {
  assert.equal(D.norm("  a \n  b  "), "a b");
});

test("units finds block elements with text", () => {
  const u = D.units(body("<p>Hello</p><h2>World</h2>"));
  assert.equal(u.length, 2);
  assert.deepEqual(u.map(D.unitKey), ["Hello", "World"]);
});

test("units treats an inline-only block as one unit, not several", () => {
  const u = D.units(body('<p>Got a Mac? <a href="/x">Download</a></p>'));
  assert.equal(u.length, 1);
  assert.equal(D.unitKey(u[0]), 'Got a Mac? <a href="/x">Download</a>');
});

test("units picks up a bare text node beside an icon", () => {
  const u = D.units(body('<a href="/d"><svg></svg>Download for macOS</a>'));
  assert.deepEqual(u.map(D.unitKey), ["Download for macOS"]);
});

test("units skips script, style, svg and data-i18n=skip", () => {
  const u = D.units(body(
    '<script>var a="x"</script><style>p{}</style>' +
    '<div data-i18n="skip"><p>Leave me</p></div><p>Take me</p>'
  ));
  assert.deepEqual(u.map(D.unitKey), ["Take me"]);
});

test("applyDict replaces matched units and reports misses", () => {
  const root = body("<p>Hello</p><p>Unknown</p>");
  const r = D.applyDict(root, { Hello: "Hej" });
  assert.equal(r.applied, 1);
  assert.equal(root.querySelectorAll("p")[0].innerHTML, "Hej");
  assert.equal(root.querySelectorAll("p")[1].innerHTML, "Unknown");
  assert.deepEqual(r.missed, []);
});

test("applyDict reports dictionary entries that matched nothing", () => {
  const root = body("<p>Hello</p>");
  const r = D.applyDict(root, { Hello: "Hej", "Not on the page": "Nej" });
  assert.equal(r.applied, 1);
  assert.deepEqual(r.missed, ["Not on the page"]);
});

test("a translated text node keeps the whitespace around it", () => {
  const root = body('<a href="/d"><svg></svg>\n  Download\n</a>');
  D.applyDict(root, { Download: "Hent" });
  /* Assert on the text node itself rather than the serialised innerHTML:
     how the parser writes an empty <svg> is its business, but the spacing
     around the label is ours — without it the text would butt against the
     icon. */
  const textNode = [...root.querySelector("a").childNodes].find((n) => n.nodeType === 3);
  assert.equal(textNode.nodeValue, " Hent ");
});

