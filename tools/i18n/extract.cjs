// Writes the English strings out as the reference dictionary, one entry per
// page, keyed by the same rule that swaps them in — so what is extracted is
// exactly what will be replaced.
//
// This used to load each page in Chromium and read the rendered DOM. It no
// longer does, and that is deliberate: the pages are now translated at build
// time by tools/i18n/prerender.cjs, which parses the HTML rather than running
// it. Two different parsers produced two different spellings of the same
// markup, and keys extracted by one would not match keys computed by the
// other. Both sides now use tools/i18n/dom-i18n.cjs, so they agree by
// construction.
//
// The cost of not running the page: text a script writes after load is not
// seen. The results table on performance.html is the only such case, and its
// names live under `categories` here instead, which the page's own script
// reads. Anything similar added later must do the same.
//
//   node tools/i18n/extract.cjs

const fs = require("fs");
const path = require("path");
const { parseHTML } = require("linkedom");
const D = require("./dom-i18n.cjs");

const SITE = path.join(__dirname, "..", "..");
const PAGES = ["index", "how-it-works", "performance", "blog", "cloud-terms", "contact"];

function main() {
  const previous = (() => {
    try {
      return JSON.parse(fs.readFileSync(path.join(SITE, "i18n-src", "en.json"), "utf8"));
    } catch (e) {
      return {};
    }
  })();

  const out = {};
  for (const page of PAGES) {
    const html = fs.readFileSync(path.join(SITE, `${page}.html`), "utf8");
    const { document } = parseHTML(html);

    const seen = new Map();
    for (const u of D.units(document.body)) {
      const k = D.unitKey(u);
      if (seen.has(k)) continue;
      const text = u.el ? u.el.textContent : u.text.nodeValue;
      seen.set(k, {
        tag: u.el ? u.el.tagName : "#text",
        words: D.norm(text).split(/\s+/).filter(Boolean).length,
      });
    }

    const desc = document.querySelector('meta[name="description"]');
    const titleEl = document.querySelector("title");
    out[page] = {
      title: titleEl ? D.norm(titleEl.textContent) : null,
      description: desc ? desc.getAttribute("content") : null,
      strings: [...seen.entries()],
    };

    /* Names for script-built content are not discoverable from the HTML, so
       they are carried forward rather than rediscovered. Losing them would
       silently drop their translations. */
    if (previous[page] && previous[page].categories) {
      out[page].categories = previous[page].categories;
    }

    const words = out[page].strings.reduce((n, [, m]) => n + m.words, 0);
    console.log(
      `${page.padEnd(14)} ${String(out[page].strings.length).padStart(4)} blocks ${String(words).padStart(6)} words`
    );
  }

  fs.mkdirSync(path.join(SITE, "i18n-src"), { recursive: true });
  fs.writeFileSync(path.join(SITE, "i18n-src", "en.json"), JSON.stringify(out, null, 1) + "\n");
  console.log("extract: wrote i18n-src/en.json");
}

main();
