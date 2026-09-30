/* What a signup form may send. The endpoint is public, so this is an
   allowlist with hard caps, like validate.js is for events. */

import { LANGS } from "./email-render.js";

export const SOURCES = ["phone", "download", "footer"];

/* Deliberately loose: the only real test of an address is mailing it. This
   refuses what cannot be one, and what would be awkward in a header. */
const EMAIL = /^[^\s@<>()",;:\\]+@[^\s@<>()",;:\\]+\.[^\s@<>()",;:\\.]{2,}$/;

export function normaliseEmail(value) {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !EMAIL.test(email)) return null;
  return email;
}

export function validateSignup(body) {
  if (!body || typeof body !== "object") return { ok: false, error: "bad request" };
  /* The honeypot: a field hidden from people. A bot that fills every input
     is told it succeeded, and nothing is sent. */
  if (typeof body.website === "string" && body.website !== "") return { ok: true, bot: true };
  const email = normaliseEmail(body.email);
  if (!email) return { ok: false, error: "bad email" };
  const source = SOURCES.includes(body.source) ? body.source : "footer";
  const newsletter = body.newsletter === true || body.newsletter === "on" || body.newsletter === "true";
  /* The link without the newsletter exists only for the phone note; the
     other forms are newsletter signups and nothing else. */
  if (!newsletter && source !== "phone") return { ok: false, error: "bad request" };
  return {
    ok: true,
    email,
    lang: LANGS.includes(body.lang) ? body.lang : "en",
    source,
    newsletter,
    attr: signupAttr(body.attr),
  };
}

/* The campaign the visitor arrived with, as js/campaign.js stored it — used
   only to tag the download link in their email (campaignParams), never
   stored. Rebuilt from an allowlist with hard caps: it is visitor input,
   and it ends up in a URL. */
const ATTR_KEYS = ["source", "medium", "campaign", "content", "term"];
const CLICK_PLATFORMS = ["google", "meta", "reddit", "linkedin", "x", "microsoft"];

export function signupAttr(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out = {};
  for (const k of ATTR_KEYS) {
    if (typeof raw[k] === "string" && raw[k].trim()) out[k] = raw[k].trim().slice(0, 100);
  }
  if (CLICK_PLATFORMS.includes(raw.click_platform)) out.click_platform = raw.click_platform;
  return out;
}

/* Every address in a pasted list or CSV, in order, once each. */
export function extractEmails(text, cap = 20000) {
  const seen = new Set();
  for (const m of String(text ?? "").matchAll(/[^\s@<>()",;:\\']+@[^\s@<>()",;:\\']+/g)) {
    const email = normaliseEmail(m[0]);
    if (email) seen.add(email);
    if (seen.size >= cap) break;
  }
  return [...seen];
}
