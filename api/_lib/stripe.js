/* Discount codes, as Stripe promotion codes. What a code is worth and which
   products it applies to live on its coupon, made by hand in the Stripe
   dashboard — this module can read coupons and mint codes under them, but
   never create a coupon. That is the limit on what /admin can give away.

   The key only needs: Coupons (read), Promotion codes (write). */

import { randomInt } from "node:crypto";

/* No 0/O, 1/I/L: the code will be read off a phone and typed on a computer. */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function makeCode(prefix = "BETTY") {
  let s = "";
  for (let i = 0; i < 8; i++) s += ALPHABET[randomInt(ALPHABET.length)];
  return `${prefix}-${s.slice(0, 4)}-${s.slice(4)}`;
}

/* A code typed by hand in /admin: what Stripe accepts, kept readable. */
export function validCustomCode(code) {
  return typeof code === "string" && /^[A-Z0-9][A-Z0-9-]{2,29}$/.test(code);
}

/* Pinned, because promotion codes changed shape in later API versions and
   the account's default version is set elsewhere. */
const STRIPE_VERSION = "2024-06-20";

async function stripe(method, path, params) {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
  const init = {
    method,
    headers: { Authorization: `Bearer ${key}`, "Stripe-Version": STRIPE_VERSION },
  };
  let url = `https://api.stripe.com/v1${path}`;
  if (params && method === "GET") url += `?${new URLSearchParams(params)}`;
  if (params && method !== "GET") {
    init.headers["Content-Type"] = "application/x-www-form-urlencoded";
    init.body = new URLSearchParams(params);
  }
  const res = await fetch(url, init);
  const data = await res.json();
  if (!res.ok) {
    const err = new Error(`stripe ${res.status}: ${data?.error?.message ?? "unknown error"}`);
    err.stripeCode = data?.error?.code;
    throw err;
  }
  return data;
}

/* "50% off, once" — how a coupon is shown in /admin and stored beside a code. */
export function couponLabel(c) {
  const value = c.percent_off != null
    ? `${c.percent_off}% off`
    : `${(c.amount_off / 100).toFixed(2)} ${String(c.currency).toUpperCase()} off`;
  const duration = c.duration === "once" ? "once" : c.duration === "forever" ? "forever" : `${c.duration_in_months} months`;
  return `${c.name ? c.name + " — " : ""}${value}, ${duration}`;
}

export async function listCoupons() {
  const data = await stripe("GET", "/coupons", { limit: "100" });
  return data.data.filter((c) => c.valid);
}

export async function getCoupon(id) {
  return stripe("GET", `/coupons/${encodeURIComponent(id)}`);
}

/* One code. A random one that clashes with an existing code is vanishingly
   rare, but costs only a second try. No idempotency key: each try carries a
   new code, and Stripe refuses a reused key with different parameters. */
export async function createPromotionCode({ coupon, code, maxRedemptions, expiresAt, metadata }) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const params = { coupon, code: code ?? makeCode() };
    if (maxRedemptions) params.max_redemptions = String(maxRedemptions);
    if (expiresAt) params.expires_at = String(Math.floor(expiresAt.getTime() / 1000));
    for (const [k, v] of Object.entries(metadata ?? {})) params[`metadata[${k}]`] = String(v).slice(0, 500);
    try {
      return await stripe("POST", "/promotion_codes", params);
    } catch (err) {
      /* A code chosen by hand is not silently swapped for another. */
      if (err.stripeCode !== "resource_already_exists" || code) throw err;
    }
  }
  throw new Error("stripe: could not find a free code");
}

export async function getPromotionCode(id) {
  return stripe("GET", `/promotion_codes/${encodeURIComponent(id)}`);
}

export async function deactivatePromotionCode(id) {
  return stripe("POST", `/promotion_codes/${encodeURIComponent(id)}`, { active: "false" });
}

/* The welcome code: one per subscriber, single use, under the coupon named
   by STRIPE_NEWSLETTER_COUPON. The worst a double mint can leave behind is
   an orphaned, never-sent code — the subscriber row keeps the first. */
export async function mintPromotionCode(subscriberId) {
  const coupon = process.env.STRIPE_NEWSLETTER_COUPON;
  if (!coupon) throw new Error("STRIPE_NEWSLETTER_COUPON is not set");
  const pc = await createPromotionCode({
    coupon,
    maxRedemptions: 1,
    metadata: { subscriber_id: subscriberId, source: "newsletter-welcome" },
  });
  return pc.code;
}
