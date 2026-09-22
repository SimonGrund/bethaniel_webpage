# Paid-ad conversion tracking

**Date:** 2026-09-22
**Status:** Approved, ready for implementation planning

## Problem

The site runs no analytics of any kind. Paid ads are about to run on Google Ads,
Meta and Reddit/X/LinkedIn, and there is currently no way to tell which campaign
produced a download or an enquiry.

## Decisions taken

These were settled during brainstorming and are not open for re-litigation
during implementation:

| Decision | Choice | Consequence accepted |
| --- | --- | --- |
| Ad platforms | Google Ads, Meta, Reddit/X/LinkedIn | Multi-platform click IDs must all be captured |
| Conversions counted | Download click, contact/companies enquiry | Mailing-list signups and app first-run are explicitly out of scope |
| Third-party pixels | **None** | Ad platforms cannot auto-optimise bidding; campaigns are tuned manually from the stats page |
| Consent banner | **Not needed**, because nothing personal is stored | Constrains what may be written to the database — see Privacy |
| Collector | Self-built Vercel function | We own storage, retention and reporting |
| Reporting | Password-protected `/stats` page | Roughly a day of work beyond the raw endpoint |
| Download capture | Server-side redirect through `/api/download` | Adds a hop to the download path; needs a fallback |
| Tests | Minimal `node --test` suite | Introduces `package.json` to a previously dependency-free repo |

## Privacy position

The design is consent-free only because it stores no personal data and sets no
persistent identifier. Specifically:

- Attribution lives in **`sessionStorage`**, never a cookie or `localStorage`.
  No identifier survives the browser session.
- **No IP address, no user-agent string, no visitor or device ID is stored.**
  Country comes from Vercel's `x-vercel-ip-country` header; operating system is
  reduced to a coarse bucket (`mac` / `windows` / `linux` / `other`).
- Data is first-party, aggregate, and never shared with or sent to any ad
  platform.

This keeps the site within the recognised audience-measurement exemption from
prior consent. **Any change that adds a persistent identifier, stores an IP, or
forwards data to a third party invalidates this position and requires the
consent question to be reopened.**

The accepted cost: a visitor who clicks an ad on Monday and downloads on
Thursday is recorded as direct traffic. For download-on-first-visit — the
common case — attribution is accurate.

## Architecture

```
Visitor lands with ?utm_source=google&gclid=…
        │
        ▼
  inline <head> script  ──▶  sessionStorage["betty_attr"]
        │
        ├── js/track.js appends &a=<encoded attr> to every /api/download href
        │
        ▼                                      ▼
  /api/download?asset=…&a=…            /api/event  (sendBeacon, forms only)
        │  log, then 302 regardless           │  validate, log, 204
        ▼                                      ▼
  GitHub release asset              Neon Postgres · events table
                                               │
                                               ▼
                                     /api/stats ◀── /stats page (password)
```

### Component 1 — Attribution capture

An inline script in the `<head>` of every page (`index`, `how-it-works`,
`performance`, `blog`, `contact`, `cloud-terms`). Inline and in `<head>` so it
runs before any click is possible and needs no network round-trip.

Reads from `location.search`:

- UTM fields: `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`
- Click IDs: `gclid`, `fbclid`, `rdt_cid`, `li_fat_id`, `twclid`, `msclkid`

Writes a single JSON object to `sessionStorage` under `betty_attr`:

```json
{
  "source": "google", "medium": "cpc", "campaign": "…",
  "content": null, "term": null,
  "click_id": "Cj0KCQ…", "click_platform": "google",
  "landing_path": "/", "referrer_host": "google.com"
}
```

Rules:

- **Last touch wins.** If a page load carries any UTM or click-ID param, it
  overwrites whatever was stored. A load with no params leaves the store alone.
- `click_platform` is derived from which click-ID param was present.
- `referrer_host` is the hostname only, captured on the landing page, and only
  when it is not the site's own host.
- Every value is truncated to 200 characters before storage.
- All reads and writes are wrapped so that a browser with storage disabled
  degrades to no attribution rather than throwing.

### Component 2 — `js/track.js`

One new file alongside the existing `i18n.js`. Responsibilities:

