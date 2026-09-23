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
