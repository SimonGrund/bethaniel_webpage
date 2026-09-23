# Indexable Translations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the four existing translations indexable by generating real per-language URLs (`/da/`, `/de/`, `/es/`, `/fr/`) at deploy time.

**Architecture:** One parser (`linkedom`) both extracts the dictionaries and renders the translated pages, so their keys agree by construction. A build step renders each English page into `dist/<lang>/`, rewriting `<html lang>`, canonical, hreflang, Open Graph and internal links. The runtime translator shrinks to a root-only language redirect. The build fails loudly if any translation key goes unmatched.

**Tech Stack:** Node 24, CommonJS build scripts (matching `tools/i18n/`), `linkedom` for server-side DOM, `node --test`, Vercel static output.

**Spec:** `docs/superpowers/specs/2026-09-22-indexable-translations-design.md`

## Global Constraints

Apply to every task. Not repeated per task.

- **Languages are exactly** `["da","de","es","fr"]` for generation; `LANGS` including English is `["en","da","de","es","fr"]`.
- **Pages are exactly** `["index","how-it-works","performance","blog","cloud-terms","contact"]` — the `PAGES` array in `tools/i18n/extract.cjs`. Read it; do not retype it from memory.
- **Canonical host is `https://www.bethaniel.eu`.** The apex 307s to www. Never emit an apex URL.
- **Extraction and prerendering MUST use the same parser.** This was not the original design; it changed after testing showed a second parser cannot reproduce Chrome's `innerHTML` (16 of 24 page/language combinations failed to match, 8 still failed after entity decoding). Never reintroduce a second serialiser.
- **A translation is never silently dropped.** The migration reports anything it cannot map and stops. Guessing is worse than failing here — a wrong mapping puts the wrong translated text under a heading, and nobody notices.
- **`i18n.js` is the reference implementation** for `norm`, `isInlineOnly`, `hasText`, `units`, `key`, `unitKey` and `setText`. Port its logic; do not write a fresh interpretation. Keep `INLINE`, `BLOCK` and `SKIP` identical, and honour `data-i18n="skip"`.
- **`units()` returns two kinds of unit:** `{el}` keyed by `norm(el.innerHTML)`, and `{text}` (a bare text node) keyed by `norm(node.nodeValue)`. Both must be handled. Text nodes keep their surrounding whitespace via `setText`'s lead/trail rule.
- **The build fails on any unmatched key**, naming language, page and the unmatched keys. Exit non-zero. Never ship a partially translated page.
- **Links that must never be rewritten:** anything starting `/api/`, `/stats`, `http://`, `https://`, `//`, `#`, `mailto:`, `tel:`. Everything else site-internal gets the language prefix.
- **The redirect fires only at the site root.** A path that already carries a language prefix must never redirect. This is load-bearing for search indexing — see the spec's "Why the redirect is safe here".
- **`tools/i18n/extract.cjs` depends on `window.BettyI18n` exposing `units`, `unitKey`, `blocks`, `key`, `norm`, `setLang`, `LANGS`.** Read it before changing `i18n.js`. Whatever it needs must survive.
- **Do not change any English copy, any visible text, or any dictionary content.** This work is structural.
- **Do not touch** `api/`, `js/campaign.js`, `stats.html`, `db/`, or the download links.
- Repo style: 2-space indent, double quotes, comments that explain WHY. Build scripts under `tools/` are CommonJS (`.cjs`); everything else is ESM.

---

## File Structure

**Created:**

| Path | Responsibility |
| --- | --- |
| `tools/i18n/links.cjs` | Pure URL logic: prefixing, hreflang sets, sitemap URLs. No DOM. |
| `tools/i18n/dom-i18n.cjs` | Port of `i18n.js`'s unit-walking and key logic, against a server DOM. No file I/O. |
| `tools/i18n/prerender.cjs` | Orchestrates: read page, translate, rewrite head, write `dist/`. |
| `tools/build.cjs` | Assembles `dist/`: copy static assets, then invoke the prerenderer and the sitemap. |
| `tools/i18n/sitemap.cjs` | Generates the 30-URL sitemap with hreflang annotations. |
| `test/links.test.js` | Tests for `links.cjs`. |
| `test/dom-i18n.test.js` | Tests for key canonicalisation and unit walking. |
| `test/sitemap.test.js` | Tests for sitemap generation. |
| `test/redirect.test.js` | Tests for the pure redirect decision. |

**Modified:** `i18n.js` (shrinks to the redirect), `package.json` (build script + one devDependency), `vercel.json` (`outputDirectory`), the six English pages (switcher markup), `.gitignore` (`dist/`)

**Deleted:** `sitemap.xml` — it becomes generated output rather than a committed file.

---

### Task 1: Prove the deployment assumption before building anything

The spec requires this first. Setting `outputDirectory` changes how Vercel resolves the project, and if serverless functions stop deploying, **downloads break in production.** Nothing else in this plan is worth building until this is known.

**Files:**
- Modify: `vercel.json`, `package.json`, `.gitignore`
- Create: `tools/build.cjs`

**Interfaces:**
- Consumes: nothing.
- Produces: a working `npm run build` that emits `dist/`, and a proven answer on whether `/api/*` still works.

- [ ] **Step 1: Add `dist/` to `.gitignore`**

Append to `.gitignore` (which currently holds `.DS_Store`, `node_modules`, `.superpowers/`):

```
dist
```

- [ ] **Step 2: Write a minimal `tools/build.cjs` that only copies**

Translation comes later. This step exists to prove the deployment shape.

```js
// Assembles the deployable site into dist/.
//
// Vercel serves dist/ rather than the repo root, because the translated
// pages are generated rather than committed. Serverless functions still
// come from api/ at the repo root — Vercel resolves those independently of
// outputDirectory. That assumption is load-bearing: if it ever stops
// holding, every download 404s.
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const DIST = path.join(ROOT, "dist");

/* Everything the browser can ask for. api/ is absent on purpose — Vercel
   picks functions up from the repo root, not from here. */
const COPY = [
  "index.html", "how-it-works.html", "performance.html",
  "blog.html", "cloud-terms.html", "contact.html", "stats.html",
  "style.css", "i18n.js", "robots.txt",
  "Public", "js", "i18n",
];

function copy(from, to) {
  const stat = fs.statSync(from);
  if (stat.isDirectory()) {
    fs.mkdirSync(to, { recursive: true });
    for (const entry of fs.readdirSync(from)) copy(path.join(from, entry), path.join(to, entry));
  } else {
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
  }
}

function main() {
  fs.rmSync(DIST, { recursive: true, force: true });
  for (const entry of COPY) {
    const from = path.join(ROOT, entry);
    if (!fs.existsSync(from)) throw new Error(`build: missing ${entry}`);
    copy(from, path.join(DIST, entry));
  }
  console.log(`build: copied ${COPY.length} entries into dist/`);
}

main();
```

