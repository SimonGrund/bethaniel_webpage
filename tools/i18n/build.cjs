// Assembles i18n/<lang>/<page>.json from the extracted English (en.json) and
// a per-language source file keyed by a short hash of the English:
//
//   ## index
//   __title | Betty — din private korrekturlæser
//   #! Stay in the loop                  <- the English, for the reader
//   f54254af | Hold dig opdateret        <- sha1(English)[:8] | translation
//
// Keying on the English rather than its position means the sources survive
// any reordering or insertion in the pages; a string with no entry simply
// falls back to English at runtime.
//
//   node tools/i18n/build.cjs da de es fr        build
//   node tools/i18n/build.cjs --missing da       list English with no da entry,
//                                                in paste-ready form
const fs = require("fs"), path = require("path"), crypto = require("crypto");
const SITE = path.join(__dirname, "..", "..");
const en = require(path.join(SITE, "i18n-src", "en.json"));
const OUT = path.join(SITE, "i18n");
const hash = (k) => crypto.createHash("sha1").update(k).digest("hex").slice(0, 8);
const args = process.argv.slice(2);
const missingMode = args[0] === "--missing";
const langs = missingMode ? args.slice(1) : args;

function parse(lang) {
  const src = fs.readFileSync(path.join(SITE, "i18n-src", lang + ".txt"), "utf8");
  let page = null;
  const byPage = {};
  let lineNo = 0;
  for (const raw of src.split(/\r?\n/)) {
    lineNo++;
    const line = raw.trimEnd();
    if (!line.trim() || line.startsWith("#!")) continue;
    const h = line.match(/^##\s+(\S+)/);
    if (h) { page = h[1]; byPage[page] = byPage[page] || {}; continue; }
    if (!page) throw new Error(`${lang}.txt:${lineNo}: text before any ## page`);
    const m = line.match(/^(__title|__description|[0-9a-f]{8})\s*\|\s?(.*)$/);
    if (!m) throw new Error(`${lang}.txt:${lineNo}: unparsable: ${line.slice(0, 60)}`);
    byPage[page][m[1]] = m[2];
  }
  return byPage;
}

const tags = (s) => (s.match(/<[a-z][^>]*>/gi) || []).map((t) => t.replace(/\s+/g, " ")).sort().join("");

for (const lang of langs) {
  const byPage = parse(lang);
  if (missingMode) {
    for (const [pg, { strings }] of Object.entries(en)) {
      const have = byPage[pg] || {};
      const miss = strings.filter(([k]) => !(hash(k) in have));
      if (!miss.length) continue;
      console.log(`## ${pg}`);
      if (!have.__title) console.log(`__title | ${en[pg].title}`);
      if (!have.__description && en[pg].description) console.log(`__description | ${en[pg].description}`);
      for (const [k] of miss) console.log(`#! ${k}\n${hash(k)} | `);
    }
    continue;
  }
  let total = 0;
  for (const [pg, { strings }] of Object.entries(en)) {
    const have = byPage[pg] || {};
    const dict = {};
    for (const [k] of strings) {
      const t = have[hash(k)];
      if (t == null) continue;
      if (tags(k) !== tags(t)) {
        console.warn(`  WARN ${lang}/${pg}: inline tags differ\n     en: ${k.slice(0, 90)}\n     ${lang}: ${t.slice(0, 90)}`);
      }
      dict[k] = t;
    }
    if (have.__title) dict.__title = have.__title;
    if (have.__description) dict.__description = have.__description;
    // Entries whose English no longer exists on the page are reported, not
    // silently dropped — that is how a rewritten sentence loses its translation.
    const known = new Set(strings.map(([k]) => hash(k)));
    for (const hk of Object.keys(have)) {
      if (!hk.startsWith("__") && !known.has(hk)) console.warn(`  WARN ${lang}/${pg}: entry ${hk} matches no English on the page (stale?)`);
    }
    fs.mkdirSync(path.join(OUT, lang), { recursive: true });
    fs.writeFileSync(path.join(OUT, lang, pg + ".json"), JSON.stringify(dict, null, 1) + "\n");
    const n = Object.keys(dict).filter((k) => !k.startsWith("__")).length;
    total += n;
    console.log(`  ${lang}/${pg.padEnd(13)} ${String(n).padStart(4)} / ${strings.length}`);
  }
  console.log(`${lang}: ${total} strings`);
}