1. **Rewrite download hrefs on load.** Every `a[data-dl-asset]` gets
   `?asset=<id>&a=<encoded>` appended, where `<encoded>` is the base64url of the
   attribution JSON. Runs on `DOMContentLoaded`.
2. **Expose `Betty.track(event, props)`** — `navigator.sendBeacon('/api/event', …)`
   with the attribution merged in, falling back to `fetch(…, {keepalive:true})`
   where `sendBeacon` is unavailable.

The file must not throw under any circumstance; the whole body is guarded.

### Component 3 — Download links

Each installer link changes from a direct GitHub URL to:

```html
<a href="/api/download?asset=mac-arm64"
   data-dl-asset="mac-arm64"
   data-fallback="https://github.com/SimonGrund/bethaniel/releases/latest/download/Bethaniel-mac-arm64.dmg">
```

Asset IDs: `mac-arm64`, `mac-x64`, `win`, `linux-appimage`, `linux-deb`.

Links needing this treatment in `index.html`:

- The five buttons in `.hero__downloads`
- The `#dl-mac-intel-alt` and `#dl-mac-silicon-alt` fallback links

The download version-resolver script at the foot of `index.html` needs **no**
change. Its surrounding comment implies it fills in the hrefs, but it only
writes the tag name into the "Current version" line.

Without JavaScript the bare `/api/download?asset=…` href still works and logs an
unattributed download.

### Component 4 — `/api/download.js`

```
GET /api/download?asset=<id>&a=<base64url>
```

1. Look up `asset` in a **hardcoded** id-to-URL table. Unknown or missing id →
   302 to the GitHub releases page. **A URL is never taken from the query
   string** — that would be an open redirect.
2. Decode `a` if present; treat any decode failure as absent attribution.
3. Insert the event row with a **250 ms timeout**.
4. **302 to the GitHub asset URL regardless of whether step 3 succeeded**, with
   `Cache-Control: no-store`.

Step 4 is the load-bearing rule of this design. Neon's free tier auto-suspends
when idle, so a cold start can take a second or more; tracking must never sit on
the critical path of a download. Insert failures are logged to the function's
stderr and dropped.

### Component 5 — `/api/event.js`

```
POST /api/event   { "event": "enquiry", "props": {"form":"companies"}, "attr": {…} }
```

- Method must be POST; anything else → 405.
- `Origin` header must match the site's own domains → otherwise 403.
- `event` must be in the allowlist `["download", "enquiry"]` → otherwise 400.
- `props.form` must be in `["companies", "contact", "contact-modal"]`.
- Every string field truncated to 200 characters.
- Returns **204 with no body**, always — the client never acts on the response.

Accepted risk: this is a public unauthenticated endpoint, so a determined person
could inject junk rows. Given the data's low value, strict validation and the
origin check are considered sufficient; no rate limiting is built.

### Component 6 — Form instrumentation

Three existing handlers gain one line on their success path, after Web3Forms
returns OK:

| Form | File | Call |
| --- | --- | --- |
| "For companies" enquiry | `index.html` (`#companyForm`) | `Betty.track('enquiry', {form:'companies'})` |
| Contact modal | `index.html` (`#contactForm`) | `Betty.track('enquiry', {form:'contact-modal'})` |
| Contact page | `contact.html` | `Betty.track('enquiry', {form:'contact'})` |

Note: `index.html` and `contact.html` both use `id="contactForm"`, for the modal
and the page form respectively. They are in separate files so this is harmless,
but the two handlers must be given different `form` values as above — do not
assume one shared handler covers both.

The download-modal and blog mailing-list signups are **not** instrumented —
mailing-list signups are out of scope by decision.

### Component 7 — Storage

Neon Postgres, provisioned through the Vercel Marketplace (Vercel's own Postgres
was sunset in December 2024). The free tier — 0.5 GB, 100 compute-hours per
month — is ample. The connection string arrives as an injected env var.

```sql
create table events (
  id             bigserial primary key,
  occurred_at    timestamptz not null default now(),
  event          text not null,
  asset          text,
  form           text,
  source         text,
  medium         text,
  campaign       text,
  content        text,
  term           text,
  click_id       text,
  click_platform text,
  landing_path   text,
  referrer_host  text,
  country        text,
  ua_platform    text
);
create index events_occurred_at_idx on events (occurred_at);
create index events_event_idx on events (event, occurred_at);
```

