// Assembles the deployable site into dist/.
//
// Vercel serves dist/ rather than the repo root, because the translated
// pages are generated rather than committed. Serverless functions still
// come from api/ at the repo root — Vercel resolves those independently of
// outputDirectory. That assumption is load-bearing: if it ever stops
// holding, every download 404s.
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const DIST = path.join(ROOT, "dist");

/* Everything the browser can ask for. api/ is absent on purpose — Vercel
   picks functions up from the repo root, not from here. */
const COPY = [
  "index.html", "how-it-works.html", "performance.html",
  "blog.html", "cloud-terms.html", "contact.html", "stats.html",
  "style.css", "i18n.js", "robots.txt", "sitemap.xml",
  "Public", "js", "i18n",
];

function copy(from, to) {
  const stat = fs.statSync(from);
  if (stat.isDirectory()) {
    fs.mkdirSync(to, { recursive: true });
    for (const entry of fs.readdirSync(from)) copy(path.join(from, entry), path.join(to, entry));
  } else {
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
  }
}

function main() {
  fs.rmSync(DIST, { recursive: true, force: true });
  for (const entry of COPY) {
    const from = path.join(ROOT, entry);
    if (!fs.existsSync(from)) throw new Error(`build: missing ${entry}`);
    copy(from, path.join(DIST, entry));
  }
  console.log(`build: copied ${COPY.length} entries into dist/`);
}

main();
