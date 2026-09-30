/* The two sources behind /admin/cloud, both read-only.

   - The cloud Worker's GET /admin/jobs (repo Bethaniel, worker/src/jobsReport.ts):
     every job — what it was sold as, the buyer's email, tokens budgeted and
     used, an estimated provider cost. REPORT_TOKEN opens that one route.
   - Stripe's charges, for what only Stripe knows exactly: the fee, the net,
     refunds. STRIPE_REPORT_KEY is a restricted key with read access only;
     it cannot take or move money. */

function workerBase() {
  return (process.env.CLOUD_API_BASE || "https://bethaniel-cloud.cloudwatcher.workers.dev").replace(/\/$/, "");
}

export async function fetchJobs(from, to) {
  const token = process.env.REPORT_TOKEN;
  if (!token) throw new Error("REPORT_TOKEN is not set");
  const url = `${workerBase()}/admin/jobs?from=${from}&to=${to}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const data = await res.json().catch(() => ({}));
  /* The Worker answers 404 to a token it does not accept, by design. */
  if (res.status === 404) throw new Error("the cloud service refused the report token (404) — the two REPORT_TOKEN values differ, or the Worker is not deployed with the report yet");
  if (!res.ok) throw new Error(`cloud service ${res.status}: ${data.error ?? "unknown error"}`);
  return data;
}

/* Pinned: the charge and balance-transaction shapes read here are stable
   across versions, but the account's default version is set elsewhere. */
const STRIPE_VERSION = "2024-06-20";
const MAX_PAGES = 10; // 1,000 charges a request is far beyond this site's volume

export async function fetchCharges(fromIso, toIso) {
  const key = process.env.STRIPE_REPORT_KEY;
  if (!key) throw new Error("STRIPE_REPORT_KEY is not set");
  const out = [];
  let after = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const q = new URLSearchParams({
      limit: "100",
      "created[gte]": String(Math.floor(new Date(fromIso).getTime() / 1000)),
      "created[lt]": String(Math.floor(new Date(toIso).getTime() / 1000)),
      "expand[]": "data.balance_transaction",
    });
    if (after) q.set("starting_after", after);
    const res = await fetch(`https://api.stripe.com/v1/charges?${q}`, {
      headers: { Authorization: `Bearer ${key}`, "Stripe-Version": STRIPE_VERSION },
    });
    const data = await res.json().catch(() => ({}));
    /* A restricted key missing a permission gets a message that names the
       permission; it is passed on as it is. */
    if (!res.ok) throw new Error(`Stripe ${res.status}: ${data?.error?.message ?? "unknown error"}`);
    out.push(...data.data);
    if (!data.has_more || !data.data.length) return { charges: out, truncated: false };
    after = data.data.at(-1).id;
  }
  return { charges: out, truncated: true };
}

/* The name on a Checkout Session's line item — how the type of a job sold
   before the Worker recorded it is recovered. Needs Checkout Sessions: Read
   on the report key. A few at a time, so a long list of old jobs does not
   open a hundred connections at once. */
export async function fetchLineItemNames(sessionIds) {
  const key = process.env.STRIPE_REPORT_KEY;
  if (!key) throw new Error("STRIPE_REPORT_KEY is not set");
  const names = {};
  const queue = [...sessionIds];
  let firstError = null;
  async function worker() {
    while (queue.length) {
      const id = queue.shift();
      const res = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(id)}/line_items?limit=1`, {
        headers: { Authorization: `Bearer ${key}`, "Stripe-Version": STRIPE_VERSION },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        firstError ??= `Stripe ${res.status}: ${data?.error?.message ?? "unknown error"}`;
        continue;
      }
      names[id] = data.data?.[0]?.description ?? null;
    }
  }
  await Promise.all([worker(), worker(), worker(), worker()]);
  return { names, error: firstError };
}

/* The refund decision, sent to the Worker with REFUND_TOKEN — which opens
   the refund queue and this and nothing else. `by` is recorded on the
   Stripe refund. */
export async function settleRefund(credentialId, action, by) {
  const token = process.env.REFUND_TOKEN;
  if (!token) throw new Error("REFUND_TOKEN is not set");
  const res = await fetch(`${workerBase()}/admin/refund`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ credentialId, action, by }),
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 404 && data.error === "Not found") {
    throw new Error("the cloud service refused the refund token (404) — the two REFUND_TOKEN values differ, or the Worker is not deployed with it yet");
  }
  if (!res.ok) throw new Error(data.error ?? `cloud service ${res.status}`);
  return data;
}