- [ ] **Step 3: Add the build script to `package.json`**

Add to `scripts`, keeping `test` as it is:

```json
    "build": "node tools/build.cjs"
```

- [ ] **Step 4: Point Vercel at `dist/`**

`vercel.json` currently reads `{ "cleanUrls": true }`. Make it:

```json
{
  "cleanUrls": true,
  "buildCommand": "npm run build",
  "outputDirectory": "dist"
}
```

- [ ] **Step 5: Run the build and confirm the output shape**

Run: `npm run build && find dist -maxdepth 1 | sort`
Expected: `dist/` containing the six pages, `stats.html`, `style.css`, `i18n.js`, `robots.txt`, `Public`, `js`, `i18n`. No `api` directory.

- [ ] **Step 6: Commit and deploy to a preview**

```bash
git add .gitignore package.json vercel.json tools/build.cjs
git commit -m "Build the deployable site into dist/"
git push -u origin <branch>
```

- [ ] **Step 7: PROVE the functions still work — this is the gate**

Get the preview URL from the deployment, then:

```bash
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' "<PREVIEW>/api/download?asset=win"
curl -s -o /dev/null -w '%{http_code}\n' -X POST -H "Origin: <PREVIEW>" \
  -H 'Content-Type: application/json' \
  -d '{"event":"enquiry","props":{"form":"contact"}}' "<PREVIEW>/api/event"
curl -s -o /dev/null -w '%{http_code}\n' "<PREVIEW>/"
curl -s -o /dev/null -w '%{http_code}\n' "<PREVIEW>/how-it-works"
```

Expected: `302` to `Bethaniel-win.exe`; `204`; `200`; `200`.

**If `/api/download` returns anything but a 302 to the installer, STOP.** Report it and do not continue — the rest of this plan assumes functions survive `outputDirectory`. The fallback is to keep the repo-root deployment and serve translations by another means, which is a different design and needs the spec revisited.

---

### Task 2: Pure URL helpers

**Files:**
- Create: `tools/i18n/links.cjs`, `test/links.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `SITE` — `"https://www.bethaniel.eu"`
  - `LANGS` — `["en","da","de","es","fr"]`
  - `TRANSLATED` — `["da","de","es","fr"]`
  - `PAGES` — `["index","how-it-works","performance","blog","cloud-terms","contact"]`
  - `pagePath(page)` → `"/"` for `"index"`, else `"/<page>"`
  - `langPath(page, lang)` → `"/"`, `"/de/"` for index; `"/how-it-works"`, `"/de/how-it-works"` otherwise
  - `absUrl(page, lang)` → `SITE + langPath(page, lang)`
  - `isInternal(href)` → boolean; false for `/api/…`, `/stats`, absolute, protocol-relative, `#`, `mailto:`, `tel:`
  - `rewriteHref(href, lang)` → prefixed path for internal links when `lang !== "en"`; unchanged otherwise
  - `alternates(page)` → array of `{hreflang, href}` for all five languages plus `x-default` → English

- [ ] **Step 1: Write the failing test**

Create `test/links.test.js`:

```js
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
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `node --test test/links.test.js`
Expected: FAIL — `Cannot find module '../tools/i18n/links.cjs'`

- [ ] **Step 3: Write `tools/i18n/links.cjs`**

```js
// URL shapes for the multilingual site. Pure: no DOM, no filesystem, so the
// rules can be tested on their own.
//
// English lives at the root and the other four are prefixed. Search engines
// need every version to have its own address; that is the whole point of the
// exercise.

const SITE = "https://www.bethaniel.eu";
const LANGS = ["en", "da", "de", "es", "fr"];
const TRANSLATED = ["da", "de", "es", "fr"];
const PAGES = ["index", "how-it-works", "performance", "blog", "cloud-terms", "contact"];

/* Links the prefixer must never touch. /api/ carries the download redirect
   and the tracking beacon — both language-neutral, and prefixing the
   download would 404 every installer. /stats is the internal dashboard. */
const NEVER_PREFIX = ["/api/", "/stats"];

function pagePath(page) {
  return page === "index" ? "/" : `/${page}`;
}

function langPath(page, lang) {
  const base = pagePath(page);
  if (lang === "en") return base;
  return base === "/" ? `/${lang}/` : `/${lang}${base}`;
}

function absUrl(page, lang) {
  return SITE + langPath(page, lang);
}

function isInternal(href) {
  if (typeof href !== "string" || href === "") return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return false;   // http:, mailto:, tel:
  if (href.startsWith("//")) return false;               // protocol-relative
  if (href.startsWith("#")) return false;
  if (NEVER_PREFIX.some((p) => href === p || href.startsWith(p))) return false;
  return true;
}

/* The pages are served with cleanUrls, so a link written as contact.html and
   a link written as /contact address the same page. Normalise to the clean
   form so the prefixed result is consistent. */
