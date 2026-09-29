# First-party newsletter, with a welcome discount

**Date:** 2026-09-29
**Status:** Implemented on branch `newsletter`; needs the one-off setup under "Setup" before it can go live

## Problem

A visitor on a phone cannot use Betty — she is a desktop program — and the
phone note's only offer is "Send yourself the link" through the share sheet.
That moment, a person who has just tapped Download, leaves nothing behind.

Separately, the mailing list lives in MailerLite: a second place where
subscribers are kept, a JSONP form endpoint that tracker blockers break, and
no way to tie a signup to anything the site does — such as a discount.

## What ships

1. **Phone note → email capture.** On a phone the note asks for an email
   address. Betty's link arrives at once; ticking a box also subscribes the
   address to the newsletter and puts a single-use 50% code in the same email.
2. **Every signup form on the site posts to our own endpoint**, not
   MailerLite. The download modal and the "Notes from Betty" section send the
   same welcome email with the code.
3. **`/admin`**, behind Google sign-in: subscribers (list, search, export,
   import, delete), newsletters (write in Markdown, pick a theme, preview,
   send a test to yourself, schedule or send now), and discount codes (the
   welcome-offer switch, and minting codes by hand).
4. **`/privacy`**, a privacy policy centred on the newsletter, linked from
   every footer, the signup forms and every email; and a discount-code
   clause (8.2) in the cloud terms.

## Decisions taken

| Decision | Choice | Consequence accepted |
| --- | --- | --- |
| Subscriber store | Neon, new tables beside `events` | We are now the data controller for an email list; see Privacy |
| Sending | Resend, over its HTTP API | One more processor; domain needs SPF/DKIM/DMARC records |
| Admin auth | Google sign-in, allowlisted by `ADMIN_EMAILS` | Needs a Google OAuth client; the `/stats` password is not reused |
| Gmail as sender | **No** | Consumer caps, no bulk headers, and it would put the personal mailbox's reputation on the line |
| The link without the newsletter | **Always available** | Making the newsletter the price of the link would be bundled consent; the link-only email is sent and the address is not stored |
| Consent | Double opt-in for the newsletter | Newsletters go only to confirmed addresses — see "The welcome email" for how that squares with an immediate code |
| Discount | One Stripe promotion code per address, `max_redemptions: 1`, under one hand-made coupon | Which jobs it covers is set on the coupon in Stripe, not here |
| Scheduling | A cron endpoint, called every 15 minutes by a GitHub Actions workflow | Works on Vercel Hobby; GitHub runs schedules best-effort, so "09:00" means "09:00 to about 09:30" |
| Function count | Four new functions, actions multiplexed by `?action=` | Stays well under Hobby's 12-function limit (8 total) |
| Open/click tracking | **None** | Consistent with the site's no-identifier stance; reach is measured by sends, bounces and unsubscribes only |
| Newsletter language | Written by hand; a newsletter may be limited to one language's subscribers | No machine translation of newsletters |

## The welcome email

The user asked for the code to arrive immediately. Double opt-in normally
withholds everything until the click. The two are reconciled like this:

- On signup the address is stored as `pending`, a code is minted, and **one**
  email goes out at once: the link to Betty, the code, and a "Yes, send me the
  newsletter" button.
- The code is not a newsletter; handing it over requires no consent. Anyone
  who can read that inbox can use it, which is the only ownership check the
  code needs.
- **Newsletters go only to `confirmed` addresses.** An address typed in by
  someone else receives one email, with an unsubscribe link, and nothing more.
- Resubmitting the same address never mints a second code (unique on email,
  code stored on the row) and never re-sends the welcome within 10 minutes.

Confirm and unsubscribe links land on a page with a button rather than acting
on GET: mail scanners (Outlook Safe Links and others) fetch every link in a
message, and would otherwise confirm or unsubscribe on the reader's behalf.
The one-click `List-Unsubscribe-Post` header is the exception — a POST, as
RFC 8058 intends, which scanners do not make.

## Privacy

The analytics position in `2026-09-22-paid-ad-conversion-tracking-design.md`
is about visitors, and is unchanged: nothing here writes to `events`, and no
subscriber row is joined to an event row. The newsletter is a separate,
consented processing with its own rules:

