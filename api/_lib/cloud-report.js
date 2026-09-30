/* Joining the cloud Worker's jobs to Stripe's charges, into what
   /admin/cloud shows. Pure, so the joining and the sums are tested without
   either service.

   Money is never summed across currencies. A job's price is in the currency
   it was sold in (eur, usd, dkk); Stripe's fee and net are in the account's
   settlement currency, which is what "received" means. */

export const PRODUCTS = ["edit", "readthrough", "translate", "enhance"];

/* A job's type from the name on its Stripe line item — for jobs from
   before the Worker recorded the type. The names are the Worker's
   PRODUCT_NAMES ("Betty in the Cloud — final readthrough"); matched on a
   word, so an older wording still lands. */
export function productFromLineItem(name) {
  const n = String(name ?? "").toLowerCase();
  if (/translat/.test(n)) return "translate";
  if (/readthrough|read-through/.test(n)) return "readthrough";
  if (/analysis|enhance/.test(n)) return "enhance";
  if (/edit/.test(n)) return "edit";
  return null;
}

function eachDay(from, to) {
  const out = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 86_400_000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}
const DAY = (iso) => iso.slice(0, 10);

/* What a charge left on the account. Its balance transaction is the charge
   alone — a refund is a transaction of its own, and Stripe keeps its fee —
   so the refund comes off here, converted at the charge's own rate when the
   account settles in another currency. */
export function receivedCents(charge, bt) {
  const refunded = charge.amount_refunded ?? 0;
  if (!refunded) return bt.net;
  const rate = charge.amount && typeof bt.amount === "number" ? bt.amount / charge.amount : 1;
  return bt.net - Math.round(refunded * rate);
}

function add(map, key, cents) {
  if (!key || typeof cents !== "number") return;
  map[key] = (map[key] ?? 0) + cents;
}

/**
 * @param {{ jobs: object[], charges: object[] }} input
 *   jobs: the Worker's JobReport rows; charges: Stripe charge objects with
 *   balance_transaction expanded (or null when Stripe could not be read)
 */
