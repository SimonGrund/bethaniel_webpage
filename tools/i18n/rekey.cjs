// Re-files each translation under the key this codebase now produces.
//
// The dictionaries were originally keyed by Chrome's innerHTML, via an
// Electron extractor. Nothing but Chrome reproduces that exactly, and the
// pages are now rendered in Node — so the keys have to come from the same
// module that renders them. This runs once to move the existing translations
// across. The translated text is never altered; only the key it is filed
// under, and the sha1 of that key in i18n-src/<lang>.txt.
//
//   node tools/i18n/rekey.cjs            report only, writes nothing
//   node tools/i18n/rekey.cjs --write    apply it
//
// It refuses to write if any translation cannot be mapped. Guessing here
// would file one string's translation under another's key, and nobody
// reviewing the English would ever notice.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { parseHTML } = require("linkedom");
const D = require("./dom-i18n.cjs");

const ROOT = path.join(__dirname, "..", "..");
const LANGS = ["da", "de", "es", "fr"];
const PAGES = ["index", "how-it-works", "performance", "blog", "cloud-terms", "contact"];
const hash = (k) => crypto.createHash("sha1").update(k).digest("hex").slice(0, 8);

/* Text content is the one thing both parsers agree on, so it bridges an old
   key to a new one even when the markup around it serialises differently. */
function textOf(html) {
  const { document } = parseHTML(
    `<!doctype html><html><body><div id="x">${html}</div></body></html>`
  );
  return D.norm(document.getElementById("x").textContent);
}

function newUnitsFor(page) {
  const html = fs.readFileSync(path.join(ROOT, `${page}.html`), "utf8");
  const { document } = parseHTML(html);
  const seen = new Set();
  const out = [];
  for (const u of D.units(document.body)) {
    const key = D.unitKey(u);
    if (seen.has(key)) continue;          // the extractor dedupes; match it
    seen.add(key);
    out.push({
      key,
      tag: u.el ? u.el.tagName : (u.text.parentNode && u.text.parentNode.tagName) || "TEXT",
      words: D.norm(u.el ? u.el.textContent : u.text.nodeValue).split(/\s+/).filter(Boolean).length,
    });
  }
  return out;
}

function mapKeys(oldKeys, newKeys) {
  const mapping = new Map();
  const taken = new Set();
  const how = new Map();

  for (const k of oldKeys) {
    if (newKeys.includes(k) && !taken.has(k)) {
      mapping.set(k, k); taken.add(k); how.set(k, "exact");
    }
  }

  const byText = new Map();
  for (const nk of newKeys) {
    if (taken.has(nk)) continue;
    const t = textOf(nk);
    if (byText.has(t)) byText.set(t, null);   // ambiguous — refuse rather than guess
    else byText.set(t, nk);
  }
  for (const k of oldKeys) {
    if (mapping.has(k)) continue;
    const hit = byText.get(textOf(k));
    if (hit && !taken.has(hit)) {
      mapping.set(k, hit); taken.add(hit); how.set(k, "text");
    }
  }

  /* Whatever is left is matched by position in the walk, and only when
     exactly as many remain on each side. Anything less certain is reported. */
  const leftOld = oldKeys.filter((k) => !mapping.has(k));
  const leftNew = newKeys.filter((k) => !taken.has(k));
  if (leftOld.length && leftOld.length === leftNew.length) {
    leftOld.forEach((k, i) => { mapping.set(k, leftNew[i]); how.set(k, "position"); });
  }

  return {
    mapping, how,
    unmapped: oldKeys.filter((k) => !mapping.has(k)),
    orphanNew: newKeys.filter((k) => ![...mapping.values()].includes(k)),
  };
}