- Stored per subscriber: email, language, where they signed up (`phone`,
  `download`, `footer`, `import`), status, the discount code, a random token
  for confirm/unsubscribe links, and timestamps. No IP, no user-agent.
- An unsubscribe keeps the row, with status `unsubscribed`, so the address is
  suppressed rather than re-imported. **Delete** in `/admin` removes it
  entirely — that is the erasure request path.
- Processors: Neon (storage, EU region recommended), Vercel (functions),
  Resend (sending), Stripe (the promotion code carries the subscriber id as
  metadata, not the email address).
- **`/privacy`** says all of this to the subscriber, and names every
  processor. It promises three things the code must keep true: no cookies on
  the public site, no open or click tracking (Resend's tracking must stay off
  for the domain), and deletion of never-confirmed addresses after 90 days
  (done by `/api/cron` on every run).
- The three pages that loaded Google Fonts (cloud terms, how it works,
  performance) now load the same faces from Bunny Fonts, like the rest of the
  site, so the policy can name one font service.

## Architecture

```
phone note / modal / footer ──POST /api/newsletter?action=subscribe──┐
                                                                      │ upsert subscriber (pending)
                                                                      │ mint code (Stripe) if none
                                                                      └ welcome email (Resend)

email link ──GET /api/newsletter?action=confirm&t=…──► page with button ──POST──► confirmed
email link ──GET /api/newsletter?action=unsubscribe&t=…──► page ──POST──► unsubscribed
mail client one-click ──POST /api/newsletter?action=unsubscribe&t=…──► unsubscribed

/admin (static) ──fetch /api/admin?action=…──► session cookie checked on every call
Google ──/api/admin?action=callback──► signed session cookie (12 h)

GitHub Actions, every 15 min ──POST /api/cron (Bearer CRON_SECRET)──► send due campaigns
Resend ──POST /api/mail-webhook (Svix-signed)──► bounces and complaints suppress the address
```

### Tables — `db/2026-09-29-newsletter.sql`

- `subscribers` — unique on lower-cased email.
- `campaigns` — subject, preheader, Markdown body, theme, optional language,
  status `draft → scheduled → sending → sent`, `send_at`, and a short
  `lease_until` so the cron and a "Send now" in the browser cannot send the
  same campaign at once.
- `deliveries` — one row per (campaign, subscriber) actually handed to Resend.
  Sending picks the next 100 confirmed subscribers with no delivery row, so a
  send interrupted by a timeout resumes where it stopped. Each batch also
  carries a Resend `Idempotency-Key` derived from the campaign and the batch's
  subscriber ids, which covers the gap between "Resend accepted it" and "the
  delivery rows were written".

### Themes

Email clients ignore most modern CSS, Outlook most of all, so a theme is not
free-form design: it is a palette, a heading face (with Georgia as the
fallback nearly everyone will see), an ornament and a masthead line, applied
to one tested table layout with inline styles. Four ship — **Parchment** (the
site), **Ink** (dark), **Olive** and **Midnight** (the navy). Adding one is a
single entry in `api/_lib/email-render.js`.

### Admin auth

OAuth 2.0 authorization-code flow, done by hand (no library): a random
`state` in a short-lived cookie, the code exchanged server-side, the ID token
read from Google's token response — which arrives over TLS directly from
Google, so its signature need not be re-verified — and the email accepted only
if `email_verified` and listed in `ADMIN_EMAILS`. The session is an
HMAC-signed cookie (`HttpOnly; Secure; SameSite=Lax`), and every mutating admin
call also checks `Origin` against the host.

## The welcome-offer switch

A `settings` row, `welcome_discount`, flipped in `/admin → Discount codes`.
Off means: no new welcome codes are minted, and the welcome email has no code
section. A code already on a subscriber's row is theirs and is still sent.

The site's wording follows the switch. Every phrase that promises the code is
marked `data-offer="on"` and has a plain twin marked `data-offer="off"`;
`js/newsletter.js` asks `GET /api/newsletter?action=offer` (edge-cached for a
minute) and only then shows the promising version. A failed read shows the
plain one — the site never promises a code that will not come.

