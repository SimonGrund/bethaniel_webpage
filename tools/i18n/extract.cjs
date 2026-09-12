// Loads each site page in Chromium, runs the runtime's own block rule, and
// writes the English strings out as the reference dictionary per page —
// one JSON per page, keyed by normalised English, value English (to be
// replaced per language). Same rule as the runtime, so what is extracted is
// exactly what will be swapped.
const { app, BrowserWindow } = require("electron");
const fs = require("fs"), path = require("path");
const SITE = path.join(__dirname, "..", "..");
const PAGES = ["index", "how-it-works", "performance", "blog", "cloud-terms", "contact"];
const done = (c) => { try { app.exit(c); } catch { process.exit(c); } };
setTimeout(() => done(1), 120000);
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1200, height: 900, show: false,
    webPreferences: { offscreen: true, contextIsolation: false } });
  const out = {};
  for (const page of PAGES) {
    await win.loadFile(path.join(SITE, page + ".html"));
    await new Promise((r) => setTimeout(r, 800));
    const res = await win.webContents.executeJavaScript(`(() => {
      const I = window.BettyI18n;
      const us = I.units(document.body);
      const seen = new Map();
      for (const u of us) {
        const k = I.unitKey(u);
        const text = u.el ? u.el.textContent : u.text.nodeValue;
        if (!seen.has(k)) seen.set(k, { tag: u.el ? u.el.tagName : "#text", words: I.norm(text).split(" ").length });
      }
      const desc = document.querySelector('meta[name="description"]');
      return JSON.stringify({
        title: document.title,
        description: desc ? desc.getAttribute("content") : null,
        strings: [...seen.entries()],
      });
    })()`);
    const data = JSON.parse(res);
    out[page] = data;
    const words = data.strings.reduce((n, [, m]) => n + m.words, 0);
    console.log(`${page.padEnd(14)} ${String(data.strings.length).padStart(4)} blocks ${String(words).padStart(6)} words`);
  }
  fs.mkdirSync(path.join(SITE, "i18n-src"), { recursive: true });
  fs.writeFileSync(path.join(SITE, "i18n-src", "en.json"), JSON.stringify(out, null, 1) + "\n");
  done(0);
});
