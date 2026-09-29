/* Discount codes, in Betty's own cloud service. The app never uses Stripe's
   discount codes: it applies its own when it quotes a price, and Stripe only
   ever sees the discounted amount. So codes are minted where the app looks
   them up — through the Worker's /admin/promo routes (repo Bethaniel,
   worker/src/promoMint.ts).

   PROMO_MINT_TOKEN opens those routes and nothing else on the Worker, and
   only for campaigns starting "site-". Every code this site mints is in one:
   "site-welcome" for the newsletter's, "site-manual" for /admin's. */

import { randomInt } from "node:crypto";

/* The four jobs the app sells, by its own names. */
export const PRODUCTS = {
  edit: "copy and line edit",
  readthrough: "final readthrough",
  translate: "translation",
  enhance: "language analysis",
};

/* The welcome offer. If it changes, `codeBody` in email-render.js is the
   sentence to change with it. */
export const WELCOME = {
  campaign: "site-welcome",
  discount_pct: 50,
  max_uses: 1,
  products: ["edit", "readthrough"],
};

export const MANUAL_CAMPAIGN = "site-manual";

/* No 0/O, 1/I/L: the code will be read off a phone and typed on a computer. */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function makeCode(prefix = "BETTY") {
  let s = "";
  for (let i = 0; i < 8; i++) s += ALPHABET[randomInt(ALPHABET.length)];
  return `${prefix}-${s.slice(0, 4)}-${s.slice(4)}`;
}

/* The shape the Worker accepts; it stores codes uppercase. */
export function validCustomCode(code) {
  return typeof code === "string" && /^[A-Z0-9][A-Z0-9-]{2,39}$/.test(code);
}

/* "50% off · copy and line edit, final readthrough · 1 use · up to 5,000
   words" — how a code's terms are shown in /admin and stored beside it. */
export function describeTerms({ discount_pct, products, max_uses, max_words }) {
  const jobs = products && products.length ? products.map((p) => PRODUCTS[p] ?? p).join(", ") : "every job";
  const parts = [`${discount_pct}% off`, jobs, `${max_uses} ${max_uses === 1 ? "use" : "uses"}`];
  if (max_words) parts.push(`up to ${max_words.toLocaleString("en-GB")} words`);
  return parts.join(" · ");
}

function base() {
  return (process.env.CLOUD_API_BASE || "https://bethaniel-cloud.cloudwatcher.workers.dev").replace(/\/$/, "");
}

async function call(path, body) {
  const token = process.env.PROMO_MINT_TOKEN;
  if (!token) throw new Error("PROMO_MINT_TOKEN is not set");
  const res = await fetch(base() + path, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  /* The Worker answers 404 to a token it does not accept, by design — so a
     404 here almost always means the two PROMO_MINT_TOKEN values differ, or
     the Worker has not been deployed with the promo routes yet. */
  if (res.status === 404) throw new Error("the cloud service refused the promo token (404)");
  if (!res.ok) throw new Error(`cloud service ${res.status}: ${data.error ?? "unknown error"}`);
  return data;
}

/* Mint codes. A code that already exists comes back in `clashed`, untouched. */
export async function mintCodes(terms) {
  return call("/admin/promo", terms);
}

export async function voidCodes(codes) {
  return call("/admin/promo/void", { codes });
}

/* What each code has used and has left, keyed by code. Stripe used to be
   "the only place usage is true"; now the app's own table is. */
export async function lookupCodes(codes) {
  if (!codes.length) return {};
  const data = await call("/admin/promo/lookup", { codes });
  return Object.fromEntries(data.codes.map((c) => [c.code, c]));
}

/* One welcome code for one subscriber. A random clash with an existing code
   is vanishingly rare, but costs only a second try. */
export async function mintWelcomeCode() {
  for (let attempt = 0; attempt < 2; attempt++) {
    const code = makeCode();
    const r = await mintCodes({ ...WELCOME, codes: [code] });
    if (r.minted.includes(code)) return code;
  }
  throw new Error("could not find a free code");
}
