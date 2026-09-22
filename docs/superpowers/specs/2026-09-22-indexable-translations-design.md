# Indexable translations via per-language URLs

**Date:** 2026-09-22
**Status:** Approved, ready for implementation planning

## Problem

The site is fully translated into Danish, German, Spanish and French — 388
strings per language across six pages — and search engines see none of it.
Every language shares one URL, `<html lang>` is always `en`, and translation
happens in the browser after load. The translation work is already paid for and
currently returns no search traffic.

## Decisions taken

Settled during brainstorming. Not open for re-litigation during implementation.

| Decision | Choice | Consequence accepted |
| --- | --- | --- |
| URL shape | English at root, others prefixed: `/de/`, `/da/`, `/es/`, `/fr/` | 30 URLs total |
| Auto-redirect by browser language | **Kept** | See "Why the redirect is safe here" |
| Where translated HTML comes from | Generated at deploy time on Vercel | The repo no longer contains exactly what ships |
| Unmatched translation key | **Fails the build** | A broken prerender blocks deploy rather than shipping half-English pages |
| Language switcher | Real `<a href>` links | Crawlable; replaces the DOM-rewriting buttons |

## Why the redirect is safe here

Auto-redirecting by `Accept-Language` is normally an SEO hazard: it can leave a
crawler seeing only one version. Three things defuse it in this design, and all
three are requirements, not nice-to-haves:

1. **The redirect fires only at `/`.** A URL that already carries a language
   prefix never redirects. A crawler fetching `/de/how-it-works` from the
   sitemap gets that page, always.
2. **Googlebot crawls predominantly as `en-US`.** English is the root's own
   language, so the redirect does not fire for it.
3. **Every version is discoverable without the redirect** — via hreflang on
   every page, all 30 URLs in the sitemap, and crawlable switcher links.

Remove any of the three and the redirect becomes a liability again.

## Architecture

```
i18n-src/*.txt  ──build.cjs──▶  i18n/<lang>/<page>.json   (existing, unchanged)
                                          │
english *.html ───────────────────────────┼──▶ prerender.cjs ──▶ dist/<lang>/<page>.html
        │                                 │                       · translated
        └──────────── copied ────────────▶ dist/*.html            · <html lang>
                                                                  · canonical + hreflang
                                                                  · in-language links
```

### Component 1 — `tools/i18n/prerender.cjs`

For each language in `["da","de","es","fr"]` and each page in the existing
`PAGES` list, load the English HTML, apply the dictionary, and write
`dist/<lang>/<page>.html`.

**It must reproduce `i18n.js`'s `units()`, `key()` and `apply()` exactly.** Keys
are `norm(el.innerHTML)`; a divergence in how the parser serializes `innerHTML`
means a key silently fails to match. `i18n.js` is the reference implementation —
port its logic rather than writing a fresh interpretation, and keep the `SKIP`
list and `data-i18n="skip"` handling identical.

Per generated page it also:

- sets `<html lang="<lang>">`
- rewrites `<link rel="canonical">` to that language's absolute URL
- injects `<link rel="alternate" hreflang>` for all five languages plus
  `x-default` pointing at English
- sets `og:locale` and `og:url`
- rewrites **site-internal** links to stay in-language
  (`/how-it-works` → `/de/how-it-works`)

**Links that must NOT be rewritten:** anything under `/api/` (the download and
tracking endpoints are language-neutral and rewriting them would break
downloads), `/stats`, external URLs, anchors, and `mailto:`.

### Component 2 — the key-coverage assertion

After applying each page, the prerenderer compares keys applied against keys
available in that page's dictionary. **Anything less than 100% fails the build
with a non-zero exit**, naming the language, the page, and the unmatched keys.

This is the safety net for the one real risk: the dictionaries were extracted by
Chrome (`tools/i18n/extract.cjs` runs under Electron), while the prerenderer
parses in Node. If the two disagree on `innerHTML` serialization — attribute
order, entity escaping, void-element form — keys miss and pages ship
half-translated. The assertion converts a silent content bug into a loud build
failure.

**Fallback if the Node parser proves incompatible:** run the existing Electron
path at build time instead. Decide this on evidence from the assertion, not in
advance.

### Component 3 — build and output

`npm run build` copies the static site into `dist/`, then generates the four
language trees. `vercel.json` gains `"outputDirectory": "dist"`.

**Verify early, before building anything else:** that serverless functions under
`/api` still deploy when an `outputDirectory` is set. Vercel resolves functions
from the repo root rather than the output directory, but this is the single
assumption capable of breaking downloads in production, so it gets proven first,
on a preview deployment, before the rest of the work proceeds.

Files that must reach `dist/` unchanged: `style.css`, `js/`, `Public/`,
`i18n/`, `i18n.js`, `robots.txt`, `sitemap.xml`, `stats.html`, and the six
English pages. `docs/` and `.superpowers/` stay excluded, as `.vercelignore`
already specifies.

### Component 4 — the switcher

The existing `.lang-switch` button group becomes real links. On each generated
page, each link points at that same page in the target language — `/de/blog`
links to `/blog`, `/da/blog`, `/es/blog`, `/fr/blog`. The current language's
link carries `aria-current="true"`.

Clicking one records the choice in `localStorage` so the root redirect respects
it on a later visit.

### Component 5 — `i18n.js` shrinks

Runtime DOM rewriting goes away; pages arrive translated. What remains:

- at `/` only: if `localStorage` holds a language choice, honour it; otherwise
  consult `navigator.language`. Redirect to `/<lang>/` when the result is not
  English.
- record the choice when a switcher link is clicked.

It must never redirect from a URL that already has a language prefix, and it
must not throw when storage is unavailable. Expect roughly 30 lines, down from
about 230. `units()`, `key()`, `norm()` and `blocks()` move to the prerenderer;
`window.BettyI18n` is no longer needed by the pages, but `tools/i18n/extract.cjs`
depends on the runtime exposing them — check before deleting, and keep whatever
the extractor needs.

### Component 6 — sitemap

Grows from 6 URLs to 30, each with hreflang annotations listing its siblings.
`/stats` stays excluded.

## Testing

Unit tests under the existing `node --test` suite, for the pure logic:

| Module | Tested behaviour |
| --- | --- |
| link rewriting | internal paths gain the prefix; `/api/*`, `/stats`, external, anchor and `mailto:` links are untouched; already-prefixed paths are not double-prefixed |
| hreflang generation | all five languages plus `x-default`; absolute URLs; correct per page |
| sitemap generation | 30 URLs, well-formed XML, `/stats` absent |
| redirect decision | the pure "given stored choice and navigator language, which language" function — including that a prefixed path yields no redirect |

Not unit-tested, verified by the build itself and on a preview deployment:

- 100% key coverage per language per page (the build assertion)
- functions under `/api` still work with `outputDirectory` set
- a download from a translated page still reaches the right installer
- the campaign tracking script loads on translated pages

## Out of scope

- Translating `stats.html` (internal, English only)
- Adding new languages
- Translating the blog's individual posts beyond what the dictionaries cover
- Server-side language negotiation via Vercel config
- Changing any English copy

## Files

**New:** `tools/i18n/prerender.cjs`, `tools/i18n/links.cjs` (pure link/hreflang
helpers, so they can be tested without a DOM), `test/prerender.test.js`

**Modified:** `i18n.js` (shrinks), `vercel.json` (`outputDirectory`),
`package.json` (build script, one DOM dependency), `sitemap.xml` (generated),
the six English pages (switcher markup)