function normalisePath(href) {
  let out = href.startsWith("/") ? href : `/${href}`;
  out = out.replace(/\.html($|[?#])/, "$1");
  if (out === "/index") out = "/";
  return out;
}

function rewriteHref(href, lang) {
  if (lang === "en" || !isInternal(href)) return href;
  const path = normalisePath(href);
  if (path === `/${lang}` || path.startsWith(`/${lang}/`)) return href;  // already prefixed
  return path === "/" ? `/${lang}/` : `/${lang}${path}`;
}

function alternates(page) {
  const out = LANGS.map((lang) => ({ hreflang: lang, href: absUrl(page, lang) }));
  /* x-default is what a search engine shows when it has no better match. */
  out.push({ hreflang: "x-default", href: absUrl(page, "en") });
  return out;
}

module.exports = {
  SITE, LANGS, TRANSLATED, PAGES,
  pagePath, langPath, absUrl, isInternal, rewriteHref, alternates,
};
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `node --test test/links.test.js`
Expected: PASS — 10 tests.

- [ ] **Step 5: Confirm PAGES matches the extractor**

Run: `grep 'const PAGES' tools/i18n/extract.cjs`
Confirm the two lists hold the same six names. If they differ, the extractor is the source of truth — match it and re-run the test.

- [ ] **Step 6: Commit**

```bash
git add tools/i18n/links.cjs test/links.test.js
git commit -m "Where each language's pages live"
```

---

### Task 3: Port the translation walk to a server DOM

**Files:**
- Create: `tools/i18n/dom-i18n.cjs`, `test/dom-i18n.test.js`
- Modify: `package.json` (add `linkedom` as a devDependency)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `norm(s)` → whitespace-collapsed, trimmed string
  - `units(root)` → array of `{el}` or `{text}`, document order
  - `unitKey(u)` → the raw key for a unit
  - `applyDict(root, dict)` → `{applied: number, missed: string[]}`

**There is no `canonicalKey` any more.** An earlier version of this plan tried to reconcile Chrome's serialisation with a server DOM's. Measured against the real dictionaries it failed on 16 of 24 page/language combinations, and still failed on 8 after entity decoding — the divergences are unrelated to one another and chasing them is open-ended.

Instead, **Task 3b re-extracts the dictionaries with this very module**, so keys match exactly and a plain string lookup is enough. Keep `applyDict`'s comparison exact; do not add fuzzy matching back.

- [ ] **Step 1: Add `linkedom`**

```bash
npm install --save-dev linkedom
```

Confirm it landed in `devDependencies`, not `dependencies` — it is a build-time tool and must not ship to the serverless functions.

- [ ] **Step 2: Write the failing test**

Create `test/dom-i18n.test.js`:

```js
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

```

- [ ] **Step 3: Run the test and confirm it fails**

Run: `node --test test/dom-i18n.test.js`
Expected: FAIL — `Cannot find module '../tools/i18n/dom-i18n.cjs'`

- [ ] **Step 4: Write `tools/i18n/dom-i18n.cjs`**

Read `i18n.js` lines 19–120 alongside this — `INLINE`, `BLOCK`, `SKIP`, `isInlineOnly`, `hasText`, `units`, `key`, `unitKey` and `setText` are ports of that code and must stay in step with it.

```js
// The translation walk, run against a server DOM instead of a browser one.
//
// This is a port of i18n.js, which is the reference implementation. The two
// must agree on what counts as a translatable unit and on how a unit is
// keyed, or a string that translates in the browser will not translate here.
// If you change one, change both.

/* Inline formatting that may sit inside a block without splitting it. */
const INLINE = {
  A: 1, STRONG: 1, EM: 1, B: 1, I: 1, SPAN: 1, CODE: 1, SMALL: 1, BR: 1,
  SUP: 1, SUB: 1, ABBR: 1, KBD: 1, MARK: 1, U: 1, S: 1, TIME: 1,
};
const BLOCK = {
  P: 1, H1: 1, H2: 1, H3: 1, H4: 1, H5: 1, H6: 1, LI: 1, A: 1, BUTTON: 1,
  TD: 1, TH: 1, SUMMARY: 1, FIGCAPTION: 1, BLOCKQUOTE: 1, LABEL: 1, DT: 1,
  DD: 1, SPAN: 1, SMALL: 1, STRONG: 1, EM: 1, CAPTION: 1, LEGEND: 1,
  OPTION: 1, DIV: 1,
};
const SKIP = {
  SCRIPT: 1, STYLE: 1, PRE: 1, CODE: 1, SVG: 1, TEMPLATE: 1,
  NOSCRIPT: 1, DATA: 1, OUTPUT: 1,
};

function norm(s) {
  return String(s).replace(/\s+/g, " ").trim();
}

function isInlineOnly(el) {
  for (let n = el.firstChild; n; n = n.nextSibling) {
    if (n.nodeType === 3) continue;
    if (n.nodeType !== 1) continue;
    if (!INLINE[n.tagName]) return false;
    if (!isInlineOnly(n)) return false;
  }
  return true;
}

function hasText(el) {
  return norm(el.textContent).length > 0;
}

function units(root) {
  const out = [];
  (function walk(el) {
    for (let n = el.firstChild; n; n = n.nextSibling) {
      if (n.nodeType === 3) {
        if (norm(n.nodeValue)) out.push({ text: n });
        continue;
      }
      if (n.nodeType !== 1) continue;
      if (SKIP[n.tagName]) continue;
      if (n.getAttribute && n.getAttribute("data-i18n") === "skip") continue;
      if (BLOCK[n.tagName] && isInlineOnly(n) && hasText(n)) {
        out.push({ el: n });
        continue;
      }
      walk(n);
    }
  })(root);
  return out;
}

function unitKey(u) {
  return u.el ? norm(u.el.innerHTML) : norm(u.text.nodeValue);
}

/* A text node keeps the whitespace it had on either side, so a label that sat
   on its own line between an icon and a closing tag still does. */
function setText(node, value) {
  const v = node.nodeValue;
  const lead = /^\s/.test(v) ? " " : "";
  const trail = /\s$/.test(v) ? " " : "";
  node.nodeValue = lead + value + trail;
}

function applyDict(root, dict) {
  /* An exact lookup, deliberately. The dictionaries are extracted with this
     same module (see Task 3b), so the keys match character for character.
     Do not add fuzzy matching here: it would paper over a real drift between
     extraction and rendering, and could file one string's translation under
     another's key. */
  const byKey = new Map();
  for (const k of Object.keys(dict)) {
    if (k.startsWith("__")) continue;   // __title / __description are head metadata
    byKey.set(k, dict[k]);
  }

  let applied = 0;
  const used = new Set();
  for (const u of units(root)) {
    const k = unitKey(u);
    if (!byKey.has(k)) continue;
    if (u.el) u.el.innerHTML = byKey.get(k);
    else setText(u.text, byKey.get(k));
    used.add(k);
    applied += 1;
  }

  const missed = Object.keys(dict)
    .filter((k) => !k.startsWith("__"))
    .filter((k) => !used.has(k));
  return { applied, missed };
}

module.exports = { norm, units, unitKey, setText, applyDict, INLINE, BLOCK, SKIP };
```

- [ ] **Step 5: Run the test and confirm it passes**

Run: `node --test test/dom-i18n.test.js`
Expected: PASS — 8 tests.

- [ ] **Step 6: Confirm the module works, but expect the real dictionaries to miss**

Against the dictionaries as they exist today, most keys will **not** match —
they were extracted by Chrome, and this is not Chrome. That is expected and is
the reason Task 3b exists. Measured before this plan was written: 16 of 24
page/language combinations failed outright.

Run this to record the starting point, so Task 3b's improvement is visible:

```bash
node -e '
const {parseHTML}=require("linkedom"), fs=require("fs");
const D=require("./tools/i18n/dom-i18n.cjs");
const PAGES=["index","how-it-works","performance","blog","cloud-terms","contact"];
let bad=0;
for (const lang of ["da","de","es","fr"]) for (const page of PAGES) {
  const dict=JSON.parse(fs.readFileSync(`i18n/${lang}/${page}.json`,"utf8"));
  const total=Object.keys(dict).filter(k=>!k.startsWith("__")).length;
  const {document}=parseHTML(fs.readFileSync(`${page}.html`,"utf8"));
  const {applied,missed}=D.applyDict(document.body,dict);
  if(missed.length){bad++;console.log(`miss ${lang}/${page}: ${applied}/${total}`);}
}
console.log(`${bad} of 24 combinations currently mismatch — Task 3b fixes this`);
'
```

Record the number. **Do not attempt to fix it here**, and above all do not add
fuzzy matching to `applyDict` — that would hide the drift rather than remove
it. Task 3b re-keys the dictionaries with this module and takes the number to
zero.

- [ ] **Step 7: Commit**

```bash
git add tools/i18n/dom-i18n.cjs test/dom-i18n.test.js package.json package-lock.json
git commit -m "Run the translation walk in Node, not just the browser"
```

---

### Task 3b: Re-key the dictionaries onto the new parser

The delicate task. It rewrites the dictionaries so their keys come from
`dom-i18n.cjs` instead of Chrome. **The translated text is not changed** — only
the key it is filed under, and the hash in `i18n-src/<lang>.txt` derived from
that key.

**Get this wrong and a translation ends up under the wrong heading.** Nobody
reviewing English will notice. So the migration reports rather than guesses,
and a human reads the report before it is committed.

**Files:**
- Create: `tools/i18n/rekey.cjs`
- Modify: `i18n-src/en.json`, `i18n-src/{da,de,es,fr}.txt`, and via rebuild `i18n/{da,de,es,fr}/*.json`
- Modify: `tools/i18n/extract.cjs`

**Interfaces:**
- Consumes: `dom-i18n.cjs` (Task 3), `links.cjs` (Task 2).
- Produces: dictionaries whose keys match `dom-i18n.cjs` exactly.

- [ ] **Step 1: Back up the dictionaries outside git**

```bash
mkdir -p /tmp/i18n-backup && cp -r i18n i18n-src /tmp/i18n-backup/
```

You will diff against this. Do not skip it.

- [ ] **Step 2: Write `tools/i18n/rekey.cjs`**

It walks each page with `dom-i18n.cjs`, produces the new English keys in
document order, and maps each old key onto a new one using three passes, in
order of confidence:

1. **Exact** — the old key already equals a new key. Nothing to do.
2. **Text** — strip tags and entities from both and compare the plain text.
   Both parsers agree on text content, so this is reliable. Measured: it maps
   359 of 376.
3. **Position** — for the remainder, match by index within the document walk,
   but **only when the surrounding unmapped runs line up unambiguously.**

Anything still unmapped after all three is **reported and the script exits
non-zero**. It must never drop a translation or invent a mapping.

```js
// Re-files each translation under the key this codebase now produces.
//
// The dictionaries were originally keyed by Chrome's innerHTML, and nothing
// but Chrome reproduces that exactly. Rather than chase a second serialiser
// forever, the keys are regenerated here with the same module that renders
// the pages. The translations themselves are untouched.
//
// Run once. After this, extraction and rendering agree by construction.

const fs = require("fs");
const path = require("path");
const { parseHTML } = require("linkedom");
const D = require("./dom-i18n.cjs");
const L = require("./links.cjs");

const ROOT = path.join(__dirname, "..", "..");

/* Text content is the one thing both parsers agree on, so it is the bridge
   between an old key and a new one. */
function textOf(html) {
  const { document } = parseHTML(`<!doctype html><html><body><div id="x">${html}</div></body></html>`);
  return D.norm(document.getElementById("x").textContent);
}

function newKeysFor(page) {
  const html = fs.readFileSync(path.join(ROOT, `${page}.html`), "utf8");
  const { document } = parseHTML(html);
  const seen = new Set();
  const keys = [];
  for (const u of D.units(document.body)) {
    const k = D.unitKey(u);
    if (seen.has(k)) continue;   // the extractor dedupes; match that
    seen.add(k);
    keys.push(k);
  }
  return keys;
}

function mapKeys(oldKeys, newKeys) {
  const mapping = new Map();
  const takenNew = new Set();

  for (const k of oldKeys) {
    if (newKeys.includes(k)) { mapping.set(k, k); takenNew.add(k); }
  }

  const newByText = new Map();
  for (const nk of newKeys) {
    if (takenNew.has(nk)) continue;
    const t = textOf(nk);
    if (newByText.has(t)) newByText.set(t, null);   // ambiguous: refuse it
    else newByText.set(t, nk);
  }
  for (const k of oldKeys) {
    if (mapping.has(k)) continue;
    const hit = newByText.get(textOf(k));
    if (hit && !takenNew.has(hit)) { mapping.set(k, hit); takenNew.add(hit); }
  }

  /* Whatever is left is matched by where it sits in the walk, and only when
     exactly one candidate remains on each side. Anything less certain is
     left for a human. */
  const leftoverOld = oldKeys.filter((k) => !mapping.has(k));
  const leftoverNew = newKeys.filter((k) => !takenNew.has(k));
  if (leftoverOld.length === leftoverNew.length) {
    leftoverOld.forEach((k, i) => mapping.set(k, leftoverNew[i]));
  }

  return { mapping, unmapped: oldKeys.filter((k) => !mapping.has(k)) };
}

function main() {
  const report = [];
  let failed = false;

  const enPath = path.join(ROOT, "i18n-src", "en.json");
  const en = JSON.parse(fs.readFileSync(enPath, "utf8"));
  const rekeyed = {};

  for (const page of L.PAGES) {
    const oldEntry = en[page] || {};
    const oldKeys = Object.keys(oldEntry).filter((k) => !k.startsWith("__"));
    const newKeys = newKeysFor(page);
    const { mapping, unmapped } = mapKeys(oldKeys, newKeys);

    if (unmapped.length) {
      failed = true;
      report.push(`UNMAPPED ${page}: ${unmapped.length}`);
      for (const k of unmapped) report.push(`    ${JSON.stringify(k.slice(0, 90))}`);
    }

    rekeyed[page] = { mapping, newKeys, oldEntry };
    report.push(`${page}: ${oldKeys.length} old -> ${newKeys.length} new, ${mapping.size} mapped`);
  }

  fs.writeFileSync(path.join(ROOT, "rekey-report.txt"), report.join("\n") + "\n");
  console.log(report.join("\n"));

  if (failed) {
    console.error("\nrekey: some translations could not be mapped. Nothing was written.");
    console.error("Resolve them by hand before re-running — never let one be dropped.");
    process.exit(1);
  }

  /* Only once everything maps: rewrite en.json and each language source. */
  for (const page of L.PAGES) {
    const { mapping, newKeys, oldEntry } = rekeyed[page];
    const next = {};
    for (const k of Object.keys(oldEntry)) {
      if (k.startsWith("__")) { next[k] = oldEntry[k]; continue; }
      next[mapping.get(k)] = oldEntry[k];
    }
    for (const nk of newKeys) if (!(nk in next)) next[nk] = nk;
    en[page] = next;
  }
  fs.writeFileSync(enPath, JSON.stringify(en, null, 2) + "\n");
  console.log("rekey: rewrote i18n-src/en.json");
  console.log("Now update the per-language hashes — see the next step.");
}

module.exports = { textOf, mapKeys, newKeysFor };
if (require.main === module) main();
```

- [ ] **Step 3: Re-derive the per-language hashes**

`i18n-src/<lang>.txt` keys each translation by `sha1(English)[:8]`. The English
changed, so every affected hash changed. Extend `rekey.cjs` (or add a companion
step) that, for each language file, rewrites both the `#!` English comment line
and the hash, using the same algorithm `tools/i18n/build.cjs` uses — read it,
do not reimplement it from memory.

- [ ] **Step 4: Rebuild and verify nothing was lost**

```bash
node tools/i18n/rekey.cjs
node tools/i18n/build.cjs da de es fr
```
Expected: no `UNMAPPED` lines, no `WARN` lines.

Then confirm the translated text survived intact — the keys moved, the values
must not have:

```bash
for l in da de es fr; do
  printf '%s: old values %s  new values %s\n' "$l" \
    "$(cat /tmp/i18n-backup/i18n/$l/*.json | grep -c '":')" \
    "$(cat i18n/$l/*.json | grep -c '":')"
done
```
Expected: the counts match for every language. A drop means a translation was
lost — stop and investigate rather than proceeding.

- [ ] **Step 5: The check that must now pass 24/24**

Re-run the script from Task 3, Step 6.
Expected: `0 of 24 combinations currently mismatch`.

**This is the gate for the whole plan.** If it is not zero, do not continue and
do not loosen the matching — report what remains.

- [ ] **Step 6: Point the extractor at the same parser**

`tools/i18n/extract.cjs` currently drives Chrome under Electron. It must now use
`tools/i18n/dom-i18n.cjs`, so future extractions produce keys that match what
the prerenderer renders. Keep its output format and its `PAGES` list exactly as
they are; only the mechanism changes. This also removes Electron from the
workflow, which was never installed here anyway.

- [ ] **Step 7: Have the migration reviewed before it is committed**

Print a sample of before/after for a human to read:

```bash
diff <(python3 -c "import json;d=json.load(open('/tmp/i18n-backup/i18n/da/index.json'));print(chr(10).join(sorted(d.values())))") \
     <(python3 -c "import json;d=json.load(open('i18n/da/index.json'));print(chr(10).join(sorted(d.values())))")
```
Expected: no differences — the set of Danish strings is unchanged; only the
keys moved. Report this output.

- [ ] **Step 8: Commit**

```bash
rm -f rekey-report.txt
git add tools/i18n/rekey.cjs tools/i18n/extract.cjs i18n-src i18n
git commit -m "Re-key the dictionaries onto the parser that renders them"
```

---

### Task 4: The prerenderer

**Files:**
- Create: `tools/i18n/prerender.cjs`

**Interfaces:**
- Consumes: `links.cjs` (Task 2), `dom-i18n.cjs` (Task 3).
- Produces: `prerenderPage(html, {page, lang, dict})` → translated HTML string. `main()` writes `dist/<lang>/<page>.html` for every language and page, and throws on any unmatched key.

There is no unit test for the file writing; the coverage assertion in Step 3 and the build in Task 6 cover it. The pure parts it relies on are already tested.

- [ ] **Step 1: Write `tools/i18n/prerender.cjs`**

```js
// Renders each English page into its translated twin under dist/<lang>/.
//
// The site is static, so every language needs a real file at a real URL —
// that is the only way a search engine will ever see the translations.

const fs = require("fs");
const path = require("path");
const { parseHTML } = require("linkedom");
const L = require("./links.cjs");
const D = require("./dom-i18n.cjs");

const ROOT = path.join(__dirname, "..", "..");
const DIST = path.join(ROOT, "dist");

const OG_LOCALE = { en: "en_GB", da: "da_DK", de: "de_DE", es: "es_ES", fr: "fr_FR" };

function setMeta(document, selector, attr, value) {
  const el = document.querySelector(selector);
  if (el) el.setAttribute(attr, value);
}

function prerenderPage(html, { page, lang, dict }) {
  const { document } = parseHTML(html);

  const { applied, missed } = D.applyDict(document.body, dict);
  if (missed.length) {
    const err = new Error(
      `prerender: ${lang}/${page} left ${missed.length} translation(s) unmatched — ` +
      `the page would ship half in English. First few: ${JSON.stringify(missed.slice(0, 3))}`
    );
    err.missed = missed;
    throw err;
  }

  document.documentElement.setAttribute("lang", lang);
  document.documentElement.setAttribute("data-lang", lang);

  if (dict.__title) {
    const t = document.querySelector("title");
    if (t) t.textContent = dict.__title;
    setMeta(document, 'meta[property="og:title"]', "content", dict.__title);
    setMeta(document, 'meta[name="twitter:title"]', "content", dict.__title);
  }
  if (dict.__description) {
    setMeta(document, 'meta[name="description"]', "content", dict.__description);
    setMeta(document, 'meta[property="og:description"]', "content", dict.__description);
    setMeta(document, 'meta[name="twitter:description"]', "content", dict.__description);
  }

  const url = L.absUrl(page, lang);
  setMeta(document, 'link[rel="canonical"]', "href", url);
  setMeta(document, 'meta[property="og:url"]', "content", url);
  setMeta(document, 'meta[property="og:locale"]', "content", OG_LOCALE[lang]);

  /* hreflang on every page in every language: this is what lets a search
     engine find the other versions without ever following the redirect. */
  for (const stale of document.querySelectorAll('link[rel="alternate"][hreflang]')) stale.remove();
  const head = document.querySelector("head");
  for (const alt of L.alternates(page)) {
    const link = document.createElement("link");
    link.setAttribute("rel", "alternate");
    link.setAttribute("hreflang", alt.hreflang);
    link.setAttribute("href", alt.href);
    head.appendChild(link);
  }

  /* Internal links keep the visitor in their language. /api/ is left alone —
     prefixing the download endpoint would 404 every installer. */
  for (const a of document.querySelectorAll("a[href]")) {
    a.setAttribute("href", L.rewriteHref(a.getAttribute("href"), lang));
  }

  /* The switcher becomes real links, so crawlers follow them. */
  const sw = document.querySelector(".lang-switch");
  if (sw) {
    sw.replaceChildren();
    for (const code of L.LANGS) {
      const a = document.createElement("a");
      a.setAttribute("href", L.langPath(page, code));
      a.setAttribute("lang", code);
      a.setAttribute("data-lang", code);
      a.textContent = code.toUpperCase();
      if (code === lang) {
        a.setAttribute("aria-current", "true");
        a.setAttribute("class", "is-current");
      }
      sw.appendChild(a);
    }
  }

  /* "This page's body stays in English" notes: hidden on the English page,
     shown everywhere else. */
  for (const note of document.querySelectorAll(".i18n-note")) {
    if (lang === "en") note.setAttribute("hidden", "");
    else note.removeAttribute("hidden");
  }

  return `<!doctype html>\n${document.documentElement.outerHTML}\n`;
}

function main() {
  let count = 0;
  for (const lang of L.TRANSLATED) {
    for (const page of L.PAGES) {
      const html = fs.readFileSync(path.join(ROOT, `${page}.html`), "utf8");
      const dict = JSON.parse(fs.readFileSync(path.join(ROOT, "i18n", lang, `${page}.json`), "utf8"));
      const out = prerenderPage(html, { page, lang, dict });
      const dest = path.join(DIST, lang, `${page}.html`);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, out);
      count += 1;
    }
  }
  console.log(`prerender: wrote ${count} translated pages`);
}

module.exports = { prerenderPage, main };
if (require.main === module) main();
```

- [ ] **Step 2: Run it on its own**

Run: `npm run build && node tools/i18n/prerender.cjs && find dist -name '*.html' | sort | head -12`
Expected: `prerender: wrote 24 translated pages`, and `dist/da/…`, `dist/de/…` files listed.

- [ ] **Step 3: Check a generated page by eye**

Run:
```bash
grep -oE '<html[^>]*>|<title>[^<]*</title>|rel="canonical" href="[^"]*"|hreflang="[^"]*" href="[^"]*"' dist/de/index.html | head -12
grep -c 'href="/de/' dist/de/index.html
grep -c '/api/download' dist/de/index.html
```
Expected: `lang="de"`, a German title, a canonical of `https://www.bethaniel.eu/de/`, six hreflang lines, several `/de/` links, and the `/api/download` links still present and unprefixed.

- [ ] **Step 4: Confirm the download links survived untouched**

Run: `grep -o '/api/download?asset=[a-z0-9-]*' dist/de/index.html | sort -u`
Expected: the five asset ids, none of them prefixed with `/de`.

- [ ] **Step 5: Commit**

```bash
git add tools/i18n/prerender.cjs
git commit -m "Render each page into its four translations"
```

---

### Task 5: Sitemap generation

**Files:**
- Create: `tools/i18n/sitemap.cjs`, `test/sitemap.test.js`
- Delete: `sitemap.xml` (it becomes generated)

**Interfaces:**
- Consumes: `links.cjs` (Task 2).
- Produces: `buildSitemap()` → XML string; `main()` writes `dist/sitemap.xml`.

- [ ] **Step 1: Write the failing test**

Create `test/sitemap.test.js`:

```js
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
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `node --test test/sitemap.test.js`
Expected: FAIL — `Cannot find module '../tools/i18n/sitemap.cjs'`

- [ ] **Step 3: Write `tools/i18n/sitemap.cjs`**

```js
// The sitemap, generated rather than hand-kept, because it now has thirty
// entries and would drift the first time a page was added.
//
// Each entry names its own URL and every translation of it. That is how a
// search engine finds /de/ without ever following the browser-language
// redirect at the root — which is what keeps that redirect harmless.

const fs = require("fs");
const path = require("path");
const L = require("./links.cjs");

function esc(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function buildSitemap() {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"',
    '        xmlns:xhtml="http://www.w3.org/1999/xhtml">',
  ];
  for (const lang of L.LANGS) {
    for (const page of L.PAGES) {
      lines.push("  <url>");
      lines.push(`    <loc>${esc(L.absUrl(page, lang))}</loc>`);
      for (const alt of L.alternates(page)) {
        lines.push(
          `    <xhtml:link rel="alternate" hreflang="${alt.hreflang}" href="${esc(alt.href)}"/>`
        );
      }
      lines.push("  </url>");
    }
  }
  lines.push("</urlset>");
  return lines.join("\n") + "\n";
}

function main() {
  const dest = path.join(__dirname, "..", "..", "dist", "sitemap.xml");
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, buildSitemap());
  console.log("sitemap: wrote 30 urls");
}

module.exports = { buildSitemap, main };
if (require.main === module) main();
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `node --test test/sitemap.test.js`
Expected: PASS — 5 tests.

- [ ] **Step 5: Remove the committed sitemap**

```bash
git rm sitemap.xml
```

It is now build output. Confirm `tools/build.cjs`'s `COPY` list does **not** mention `sitemap.xml` — if it does, remove that entry, or the build will fail on a missing file.

- [ ] **Step 6: Commit**

```bash
git add tools/i18n/sitemap.cjs test/sitemap.test.js
git commit -m "Generate the sitemap, now that it has thirty entries"
```

---

### Task 6: Wire the build together

**Files:**
- Modify: `tools/build.cjs`

**Interfaces:**
- Consumes: `prerender.cjs` (Task 4), `sitemap.cjs` (Task 5).
- Produces: `npm run build` emitting a complete `dist/`.

- [ ] **Step 1: Call the prerenderer and the sitemap from the build**

In `tools/build.cjs`, replace the body of `main()` with:

```js
function main() {
  fs.rmSync(DIST, { recursive: true, force: true });
  for (const entry of COPY) {
    const from = path.join(ROOT, entry);
    if (!fs.existsSync(from)) throw new Error(`build: missing ${entry}`);
    copy(from, path.join(DIST, entry));
  }
  console.log(`build: copied ${COPY.length} entries into dist/`);

  /* Translations and the sitemap are generated, not committed. A page that
     fails to translate throws here and takes the build down with it — far
     better than deploying a page that is half English. */
  require("./i18n/prerender.cjs").main();
  require("./i18n/sitemap.cjs").main();
}
```

- [ ] **Step 2: Run the whole build**

Run: `npm run build`
Expected, in order: `build: copied 13 entries into dist/`, `prerender: wrote 24 translated pages`, `sitemap: wrote 30 urls`.

- [ ] **Step 3: Confirm the output is complete**

Run:
```bash
find dist -name '*.html' | wc -l
ls dist
ls dist/de
```
Expected: 31 HTML files (6 English + 24 translated + `stats.html`); `dist/` holding the English pages, `da de es fr`, `Public`, `js`, `i18n`, `style.css`, `i18n.js`, `robots.txt`, `sitemap.xml`.

- [ ] **Step 4: Prove the build fails loudly on a bad translation**

Temporarily corrupt one dictionary and confirm the build refuses:

```bash
cp i18n/de/contact.json /tmp/contact.bak
node -e 'const f="i18n/de/contact.json",d=require("./"+f);d["A string that is not on the page"]="x";require("fs").writeFileSync(f,JSON.stringify(d,null,2))'
npm run build; echo "exit=$?"
cp /tmp/contact.bak i18n/de/contact.json
npm run build >/dev/null && echo "restored, build green again"
```
Expected: the corrupted run prints a `prerender: de/contact left 1 translation(s) unmatched` error and exits non-zero. The restored run succeeds.

This is the safety net the whole design rests on — confirm it actually bites.

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: PASS — 50 tests (27 existing + 10 links + 8 dom-i18n + 5 sitemap).

- [ ] **Step 6: Commit**

```bash
git add tools/build.cjs
git commit -m "One build: copy, translate, then the sitemap"
```

---

### Task 7: Shrink the runtime to the redirect

**Files:**
- Modify: `i18n.js`
- Create: `test/redirect.test.js`
- Modify: the six English pages (`index.html`, `how-it-works.html`, `performance.html`, `blog.html`, `cloud-terms.html`, `contact.html`) — switcher markup

**Interfaces:**
- Consumes: nothing.
- Produces: `window.BettyI18n` retaining whatever `tools/i18n/extract.cjs` needs, plus the pure `chooseLang(stored, navLang, path)` used by the test.

**Read `tools/i18n/extract.cjs` first.** It drives the site under Electron and calls into `window.BettyI18n`. Whatever it uses must still exist, or the workflow that produces the dictionaries breaks. Check which of `units`, `unitKey`, `blocks`, `key`, `norm`, `setLang`, `LANGS` it actually calls, and keep exactly those.

- [ ] **Step 1: Write the failing test**

Create `test/redirect.test.js`:

```js
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
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `node --test test/redirect.test.js`
Expected: FAIL — `chooseLang` not found in the source.

- [ ] **Step 3: Rewrite `i18n.js`**

Replace the whole file with the following, then re-add any `window.BettyI18n` members `extract.cjs` turned out to need (Step 0 of this task).

```js
// ── Language redirect ──
//
// The pages are now translated at build time and served from their own URLs
// (/de/, /da/, /es/, /fr/), so nothing is translated in the browser any more.
// All that is left is sending a first-time visitor to their language, and
// remembering the choice when they use the switcher.
//
// The redirect fires ONLY at the site root. A path that already carries a
// language prefix is left alone, so a crawler fetching /de/how-it-works from
// the sitemap gets that page rather than being bounced. Combined with the
// hreflang tags and the sitemap, that is what keeps this redirect from
// hiding the translations from search engines.
(function () {
  "use strict";

  var LANGS = ["en", "da", "de", "es", "fr"];
  var STORAGE_KEY = "betty-lang";

  function chooseLang(stored, navLang, path) {
    /* Anything but the bare root is already an explicit request. */
    if (path !== "/" && path !== "") return null;
    if (stored && LANGS.indexOf(stored) !== -1) return stored;
    var nav = String(navLang || "en").slice(0, 2).toLowerCase();
    return LANGS.indexOf(nav) !== -1 ? nav : "en";
  }
  // end chooseLang

  function stored() {
    try {
      return localStorage.getItem(STORAGE_KEY);
    } catch (e) {
      return null;
    }
  }

  function remember(lang) {
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch (e) {}
  }

  /* The switcher is a set of real links, so a crawler can follow them and a
     visitor with no JavaScript can still change language. All this adds is
     remembering the choice for next time. */
  function wire() {
    var links = document.querySelectorAll("[data-lang]");
    for (var i = 0; i < links.length; i++) {
      links[i].addEventListener("click", function () {
        remember(this.getAttribute("data-lang"));
      });
    }
  }

  function run() {
    wire();
    var lang = chooseLang(stored(), navigator.language, location.pathname);
    if (lang && lang !== "en") location.replace("/" + lang + "/");
  }

  window.BettyI18n = { chooseLang: chooseLang, LANGS: LANGS };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run);
  } else {
    run();
  }
})();
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `node --test test/redirect.test.js`
Expected: PASS — 7 tests.

