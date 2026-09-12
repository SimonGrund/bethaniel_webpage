# Site translations

The English in the HTML is the source. `i18n.js` swaps each translatable
block for its entry in `i18n/<lang>/<page>.json`, keyed by the normalised
English. Nothing in the markup is annotated; a block with no translation
stays English.

Blog post bodies and the cloud terms are deliberately not translated
(`data-i18n="skip"` on their containers): one is the author's own voice, the
other is the binding legal text. Their chrome translates and a note says the
body is English.

## After changing English copy

1. Re-extract the English (needs Electron — run from the Bethaniel repo,
   or `npx electron` anywhere):

       npx electron tools/i18n/extract.cjs

2. See what each language is now missing, in paste-ready form:

       node tools/i18n/build.cjs --missing da

   Each entry is the English (`#!` line) followed by `<hash> | ` — fill in
   the translation after the bar and paste under the right `## page` in
   `i18n-src/da.txt`. Entries are keyed by a hash of the English, so their
   order in the file does not matter, and a rewritten English sentence shows
   up as missing rather than silently keeping a stale translation.

3. Build:

       node tools/i18n/build.cjs da de es fr

   It warns if a translation's inline tags (`<a>`, `<strong>` …) differ from
   the English, and if an entry no longer matches any English on the page.

Strings that are the same in every language — numbers, "Betty", "GitHub" —
are simply left out. Dynamic text set by script (the version tag) is kept out
of the translatable blocks by construction; see the comment on `#versionLine`.
