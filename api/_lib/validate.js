/* Everything arriving from a browser is treated as hostile. The endpoint is
   public and unauthenticated, so the defence is a narrow allowlist and hard
   length caps rather than rate limiting — see the spec's accepted risks. */

import { truncate, UTM_KEYS } from "./attribution.js";
import { ASSETS } from "./assets.js";

export const EVENTS = ["download", "enquiry"];
export const FORMS = ["companies", "contact", "contact-modal"];

const ATTR_KEYS = [
  ...UTM_KEYS,
  "click_platform",
  "landing_path",
  "referrer_host",
];

/* Coarse enough that it cannot identify anyone: four buckets, no version,
   no architecture, and never the raw user-agent string. */
export function coarsePlatform(header) {
  if (typeof header !== "string") return "other";
  const value = header.toLowerCase();
  if (value.includes("mac")) return "mac";
  if (value.includes("windows")) return "windows";
  if (value.includes("linux")) return "linux";
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
  if (form !== null && !FORMS.includes(form)) {
    return { ok: false, error: "unknown form" };
  }

  const attr =
    body.attr && typeof body.attr === "object" && !Array.isArray(body.attr)
      ? body.attr
      : {};

  const row = { event: body.event, asset, form };
  for (const key of ATTR_KEYS) row[key] = truncate(attr[key]);

  return { ok: true, row };
}