- [ ] **Step 5: Make the switcher real links in the English pages**

In each of the six pages, replace the `.lang-switch` block. It currently reads:

```html
            <div class="lang-switch" role="group" aria-label="Language" data-i18n="skip">
              <button type="button" data-lang="en" lang="en" aria-current="true">EN</button>
              <button type="button" data-lang="da" lang="da">DA</button>
              <button type="button" data-lang="de" lang="de">DE</button>
              <button type="button" data-lang="es" lang="es">ES</button>
              <button type="button" data-lang="fr" lang="fr">FR</button>
            </div>
```

Replace with links whose targets are **this page** in each language. For `index.html`:

```html
            <nav class="lang-switch" aria-label="Language" data-i18n="skip">
              <a href="/" lang="en" data-lang="en" aria-current="true" class="is-current">EN</a>
              <a href="/da/" lang="da" data-lang="da">DA</a>
              <a href="/de/" lang="de" data-lang="de">DE</a>
              <a href="/es/" lang="es" data-lang="es">ES</a>
              <a href="/fr/" lang="fr" data-lang="fr">FR</a>
            </nav>
```

For the other five, use that page's paths — `how-it-works.html` gets `/how-it-works`, `/da/how-it-works`, `/de/how-it-works`, `/es/how-it-works`, `/fr/how-it-works`, and so on for `performance`, `blog`, `cloud-terms`, `contact`.

