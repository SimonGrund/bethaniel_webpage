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
