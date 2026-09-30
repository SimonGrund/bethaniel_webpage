import test from "node:test";
import assert from "node:assert/strict";
import { buildCloudReport } from "../api/_lib/cloud-report.js";

const job = (over = {}) => ({
  id: "c1", createdAt: "2026-09-30T10:00:00.000Z", expiresAt: "2026-10-07T10:00:00.000Z", status: "active",
  kind: "paid", product: "edit", currency: "eur", priceCents: 500, promoCode: null,
  customerEmail: "author@example.com", paymentIntent: "pi_1", sessionId: "cs_1",
  tokenBudget: 1_000_000, tokensUsed: 400_000, refundStatus: null, providerCostEur: 0.2036,
  ...over,
});
const charge = (over = {}) => ({
  id: "ch_1", payment_intent: "pi_1", amount: 500, currency: "eur", amount_refunded: 0, refunded: false,
  status: "succeeded", created: 1_790_000_000, billing_details: { email: "author@example.com" },
  balance_transaction: { fee: 33, net: 467, currency: "eur" },
  ...over,
});

test("a paid job is matched to its Stripe charge: the fee and what was received", () => {
  const r = buildCloudReport({ jobs: [job()], charges: [charge()] });
  assert.equal(r.jobs[0].feeCents, 33);
  assert.equal(r.jobs[0].netCents, 467);
  assert.equal(r.jobs[0].usedPct, 40);
  assert.deepEqual(r.totals.net, { eur: 467 });
  assert.deepEqual(r.totals.fees, { eur: 33 });
  assert.equal(r.totals.marginEur, 4.47);
  assert.deepEqual(r.orphans, []);
});

test("money is never added up across currencies", () => {
  const r = buildCloudReport({
    jobs: [job(), job({ id: "c2", paymentIntent: "pi_2", currency: "dkk", priceCents: 3900 })],
    charges: [charge(), charge({ id: "ch_2", payment_intent: "pi_2", amount: 3900, currency: "dkk", balance_transaction: { fee: 250, net: 3650, currency: "dkk" } })],
  });
  assert.deepEqual(r.totals.charged, { eur: 500, dkk: 3900 });
  assert.deepEqual(r.totals.net, { eur: 467, dkk: 3650 });
});

test("with no euro settlement there is no margin rather than a wrong one", () => {
  const r = buildCloudReport({ jobs: [job()], charges: [charge({ balance_transaction: { fee: 250, net: 3480, currency: "dkk" } })] });
  assert.equal(r.totals.marginEur, null);
});

test("a job paid for by a code counts as a job, not as money", () => {
  const r = buildCloudReport({
    jobs: [job({ kind: "code", paymentIntent: null, priceCents: 0, customerEmail: null, promoCode: "REVIEW-1" })],
    charges: [],
  });
  assert.equal(r.totals.codeJobs, 1);
  assert.equal(r.totals.paidJobs, 0);
  assert.deepEqual(r.totals.charged, {});
});

test("a refund is taken off what was charged, and counted", () => {
  const r = buildCloudReport({
    jobs: [job({ status: "expired", tokensUsed: 0, refundStatus: "refunded" })],
    charges: [charge({ amount_refunded: 500, refunded: true, balance_transaction: { fee: 33, net: 467, currency: "eur" } })],
  });
  assert.deepEqual(r.totals.charged, { eur: 0 });
  assert.equal(r.totals.refunds, 1);
  assert.equal(r.totals.unusedExpired, 1);
  assert.equal(r.jobs[0].stripeStatus, "refunded");
});

test("a payment with no job behind it is listed on its own", () => {
  const r = buildCloudReport({ jobs: [], charges: [charge({ id: "ch_9", payment_intent: "pi_9" })] });
  assert.equal(r.orphans.length, 1);
  assert.equal(r.orphans[0].email, "author@example.com");
});

test("an older job without a recorded price takes the amount from Stripe", () => {
  const r = buildCloudReport({ jobs: [job({ product: null, currency: null, priceCents: null })], charges: [charge()] });
  assert.equal(r.jobs[0].chargedCents, 500);
  assert.equal(r.jobs[0].chargedCurrency, "eur");
  assert.equal(r.byProduct[0].product, "unknown");
});