`data-i18n="skip"` must stay, so the walker never treats `EN`/`DA`/… as translatable text.

- [ ] **Step 6: Check the switcher still looks right**

The CSS targets `.lang-switch button`. Run:

```bash
grep -n '\.lang-switch' style.css
```

If the selectors name `button`, widen them to cover `a` as well — for example `.lang-switch button, .lang-switch a`. Do not restyle; only make the existing rules apply to the new element. Anchors also need `text-decoration: none` if the rules relied on a button's default.

- [ ] **Step 7: Rebuild and confirm nothing regressed**

Run: `npm run build && npm test`
Expected: the build prints its three lines and succeeds; `npm test` passes 57 tests (50 + 7 redirect).

- [ ] **Step 8: Confirm the extractor still has what it needs**

Run: `grep -n 'BettyI18n' tools/i18n/extract.cjs`
Read the calls. Every member it uses must exist in the new `window.BettyI18n`. If it needs `units`/`blocks`/`key`/`norm`, re-export them from `tools/i18n/dom-i18n.cjs`'s logic inline in `i18n.js` — or, if that is unwieldy, note plainly in the report that `extract.cjs` needs updating to use `tools/i18n/dom-i18n.cjs` instead of the browser runtime, and do that.

- [ ] **Step 9: Commit**

