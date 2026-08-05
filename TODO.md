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

Point at GitHub releases on `SimonGrund/bethaniel`, with fixed asset names:

- `Bethaniel-mac.dmg`
- `Bethaniel-win.exe`
- `Bethaniel-linux.AppImage`
- `Bethaniel-linux.deb`

The script at the bottom of `index.html` calls the GitHub API for the latest tag
and writes it into the "Current version" line. It's display only — the hrefs are
static and use GitHub's `releases/latest/download/…` redirect, so they keep
working if the API call fails or is rate-limited. Keep publishing releases with
exactly those asset names.

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

### Vercel deployment

Deployed as a plain static site from the repo root. `vercel.json` sets
`cleanUrls` so `/contact` resolves without the `.html` extension.
