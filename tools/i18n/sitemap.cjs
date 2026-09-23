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