test("without Stripe the jobs still report, and nothing pretends to know the money", () => {
  const r = buildCloudReport({ jobs: [job()], charges: null });
  assert.equal(r.haveStripe, false);
  assert.equal(r.jobs[0].feeCents, null);
  assert.deepEqual(r.totals.net, {});
  assert.equal(r.totals.marginEur, null);
  assert.equal(r.totals.tokensUsed, 400_000);
});

test("a refund comes off what was received, and Stripe keeps its fee", () => {
  const r = buildCloudReport({
    jobs: [job()],
    charges: [charge({ amount_refunded: 500, refunded: true, balance_transaction: { amount: 500, fee: 33, net: 467, currency: "eur" } })],
  });
  assert.equal(r.jobs[0].netCents, -33);
  assert.deepEqual(r.totals.net, { eur: -33 });
});

test("a refund on a charge settled in another currency is converted at the charge's rate", () => {
  const r = buildCloudReport({
    jobs: [job({ currency: "usd" })],
    charges: [charge({ amount: 599, currency: "usd", amount_refunded: 599, balance_transaction: { amount: 3800, fee: 280, net: 3520, currency: "dkk" } })],
  });
  assert.equal(r.jobs[0].netCents, 3520 - 3800);
});

/* ── Chart series ── */

import { productFromLineItem } from "../api/_lib/cloud-report.js";

test("the margin accumulates day by day, and free jobs pull it down", () => {
  const r = buildCloudReport({
    jobs: [
      job({ createdAt: "2026-09-01T10:00:00Z", providerCostEur: 0.5 }),
      job({ id: "c2", createdAt: "2026-09-03T10:00:00Z", kind: "code", paymentIntent: null, priceCents: 0, providerCostEur: 1.2 }),
    ],
    charges: [charge()],
    from: "2026-09-01",
    to: "2026-09-03",
  });
  const s = r.charts.marginSeries;
  assert.deepEqual(s.map((d) => d.date), ["2026-09-01", "2026-09-02", "2026-09-03"]);
  assert.deepEqual(s.map((d) => d.cumulative), [4.17, 4.17, 2.97]);
  assert.equal(s[2].margin, -1.2);
});

test("with no euro settlement, or no Stripe, there is no margin series", () => {
  const dkk = buildCloudReport({ jobs: [job()], charges: [charge({ balance_transaction: { amount: 3800, fee: 250, net: 3550, currency: "dkk" } })], from: "2026-09-30", to: "2026-09-30" });
  assert.equal(dkk.charts.marginSeries, null);
  assert.equal(dkk.charts.marginNote, "not-euro");
  const none = buildCloudReport({ jobs: [job()], charges: null, from: "2026-09-30", to: "2026-09-30" });
  assert.equal(none.charts.marginNote, "no-stripe");
});

test("jobs per day are counted by type, every day of the range present", () => {
  const r = buildCloudReport({
    jobs: [job(), job({ id: "c2", product: "translate" }), job({ id: "c3", product: null })],
    charges: [], from: "2026-09-29", to: "2026-09-30",
  });
  assert.equal(r.charts.jobsByDay.length, 2);
  assert.deepEqual(r.charts.jobsByDay[1], { date: "2026-09-30", edit: 1, readthrough: 0, translate: 1, enhance: 0, unknown: 1 });
});

test("a Stripe line item names the job type", () => {
  assert.equal(productFromLineItem("Betty in the Cloud — final readthrough"), "readthrough");
  assert.equal(productFromLineItem("Betty in the Cloud — translation"), "translate");
  assert.equal(productFromLineItem("Betty in the Cloud — enhanced language analysis"), "enhance");
  assert.equal(productFromLineItem("Betty in the Cloud — copy and line edit"), "edit");
  assert.equal(productFromLineItem("Something else"), null);
});

test("a Stripe test-mode job is no sale: counted apart, never money", () => {
  const r = buildCloudReport({
    jobs: [job(), job({ id: "t1", sessionId: "cs_test_abc", paymentIntent: "pi_test_1", priceCents: 500 })],
    charges: [charge()],
    from: "2026-09-30", to: "2026-09-30",
  });
  assert.equal(r.totals.paidJobs, 1);
  assert.equal(r.totals.testJobs, 1);
  assert.deepEqual(r.totals.charged, { eur: 500 });
  assert.equal(r.jobs[1].kind, "test");
  assert.equal(r.jobs[1].feeCents, null);
});