The schema is applied as a checked-in `db/schema.sql`, run manually once against
Neon. No migration tooling — this is one table.

**Retention:** `db/prune.sql` contains a one-line delete of rows older than 400
days, documented in `TODO.md` as a manual periodic task. No cron job is built;
it can be promoted to a Vercel cron later if it proves annoying.

### Component 8 — `/stats`

**`stats.html`** — a static page in the site's existing visual language
(parchment background, Cormorant Garamond headings, Inter body). Not linked from
any navigation. English only — it stays out of the i18n build by not being added
to the `PAGES` allowlist in `tools/i18n/extract.cjs`.

Flow: the page prompts for a password, posts it to `/api/stats`, holds it in
`sessionStorage` so reloads don't re-prompt, and renders whatever the API
returns. A wrong password shows an inline error.

**`/api/stats.js`** — POST with `{password, from, to}`. Compares the password
against `process.env.STATS_PASSWORD` using `crypto.timingSafeEqual`. On mismatch,
403 after a fixed short delay.

Honest framing: this is a shared secret guarding low-sensitivity aggregate
counts, not an authentication system. It is adequate for what it protects.

Returns, for the requested range:

- Totals: downloads, enquiries
- Breakdown by `source` / `medium` / `campaign`, with both counts per row
- Breakdown by `asset`
- Daily series for the trend line

The page offers 7 / 30 / 90 day presets plus a custom range. Dates are validated
server-side; an invalid or inverted range → 400.

## Testing

A minimal `node --test` suite. This introduces `package.json` to a repo that has
had none — accepted deliberately.

Dependencies are held to exactly one: **`@neondatabase/serverless`**, used for
its `neon()` HTTP tagged-template API. Single-shot queries over HTTP suit
serverless functions far better than a TCP pool, which would otherwise exhaust
connections across concurrent invocations. There are **no dev dependencies** —
the test runner is Node's built-in `node --test`, and every tested module in
`api/_lib/` is pure logic with no database import, so the suite runs without a
database or a network.

Pure logic is extracted into `api/_lib/` so it can be tested without a server or
a database:

| Module | Tested behaviour |
| --- | --- |
| `_lib/attribution.js` | Parsing UTM and click-ID params; last-touch overwrite; truncation; platform derivation; malformed input |
| `_lib/assets.js` | Asset-id to URL mapping; unknown id falls back to the releases page; no query-string URL is ever honoured |
| `_lib/validate.js` | Event allowlist; form allowlist; field truncation; rejection of bad shapes |
| `_lib/aggregate.js` | Grouping and date-range shaping of rows into the stats response |

Not covered by automated tests, verified manually and recorded in the plan:

- The 302 actually lands on the right GitHub asset for all five installers
- A beacon fires on each of the three forms
- The download still works with JavaScript disabled
- The download still works when the database is unreachable

## Out of scope

- Mailing-list signups as a conversion
- App install / first-run telemetry (lives in the app repo, not here)
- Any third-party pixel or tag
- Ko-fi donation tracking
- Rate limiting on `/api/event`
- Automated retention cron

## Files touched

**New:** `js/track.js`, `api/download.js`, `api/event.js`, `api/stats.js`,
`api/_lib/{attribution,assets,validate,aggregate,db}.js`, `db/schema.sql`,
`db/prune.sql`, `stats.html`, `package.json`, `test/*.test.js`

**Modified:** `index.html` (head script, download hrefs, two form handlers), `contact.html` (head script, form handler), `how-it-works.html`,
`performance.html`, `blog.html`, `cloud-terms.html` (head script only), `TODO.md`

`tools/i18n/extract.cjs` needs **no change**: its `PAGES` array is an explicit
allowlist, so `stats.html` stays out of the i18n build simply by not being added
to it.

## Environment variables

| Name | Purpose |
| --- | --- |
| `DATABASE_URL` | Neon connection string, injected by the Vercel integration |
| `STATS_PASSWORD` | Shared secret for the `/stats` page |
