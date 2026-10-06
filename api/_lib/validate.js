/* Everything arriving from a browser is treated as hostile. The endpoint is
   public and unauthenticated, so the defence is a narrow allowlist and hard
   length caps rather than rate limiting — see the spec's accepted risks. */

import { truncate, UTM_KEYS } from "./attribution.js";
import { ASSETS } from "./assets.js";

export const EVENTS = ["download", "enquiry", "view", "signup"];
export const FORMS = ["companies", "contact", "contact-modal"];
/* Which signup form was sent. The phone note's two are both a request for
   the link; every one but "phone-link" is also a newsletter signup. The
   address itself never reaches this endpoint. */
export const SIGNUP_FORMS = ["phone-link", "phone-newsletter", "download-modal", "newsletter"];

/* The pages a view may name, before any language prefix. A path outside
   this list is stored as null rather than as whatever was sent: the
   endpoint is public, and a free-text column is an invitation to fill the
   table with junk. */
const SITE_PAGES = ["/", "/how-it-works", "/performance", "/blog", "/contact", "/license", "/cloud-terms", "/privacy"];
const LANGS = ["da", "de", "es", "fr"];

/* One spelling per page: /contact.html, /contact/ and /contact are the
   same page under cleanUrls, and /da/index.html is /da/. The language
   prefix is kept — which language a page was read in is worth knowing. */
export function normalisePage(path) {
  if (typeof path !== "string" || path.length > 200) return null;
  let p = path.replace(/\.html$/, "").replace(/\/index$/, "/");
  if (p.length > 1) p = p.replace(/\/$/, "");
  const m = p.match(/^\/(da|de|es|fr)(\/.*)?$/);
  const lang = m && LANGS.includes(m[1]) ? m[1] : null;
  const rest = lang ? m[2] || "/" : p;
  if (!SITE_PAGES.includes(rest)) return null;
  if (!lang) return rest;
  return rest === "/" ? `/${lang}/` : `/${lang}${rest}`;
}

/* Crawlers that run scripts would otherwise count as visitors. The
   user-agent is read here and never stored. */
export function isBot(ua) {
  if (typeof ua !== "string" || ua === "") return true;
  return /bot|crawl|spider|slurp|headless|lighthouse|preview|facebookexternalhit|embedly|pingdom|monitor/i.test(ua);
}

const ATTR_KEYS = [
  ...UTM_KEYS,
  "click_platform",
  "landing_path",
  "referrer_host",
];

/* Coarse enough that it cannot identify anyone: four buckets, no version,
   no architecture, and never the raw user-agent string. */
export function coarsePlatform(header, userAgent) {
  /* The client hint first; Safari and Firefox send none, and iOS never
     does, so the user-agent decides for them. It is read here and never
     stored — only the bucket is. Android before Linux: its user-agent
     says both. */
  for (const value of [header, userAgent]) {
    if (typeof value !== "string" || !value) continue;
    const v = value.toLowerCase();
    if (/iphone|ipad|ipod|"ios"/.test(v)) return "ios";
    if (v.includes("android")) return "android";
    if (v.includes("mac")) return "mac";
    if (v.includes("windows")) return "windows";
    if (v.includes("linux") || v.includes("x11")) return "linux";
  }
  return "other";
}

export function validateEvent(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "body must be an object" };
  }

  if (!EVENTS.includes(body.event)) {
    return { ok: false, error: "unknown event" };
  }

  const props =
    body.props && typeof body.props === "object" && !Array.isArray(body.props)
      ? body.props
      : {};

  const asset = props.asset ?? null;
  if (asset !== null && !Object.hasOwn(ASSETS, asset)) {
    return { ok: false, error: "unknown asset" };
  }

  const form = props.form ?? null;
  if (body.event === "signup") {
    if (!SIGNUP_FORMS.includes(form)) return { ok: false, error: "unknown signup form" };
  } else if (form !== null && !FORMS.includes(form)) {
    return { ok: false, error: "unknown form" };
  }

  const attr =
    body.attr && typeof body.attr === "object" && !Array.isArray(body.attr)
      ? body.attr
      : {};

  /* A view names its page, and whether it was the first of the session —
     the difference between a visit and a click between pages. Neither
     means anything on a download or an enquiry. */
  const isView = body.event === "view";
  const page = isView ? normalisePage(props.path) : null;
  const entry = isView && typeof props.entry === "boolean" ? props.entry : null;

  const row = { event: body.event, asset, form, page, entry };
  for (const key of ATTR_KEYS) row[key] = truncate(attr[key]);

  return { ok: true, row };
}