function main(write) {
  const en = JSON.parse(fs.readFileSync(path.join(ROOT, "i18n-src", "en.json"), "utf8"));
  const plans = {};
  const tally = { exact: 0, text: 0, position: 0 };
  let blocked = false;

  for (const page of PAGES) {
    const oldKeys = en[page].strings.map(([k]) => k);
    const units = newUnitsFor(page);
    const r = mapKeys(oldKeys, units.map((u) => u.key));

    /* The results table on /performance is built by a script after load, so
       its rows never appear in the static HTML and cannot be prerendered.
       Their names are lifted into __categories, which the page's script
       reads; the bare percentages need no translation at all. Both are
       filtered out here rather than reported as failures. */
    r.categories = [];
    r.unmapped = r.unmapped.filter((k) => {
      const row = k.match(/^(.+?)<em>n=/);
      if (row) { r.categories.push({ key: k, name: row[1] }); return false; }
      if (/^\d+%$/.test(k)) return false;
      return true;
    });
    for (const k of oldKeys) if (r.how.get(k)) tally[r.how.get(k)] += 1;
    plans[page] = { ...r, units, oldKeys };

    console.log(
      `${page}: ${oldKeys.length} old, ${units.length} new, ${r.mapping.size} mapped` +
      (r.unmapped.length ? `, ${r.unmapped.length} UNMAPPED` : "") +
      (r.orphanNew.length ? `, ${r.orphanNew.length} new-without-translation` : "")
    );
    for (const k of r.unmapped) console.log(`    UNMAPPED ${JSON.stringify(k.slice(0, 100))}`);
    if (r.unmapped.length) blocked = true;
  }

  console.log(`\nmapped by: exact ${tally.exact}, text ${tally.text}, position ${tally.position}`);

  if (blocked) {
    console.error("\nrekey: some translations could not be mapped. Nothing written.");
    process.exit(1);
  }
  if (!write) {
    console.log("\nrekey: report only. Re-run with --write to apply.");
    return;
  }

  /* en.json: same pages, same order, keys swapped and metadata recomputed.
     Entries the DOM no longer holds are dropped from strings; the category
     names among them move to __categories. */
  for (const page of PAGES) {
    const { mapping, units, categories } = plans[page];
    if (categories.length) {
      en[page].categories = categories.map((c) => c.name);
    }
    const byKey = new Map(units.map((u) => [u.key, u]));
    en[page].strings = en[page].strings
      .filter(([k]) => mapping.has(k))
      .map(([k]) => {
        const nk = mapping.get(k);
        const u = byKey.get(nk);
        return [nk, { tag: u.tag, words: u.words }];
      });
  }
  fs.writeFileSync(path.join(ROOT, "i18n-src", "en.json"), JSON.stringify(en, null, 2) + "\n");
  console.log("rekey: rewrote i18n-src/en.json");

  /* Each language source: the #! English line and the hash both follow the
     new key. The translation after the pipe is copied across untouched. */
  for (const lang of LANGS) {
    const file = path.join(ROOT, "i18n-src", `${lang}.txt`);
    const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
    const out = [];
    let page = null;
    for (const line of lines) {
      const sec = line.match(/^## (.+)$/);
      if (sec) { page = sec[1].trim(); out.push(line); continue; }
      if (line.startsWith("#! ")) continue;              // rewritten alongside its hash
      const m = line.match(/^([0-9a-f]{8}|__title|__description) \| (.*)$/);
      if (!m) { out.push(line); continue; }
      if (m[1].startsWith("__")) { out.push(line); continue; }
      const plan = plans[page];
      const oldKey = plan.oldKeys.find((k) => hash(k) === m[1]);
      if (!oldKey) { out.push(line); continue; }          // unknown hash: leave as-is

      /* A JS-built table row keeps only its name, under a key the page's
         script can look up. A bare percentage is dropped: it is a number. */
      const cat = plan.categories.find((c) => c.key === oldKey);
      if (cat) {
        const translated = (m[2].match(/^(.+?)<em>/) || [null, m[2]])[1].trim();
        out.push(`#! __category ${cat.name}`);
        out.push(`${hash("__category " + cat.name)} | ${translated}`);
        continue;
      }
      if (!plan.mapping.has(oldKey)) continue;            // dropped (percentages)

      const newKey = plan.mapping.get(oldKey);
      out.push(`#! ${newKey}`);
      out.push(`${hash(newKey)} | ${m[2]}`);
    }
    fs.writeFileSync(file, out.join("\n"));
    console.log(`rekey: rewrote i18n-src/${lang}.txt`);
  }
}

module.exports = { textOf, mapKeys, newUnitsFor };
if (require.main === module) main(process.argv.includes("--write"));
