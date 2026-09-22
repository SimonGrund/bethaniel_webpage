# Betty — things still to wire up

Contact address for anything on this site: **simon@bethaniel.eu**

---

## Still open

### 1. Open Graph image

`index.html` references `Public/logo-icon.svg` as the OG image, which won't render
well when the page is shared on social media (it expects a raster image).

- Create a `1200 × 630 px` PNG (e.g. in Figma or Canva — warm parchment bg, full logo centred)
- Save it as `Public/og-image.png`
- Update the `<meta property="og:image">` tag in `index.html` to point to it
- Add the same tag to `blog.html` and `contact.html`, which have no OG image at all

### 2. Verify the form pipes end to end

Neither path has been confirmed with a real submission:

- **Web3Forms** — send a test message from `/contact` and check it lands in
  simon@bethaniel.eu. If it doesn't, the destination on web3forms.com is set to
  something else (it's stored against the access key, not in this repo).
- **MailerLite** — subscribe with a throwaway address and check it appears in the
  list. The signup no longer uses MailerLite's `webforms.min.js`, so a broken
  endpoint would only show as the inline error state.

---

## Already wired up

Kept as a record of where each thing lives, so the next change doesn't start from scratch.

### Download links

Each download button points at `/api/download?asset=<id>` rather than a direct
GitHub URL. The function records the conversion, then redirects (302) to the
GitHub release asset — the redirect happens whether or not the recording
worked, so a database hiccup never costs a download. The bare href works with
no JavaScript at all; `js/campaign.js` only appends the campaign attribution to
it on click.

Asset ids and the GitHub URL each maps to live in `api/_lib/assets.js`:

- `mac-arm64` → `Bethaniel-mac-arm64.dmg` (Apple Silicon)
- `mac-x64` → `Bethaniel-mac-x64.dmg` (Intel)
- `win` → `Bethaniel-win.exe`
- `linux-appimage` → `Bethaniel-linux.AppImage`
- `linux-deb` → `Bethaniel-linux.deb`

An unknown or missing asset id falls back to the GitHub releases page rather
than erroring. Releases must keep publishing exactly those asset names, or the
`/api/download` links break.

The script at the bottom of `index.html` calls the GitHub API for the latest tag
and writes it into the "Current version" line. It's display only and unrelated
to the download hrefs above; it keeps working if the API call fails or is
rate-limited.

### Contact forms — Web3Forms

Four forms post to `https://api.web3forms.com/submit` with access key
`b737547c-8312-444e-882f-aca675c03139`:

| Form                      | File            |
| ------------------------- | --------------- |
| Download-modal signup     | `index.html`    |
| "For companies" enquiry   | `index.html`    |
| Contact page              | `contact.html`  |
| Blog page signup          | `blog.html`     |

The destination inbox is configured on web3forms.com against that key — it is
deliberately **not** in the HTML, since the key is public. To change where mail
lands, log in there; editing this repo won't do it.

### Mailing list — MailerLite

Account `2357986`, form `187808986448267201`.

Both signup forms post directly with `fetch` rather than loading MailerLite's
`webforms.min.js`. That script only binds forms inside `.ml-subscribe-form`, so
the download modal was never wired up, and when a tracker blocker stopped it
loading the native POST dumped the visitor on the raw JSONP endpoint. The
subscribe endpoint sends `Access-Control-Allow-Origin: *`, so posting it
directly is fine. Success and error states are rendered inline.

### Donation button — Ko-fi

`ko-fi.com/simongrundsorensen`, linked from the nav on all three pages plus the
donation section in `index.html`.

### Disclosure text

Written. Lives in the `<details class="disclosure-box">` block in `index.html`.

### Conversion tracking

Records which paid-ad campaign produced a download (`/api/download`) or an
enquiry (`/api/event`, beaconed from three form handlers) into a Neon Postgres
table, and shows the numbers on a password-gated `/stats` page. No pixels, no
cookies, no IP addresses, no user-agent strings, and no persistent visitor
identifier are stored — that absence is a deliberate legal position, not an
oversight. Read
`docs/superpowers/specs/2026-09-22-paid-ad-conversion-tracking-design.md`
(the "Privacy position" section especially) **before** adding any column or
field that could identify a visitor.

Two environment variables are required in Vercel:

- `DATABASE_URL` — the Neon connection string, injected automatically by the
  Neon Vercel integration. Nothing to set by hand.
- `STATS_PASSWORD` — the shared secret for `/stats`. Set this yourself in the
  Vercel project settings.

`db/schema.sql` is not run automatically — it's applied once by hand against
the Neon database (`psql "$DATABASE_URL" -f db/schema.sql` or pasted into
Neon's SQL editor) before the functions can write anything.

`db/prune.sql` deletes rows older than 400 days. There is **no cron job**
running it — it's a manual periodic task. Run it against Neon every so often
(quarterly is plenty); nothing breaks if it's skipped, the table just grows.

The dashboard lives at `/stats`, unlinked from any navigation.

### Vercel deployment

No longer a plain static site: `api/` holds serverless functions
(`download.js`, `event.js`, `stats.js`), and the repo now has one npm
dependency, `@neondatabase/serverless` (see `package.json`). The rest of the
site still deploys as static files. `vercel.json` sets `cleanUrls` so
`/contact` resolves without the `.html` extension.
