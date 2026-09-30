# /admin/cloud — cloud jobs and payments

**Date:** 2026-09-30
**Status:** Built; the Worker half needs deploying (see Setup)

## Problem

Nothing showed how many cloud jobs were being bought, what they earned, or
how much of each was used. Stripe knows the payments, but not the tokens;
the provider (Scaleway) knows the tokens, but only as a total per model and
day — every job goes through one API key, so it cannot say which job used
what.

## Where each number comes from

| Number | Source | Exact or estimated |
| --- | --- | --- |
| Jobs, their type, buyer's email, code, token budget, tokens used, status, refund state | The cloud Worker's D1, via `GET /admin/jobs` | Exact — the Worker meters every job itself |
| Amount charged, Stripe fee, received (net), refunds | Stripe charges, with their balance transactions | Exact |
| Provider cost | Tokens used × the per-token rate the prices are computed from (`BASE_COST_EUR_PER_TOKEN`, `…_TRANSLATE`) | **Estimate** — not a reading of the provider's bill |
| Margin | Received in euros − estimated provider cost | Estimate; shown only when the account settles in euros |

Jobs and charges are joined on the Stripe payment intent. A succeeded charge
no job points to is listed on its own ("Payments with no job"): that is what
a paid job the customer never received would look like.

Money is never summed across currencies: prices by the currency they were
sold in, fees and net by the account's settlement currency.

## Worker changes (repo `Bethaniel`, branch `admin-jobs-report`)

- `credentials` gains `product`, `currency`, `price_cents`, `promo_code`,
  copied from the quote (the free path) or read back from the Checkout
  Session's amount and metadata (the webhook). A link to the quote would not
  last: quotes are deleted once they expire. Jobs from before the change
  show "—" for type and code; their amount comes from Stripe.
- Until the four `ALTER TABLE`s have run, minting falls back to the old
  insert, so the migration order can never cost a customer a credential.
- `GET /admin/jobs` answers to `ADMIN_TOKEN` or to `REPORT_TOKEN`, a
  read-only secret that opens that one route: it cannot refund, sweep, or
  touch a code.

## Privacy

The report includes each buyer's email address, on purpose: it exists for
refunds and support. The privacy policy gains section 5, "Paying for a cloud
job": the checkout email is stored with the job, linked to its Stripe
payment, for refunds and support; the legal bases are the contract and the
bookkeeping obligation. Vercel is named as showing it on the admin pages.
No manuscript content is involved anywhere.

Records are kept "for as long as a refund, a support question or our
bookkeeping may need them". Nothing deletes old credentials yet; a fixed
period (the Danish Bookkeeping Act's five years is the natural one) would
make that sentence checkable.

## Setup

1. D1 columns (safe in either order with the deploy):
   `npx wrangler d1 execute bethaniel-cloud --remote --command "ALTER TABLE credentials ADD COLUMN product TEXT; ALTER TABLE credentials ADD COLUMN currency TEXT; ALTER TABLE credentials ADD COLUMN price_cents INTEGER; ALTER TABLE credentials ADD COLUMN promo_code TEXT"`
2. `npx wrangler secret put REPORT_TOKEN`, then `npm run deploy` in `worker/`.
3. Stripe (the account under simon@journeycatcher.dk): a restricted key with
   **read** access to Charges and Balance (balance transactions). Nothing else.
4. Vercel: `REPORT_TOKEN` (same value) and `STRIPE_REPORT_KEY`.
