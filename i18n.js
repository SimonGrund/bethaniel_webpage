// ── Site translation ──
//
// The English in the HTML is the source and the key. Each translatable block
// — a heading, a paragraph, a list item, a button — is looked up by its
// normalised English content in the chosen language's dictionary and swapped
// in place. Nothing in the markup is annotated, so the pages stay exactly the
// pages, and a block with no translation simply stays English rather than
// breaking.
//
// The dictionaries live in i18n/<lang>.json and are fetched on demand, so an
// English visitor loads nothing extra.
//
// Blog posts and the cloud terms are deliberately not in the dictionaries:
// one is the author's own voice, the other is the binding legal text. Their
// surrounding chrome translates; their bodies do not, and a note says so.
(function () {
  "use strict";

  var LANGS = ["en", "da", "de", "es", "fr"];
  var STORAGE_KEY = "betty-lang";

  // Inline formatting that may sit inside a block without splitting it into
  // several. A block is the outermost element whose subtree contains nothing
  // but text and these.
  var INLINE = {
    A: 1, STRONG: 1, EM: 1, B: 1, I: 1, SPAN: 1, CODE: 1, SMALL: 1, BR: 1,
    SUP: 1, SUB: 1, ABBR: 1, KBD: 1, MARK: 1, U: 1, S: 1, TIME: 1,
  };
  // Elements that can be a translatable block at all.
  var BLOCK = {
    P: 1, H1: 1, H2: 1, H3: 1, H4: 1, H5: 1, H6: 1, LI: 1, A: 1, BUTTON: 1,
    TD: 1, TH: 1, SUMMARY: 1, FIGCAPTION: 1, BLOCKQUOTE: 1, LABEL: 1, DT: 1,
    DD: 1, SPAN: 1, SMALL: 1, STRONG: 1, EM: 1, CAPTION: 1, LEGEND: 1,
    OPTION: 1, DIV: 1,
  };
  // Never translate inside these.
  // <data> and <output> hold machine values (the version tag): never text to translate.
  var SKIP = { SCRIPT: 1, STYLE: 1, PRE: 1, CODE: 1, SVG: 1, TEMPLATE: 1, NOSCRIPT: 1, DATA: 1, OUTPUT: 1 };

  function norm(s) {
    return String(s).replace(/\s+/g, " ").trim();
  }

  function isInlineOnly(el) {
    for (var n = el.firstChild; n; n = n.nextSibling) {
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

  // Translatable units, in document order: outermost inline-only elements
  // with text, plus any bare text node sitting directly inside an element
  // that is NOT such a block — the "Download for macOS" beside an <svg> icon,
  // which no element wraps on its own. An element marked data-i18n="skip"
  // (and everything under it) is left alone.
  function units(root) {
    var out = [];
    (function walk(el) {
      for (var n = el.firstChild; n; n = n.nextSibling) {
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

  // Kept for the extractor and anything else that only wants elements.
  function blocks(root) {
    var out = [];
    var u = units(root);
    for (var i = 0; i < u.length; i++) if (u[i].el) out.push(u[i].el);
    return out;
  }

  function key(el) {
    return norm(el.innerHTML);
  }

  function unitKey(u) {
    return u.el ? key(u.el) : norm(u.text.nodeValue);
  }

  // A text node keeps the whitespace it had on either side, so a label that
  // sat on its own line between an icon and a closing tag still does.
  function setText(node, value) {
    var v = node.nodeValue;
    var lead = /^\s/.test(v) ? " " : "";
    var trail = /\s$/.test(v) ? " " : "";
    node.nodeValue = lead + value + trail;
  }

  function apply(dict) {
    var us = units(document.body);
    for (var i = 0; i < us.length; i++) {
      var k = unitKey(us[i]);
      if (!Object.prototype.hasOwnProperty.call(dict, k)) continue;
      if (us[i].el) us[i].el.innerHTML = dict[k];
      else setText(us[i].text, dict[k]);
    }
    var title = document.querySelector("title");
    if (title && dict.__title) title.textContent = dict.__title;
    var desc = document.querySelector('meta[name="description"]');
    if (desc && dict.__description) desc.setAttribute("content", dict.__description);
  }

  function detect() {
    try {
      var stored = localStorage.getItem(STORAGE_KEY);
      if (stored && LANGS.indexOf(stored) !== -1) return stored;
    } catch (e) {}
    var nav = (navigator.language || "en").slice(0, 2).toLowerCase();
    return LANGS.indexOf(nav) !== -1 ? nav : "en";
  }

  // Each page has its own dictionary file so nobody downloads the front page
  // to read the contact page. The page is named by its stem.
  function pageStem() {
    var p = location.pathname.replace(/\/+$/, "");
    var last = p.split("/").pop() || "index";
    return last.replace(/\.html$/, "") || "index";
  }

  var cache = {};
  function load(lang) {
    if (lang === "en") return Promise.resolve(null);
    var url = "i18n/" + lang + "/" + pageStem() + ".json";
    if (cache[url]) return cache[url];
    cache[url] = fetch(url)
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; });
    return cache[url];
  }

  // Original English is restored from a snapshot so switching languages more
  // than once does not translate a translation.
  // Held as element references, not positions: an element survives having
  // its own innerHTML replaced, so the restore cannot drift even if a
  // translation changes what a later walk would count as a block.
  var snapshot = null;
  function restoreEnglish() {
    if (!snapshot) return;
    for (var i = 0; i < snapshot.units.length; i++) {
      var u = snapshot.units[i];
      if (u.el) u.el.innerHTML = u.html;
      else u.text.nodeValue = u.html;
    }
    var title = document.querySelector("title");
    if (title) title.textContent = snapshot.title;
    var desc = document.querySelector('meta[name="description"]');
    if (desc && snapshot.description != null) desc.setAttribute("content", snapshot.description);
  }
  function takeSnapshot() {
    if (snapshot) return;
    var desc = document.querySelector('meta[name="description"]');
    snapshot = {
      units: units(document.body).map(function (u) {
        return u.el ? { el: u.el, html: u.el.innerHTML } : { text: u.text, html: u.text.nodeValue };
      }),
      title: document.title,
      description: desc ? desc.getAttribute("content") : null,
    };
  }

  function markSwitch(lang) {
    var btns = document.querySelectorAll("[data-lang]");
    for (var i = 0; i < btns.length; i++) {
      var on = btns[i].getAttribute("data-lang") === lang;
      btns[i].classList.toggle("is-current", on);
      btns[i].setAttribute("aria-current", on ? "true" : "false");
    }
  }

  function setLang(lang, persist) {
    if (LANGS.indexOf(lang) === -1) lang = "en";
    takeSnapshot();
    if (persist) {
      try { localStorage.setItem(STORAGE_KEY, lang); } catch (e) {}
    }
    document.documentElement.lang = lang;
    markSwitch(lang);
    return load(lang).then(function (dict) {
      restoreEnglish();
      if (dict) apply(dict);
      document.documentElement.setAttribute("data-lang", lang);
      var notes = document.querySelectorAll(".i18n-note");
      for (var i = 0; i < notes.length; i++) notes[i].hidden = lang === "en";
    });
  }

  function wire() {
    var btns = document.querySelectorAll("[data-lang]");
    for (var i = 0; i < btns.length; i++) {
      btns[i].addEventListener("click", function (e) {
        e.preventDefault();
        setLang(this.getAttribute("data-lang"), true);
      });
    }
  }

  window.BettyI18n = {
    units: units, unitKey: unitKey, blocks: blocks, key: key, norm: norm,
    setLang: setLang, LANGS: LANGS,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () { wire(); setLang(detect(), false); });
  } else {
    wire();
    setLang(detect(), false);
  }
})();
