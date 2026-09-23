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

  /* The results table on /performance is built by a script after load, so it
     cannot be translated in place. Hand its script the names instead. The
     space before the per-cent sign is how Danish, German, Spanish and French
     set it; English does not. */
  if (dict.__categories) {
    const inject = document.createElement("script");
    inject.textContent =
      `window.BETTY_CATEGORIES=${JSON.stringify(dict.__categories)};` +
      `window.BETTY_PCT_SEP="\u00a0";`;
    const first = document.querySelector("body script");
    if (first) first.parentNode.insertBefore(inject, first);
    else document.querySelector("body").appendChild(inject);
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