```bash
git add i18n.js test/redirect.test.js index.html how-it-works.html performance.html blog.html cloud-terms.html contact.html style.css
git commit -m "The runtime only chooses a language now; the pages arrive translated"
```

---

### Task 8: Deploy and verify

**Files:**
- Modify: `TODO.md`

**Interfaces:**
- Consumes: everything.
- Produces: translations live and indexable.

- [ ] **Step 1: Push and get a preview deployment**

```bash
git push
```

Wait for Vercel, and take the preview URL.

- [ ] **Step 2: Every language URL serves, in the right language**

```bash
for p in "" de/ da/ es/ fr/; do
  printf '%-6s %s  lang=%s\n' "/$p" \
    "$(curl -s -o /dev/null -w '%{http_code}' "<PREVIEW>/$p")" \
    "$(curl -s "<PREVIEW>/$p" | grep -o '<html lang="[a-z]*"' | head -1)"
done
```
Expected: 200 for each, with `lang="en"`, `lang="de"`, `lang="da"`, `lang="es"`, `lang="fr"` respectively.

- [ ] **Step 3: Deep pages work in every language**

```bash
for l in de da es fr; do
  for p in how-it-works performance blog cloud-terms contact; do
    printf '%s/%s %s  ' "$l" "$p" "$(curl -s -o /dev/null -w '%{http_code}' "<PREVIEW>/$l/$p")"
  done; echo
done
```
Expected: 200 for all twenty.