export function buildCloudReport({ jobs, charges, from, to }) {
  const haveStripe = Array.isArray(charges);
  const byIntent = new Map();
  for (const c of charges ?? []) if (c.payment_intent) byIntent.set(c.payment_intent, c);
  const matched = new Set();

  const rows = jobs.map((j) => {
    const c = j.paymentIntent ? byIntent.get(j.paymentIntent) : undefined;
    if (c) matched.add(c.id);
    const bt = c && typeof c.balance_transaction === "object" ? c.balance_transaction : null;
    return {
      ...j,
      usedPct: j.tokenBudget > 0 ? Math.round((j.tokensUsed / j.tokenBudget) * 100) : 0,
      /* What Stripe says was charged, when the job was paid: it overrides
         the Worker's copy, which is null on jobs from before it kept one. */
      chargedCents: c ? c.amount : j.priceCents,
      chargedCurrency: c ? c.currency : j.currency,
      refundedCents: c ? c.amount_refunded : 0,
      feeCents: bt ? bt.fee : null,
      netCents: bt ? receivedCents(c, bt) : null,
      settlementCurrency: bt ? bt.currency : null,
      stripeStatus: c ? (c.refunded ? "refunded" : c.amount_refunded > 0 ? "partly refunded" : c.status) : null,
    };
  });

  /* A payment with no job behind it: a webhook that never landed, or a
     charge for something else on the account. Worth seeing either way. */
  const orphans = (charges ?? [])
    .filter((c) => !matched.has(c.id) && c.status === "succeeded")
    .map((c) => ({
      id: c.id,
      createdAt: new Date(c.created * 1000).toISOString(),
      amountCents: c.amount,
      currency: c.currency,
      refundedCents: c.amount_refunded,
      email: c.billing_details?.email ?? c.receipt_email ?? null,
      paymentIntent: c.payment_intent,
      description: c.description ?? null,
    }));

  const totals = {
    jobs: rows.length,
    paidJobs: rows.filter((r) => r.kind === "paid").length,
    codeJobs: rows.filter((r) => r.kind === "code").length,
    discountedJobs: rows.filter((r) => r.kind === "paid" && r.promoCode).length,
    tokensSold: 0,
    tokensUsed: 0,
    providerCostEur: 0,
    charged: {},     // by sale currency, after refunds
    refunded: {},    // by sale currency
    fees: {},        // by settlement currency
    net: {},         // by settlement currency — what actually reached the account
    refunds: 0,
    unusedExpired: rows.filter((r) => r.status === "expired" && r.tokensUsed === 0).length,
    awaitingDecision: rows.filter((r) => r.refundStatus === "review").length,
  };
  const byProduct = {};
  const daily = {};
  for (const r of rows) {
    totals.tokensSold += r.tokenBudget;
    totals.tokensUsed += r.tokensUsed;
    totals.providerCostEur += r.providerCostEur;
    if (r.kind === "paid") {
      add(totals.charged, r.chargedCurrency, (r.chargedCents ?? 0) - (r.refundedCents ?? 0));
      if (r.refundedCents > 0) {
        totals.refunds += 1;
        add(totals.refunded, r.chargedCurrency, r.refundedCents);
      }
      add(totals.fees, r.settlementCurrency, r.feeCents);
      add(totals.net, r.settlementCurrency, r.netCents);
    }
    const p = (byProduct[r.product ?? "unknown"] ??= { product: r.product ?? "unknown", jobs: 0, paid: 0, tokensUsed: 0, providerCostEur: 0, charged: {} });
    p.jobs += 1;
    if (r.kind === "paid") {
      p.paid += 1;
      add(p.charged, r.chargedCurrency, (r.chargedCents ?? 0) - (r.refundedCents ?? 0));
    }
    p.tokensUsed += r.tokensUsed;
    p.providerCostEur += r.providerCostEur;
    const d = (daily[DAY(r.createdAt)] ??= { date: DAY(r.createdAt), jobs: 0, paid: 0, tokensUsed: 0 });
    d.jobs += 1;
    if (r.kind === "paid") d.paid += 1;
    d.tokensUsed += r.tokensUsed;
  }
  totals.providerCostEur = Math.round(totals.providerCostEur * 100) / 100;
  for (const p of Object.values(byProduct)) p.providerCostEur = Math.round(p.providerCostEur * 100) / 100;

  /* A margin only where it is honest: net received in euros, less the
     estimated provider cost, which is in euros too. */
  const marginEur = totals.net.eur !== undefined
    ? Math.round((totals.net.eur / 100 - totals.providerCostEur) * 100) / 100
    : null;

  /* ── Chart series ── */
  const days = from && to ? eachDay(from, to) : Object.keys(daily).sort();

  /* Accumulated margin, day by day: what reached the account in euros,
     less the estimated provider cost, summed from the range's first day.
     Only where it is honest — every paid job settled in euros. A job's
     refund is counted on the day the job was bought. */
  const settled = rows.filter((r) => r.kind === "paid" && r.settlementCurrency);
  const euroOnly = settled.every((r) => r.settlementCurrency === "eur");
  let marginSeries = null;
  if (haveStripe && euroOnly) {
    const perDay = Object.fromEntries(days.map((d) => [d, { received: 0, cost: 0 }]));
    for (const r of rows) {
      const d = perDay[DAY(r.createdAt)];
      if (!d) continue;
      d.cost += r.providerCostEur;
      if (r.kind === "paid" && r.netCents !== null) d.received += r.netCents / 100;
    }
    let running = 0;
    marginSeries = days.map((date) => {
      const { received, cost } = perDay[date];
      const margin = received - cost;
      running += margin;
      const round = (x) => Math.round(x * 100) / 100;
      return { date, received: round(received), cost: round(cost), margin: round(margin), cumulative: round(running) };
    });
  }

  /* Jobs per day, by type, for the stacked columns. */
  const jobsByDay = days.map((date) => {
    const counts = { edit: 0, readthrough: 0, translate: 0, enhance: 0, unknown: 0 };
    for (const r of rows) if (DAY(r.createdAt) === date) counts[PRODUCTS.includes(r.product) ? r.product : "unknown"] += 1;
    return { date, ...counts };
  });

  /* Margin by job type, in euros, on the same terms as the series. */
  let marginByProduct = null;
  if (haveStripe && euroOnly) {
    const m = {};
    for (const r of rows) {
      const k = PRODUCTS.includes(r.product) ? r.product : "unknown";
      const e = (m[k] ??= { product: k, received: 0, cost: 0 });
      e.cost += r.providerCostEur;
      if (r.kind === "paid" && r.netCents !== null) e.received += r.netCents / 100;
    }
    marginByProduct = Object.values(m).map((e) => ({
      product: e.product,
      received: Math.round(e.received * 100) / 100,
      cost: Math.round(e.cost * 100) / 100,
      margin: Math.round((e.received - e.cost) * 100) / 100,
    })).sort((a, b) => b.margin - a.margin);
  }

  return {
    haveStripe,
    charts: { marginSeries, jobsByDay, marginByProduct, marginNote: haveStripe && !euroOnly ? "not-euro" : haveStripe ? null : "no-stripe" },
    totals: { ...totals, marginEur },
    byProduct: Object.values(byProduct).sort((a, b) => b.jobs - a.jobs),
    daily: Object.values(daily).sort((a, b) => a.date.localeCompare(b.date)),
    jobs: rows,
    orphans,
  };
}
