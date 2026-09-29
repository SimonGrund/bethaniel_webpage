// URL shapes for the multilingual site. Pure: no DOM, no filesystem, so the
// rules can be tested on their own.
//
// English lives at the root and the other four are prefixed. Search engines
// need every version to have its own address; that is the whole point of the
// exercise.

const SITE = "https://www.bethaniel.eu";
const LANGS = ["en", "da", "de", "es", "fr"];
const TRANSLATED = ["da", "de", "es", "fr"];
const PAGES = ["index", "how-it-works", "performance", "blog", "cloud-terms", "privacy", "contact", "license"];

/* Links the prefixer must never touch. /api/ carries the download redirect
   and the tracking beacon — both language-neutral, and prefixing the
   download would 404 every installer. /stats is the internal dashboard. */
const NEVER_PREFIX = ["/api/", "/stats", "/admin"];

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

/* Assets (style.css, i18n.js, Public/...) are written relative to the site
   root. A translated page is served one level down, at /da/, where a relative
   path would ask for /da/style.css and the page would load with no styles,
   no scripts and no images. Anchor them to the root instead. */
function assetPath(ref) {
  if (typeof ref !== "string" || ref === "") return ref;
  if (/^[a-z][a-z0-9+.-]*:/i.test(ref)) return ref;   // http:, data:, mailto:
  if (ref.startsWith("/") || ref.startsWith("#")) return ref;
  return "/" + ref.replace(/^\.\//, "");
}

function alternates(page) {
  const out = LANGS.map((lang) => ({ hreflang: lang, href: absUrl(page, lang) }));
  /* x-default is what a search engine shows when it has no better match. */
  out.push({ hreflang: "x-default", href: absUrl(page, "en") });
  return out;
}

module.exports = {
  SITE, LANGS, TRANSLATED, PAGES,
  pagePath, langPath, absUrl, isInternal, rewriteHref, assetPath, alternates,
};