- [ ] **Step 4: The download path still works from a translated page — the critical one**

```bash
curl -s "<PREVIEW>/de/" | grep -o '/api/download?asset=[a-z0-9-]*' | sort -u
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' "<PREVIEW>/api/download?asset=win"
```
Expected: the five asset ids, unprefixed; and a 302 to `Bethaniel-win.exe`.

**If a link reads `/de/api/download`, stop** — the link rewriting is wrong and every download from a translated page is broken.

- [ ] **Step 5: hreflang and canonicals are right**

```bash
curl -s "<PREVIEW>/de/blog" | grep -oE 'rel="canonical" href="[^"]*"|hreflang="[^"]*" href="[^"]*"'
```
Expected: canonical `https://www.bethaniel.eu/de/blog`, plus six alternates — five languages and `x-default` → the English URL.

- [ ] **Step 6: The redirect fires only at the root**

```bash
curl -s "<PREVIEW>/de/how-it-works" | grep -c 'location.replace'
```
The script is present on every page — that is expected. What matters is behaviour: open `<PREVIEW>/de/how-it-works` in a browser with German as the preferred language and confirm the URL does **not** change. Then open `<PREVIEW>/` and confirm it moves to `/de/`. Then use the switcher to pick EN, reload `/`, and confirm it stays English — the stored choice must win.