## Codes minted from /admin

Minting by hand was judged safe enough to build, because of what it cannot
do: **it cannot create coupons.** Every code is minted under a coupon that
already exists in Stripe, so the most `/admin` can give away is discounts
already defined there. Beyond that:

- At most 50 codes per mint and 1,000 uses per code.
- A coupon worth 100% asks a second time, on the button, and the API refuses
  it without that confirmation.
- Each code carries `minted_by` (the admin's Google address) and a note in
  its Stripe metadata, and is recorded in `promo_codes`.
- Any code can be deactivated from the same page; usage is read live from
  Stripe.
- The Stripe key should be restricted to **Coupons: read** and **Promotion
  codes: write** — nothing else in the account is then reachable from here.

## Setup (one-off, by hand)

1. Run `db/2026-09-29-newsletter.sql` against Neon.
2. **Resend:** add and verify `bethaniel.eu` (SPF, DKIM, and a DMARC record if
   there is none). Create an API key. In the domain's settings, leave **open and click
   tracking off** — the privacy policy promises there is none. Add a webhook to
   `https://www.bethaniel.eu/api/mail-webhook` for `email.bounced` and
   `email.complained`; note its signing secret.
3. **Stripe:** create a coupon — 50% off, once, restricted to the products for
   the jobs the offer covers. The code does not know product ids; the coupon
   does. Create a restricted API key: Coupons read, Promotion codes write.
   The app's checkout already accepts promotion codes (confirmed 2026-09-29).
4. **Google:** create an OAuth client (Web) with redirect URI
   `https://www.bethaniel.eu/api/admin?action=callback`.
5. **Vercel env vars:** `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`,
   `NEWSLETTER_FROM` (e.g. `Simon at Betty <simon@bethaniel.eu>`),
   `STRIPE_SECRET_KEY`, `STRIPE_NEWSLETTER_COUPON`, `GOOGLE_CLIENT_ID`,
   `GOOGLE_CLIENT_SECRET`, `ADMIN_EMAILS`, `SESSION_SECRET` (32+ random
   bytes), `CRON_SECRET`, and optionally `SITE_URL` (defaults to
   `https://www.bethaniel.eu`).
6. **GitHub:** repository secret `CRON_SECRET`, same value.
7. **MailerLite:** export the list and paste it into `/admin → Import`.
   Imported addresses are `confirmed` (they already opted in there) and get no
   discount code; MailerLite's own unsubscribed and bounced
   addresses must be left out of the export.
8. Send a test to yourself from `/admin`, then point the forms live by
   deploying.

## Accepted risks

- **The subscribe endpoint is public and unauthenticated.** It can be made to
  send one email to any address, at most once per 10 minutes per address, and
  mint one code per address. A honeypot field stops the dumbest bots; there is
  no CAPTCHA. If it is abused, rate limiting by IP (Vercel's firewall) is the
  next step.
- **Codes can be farmed with throwaway addresses.** Each is single-use and
  worth half of one €5 job.
- **Scheduling is best-effort** by up to about half an hour (GitHub schedule
  jitter). On Vercel Pro, move the schedule into `vercel.json` `crons` — the
  endpoint already accepts Vercel's `Authorization: Bearer CRON_SECRET`.
- **Translations were written alongside the code, not by a translator.** The
  new phone-note and form copy is in `i18n-src/*.txt` (the replaced strings
  removed), and the welcome email and confirm/unsubscribe pages carry their
  own strings in code. All of it deserves a native reader's pass.
- **"Cloud edit" is the offer's name in every language.** The code's real
  scope is whatever the Stripe coupon is restricted to; the wording
  ("copy-edit or final readthrough" in the email — the final readthrough is
  what was called the publication scan) must be kept in step with it.
- **The privacy policy was drafted, not reviewed by a lawyer.** It describes
  what the code does; it should be read by someone qualified before launch.

## Out of scope

- Merge tags in newsletters (e.g. reminding each subscriber of their code).
- Open and click tracking — deliberately.
- Minting codes for imported MailerLite subscribers in bulk.