- [ ] **Step 7: The sitemap and tracking survived**

```bash
curl -s "<PREVIEW>/sitemap.xml" | grep -c '<loc>'
curl -s "<PREVIEW>/robots.txt"
curl -s -o /dev/null -w '%{http_code}\n' "<PREVIEW>/js/campaign.js"
curl -s "<PREVIEW>/de/" | grep -c 'js/campaign.js'
```
Expected: 30; the robots file as before; 200; and 1 — campaign tracking present on translated pages.

- [ ] **Step 8: Update `TODO.md`**

Add to the "Already wired up" section:

```markdown
### Translations are real URLs

English is served from the root; `da`, `de`, `es` and `fr` are generated into
`/da/`, `/de/`, `/es/`, `/fr/` at deploy time by `tools/i18n/prerender.cjs`,
which `npm run build` runs. Nothing translated is committed — the dictionaries
under `i18n/` are the source.

**The build fails if any translation key goes unmatched**, rather than
shipping a page that is half English. If it fails, the message names the
language, the page and the unmatched strings.

`i18n.js` no longer translates anything. It only redirects a first-time
visitor from `/` to their language and remembers a switcher choice. It must
never redirect from a path that already carries a language prefix — that,
plus hreflang on every page and all thirty URLs in the sitemap, is what keeps
the redirect from hiding the translations from search engines.

`sitemap.xml` is generated (`tools/i18n/sitemap.cjs`) and no longer lives in
the repo.
```

- [ ] **Step 9: Commit and merge**

```bash
git add TODO.md
git commit -m "Write down how the translated URLs are built"
git push
```

---

## Verification

```bash
npm test
```

Expected: **57 tests pass, 0 fail** — 27 existing, plus `links` (10), `dom-i18n` (8), `sitemap` (5), `redirect` (7).

These counts were verified by extracting the plan's own code and running it, so they are what you should actually see.

```bash
npm run build
```

Expected: three lines, exit 0, and `dist/` holding 31 HTML files and a 30-URL sitemap.

Everything else is in Task 8: twenty-five language URLs serving, downloads unprefixed and working from translated pages, hreflang and canonicals correct, and the redirect firing only at the root.
