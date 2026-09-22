/* Campaign attribution, shared by the browser and the functions.
   Pure on purpose: no storage, no database, no window — so it runs the
   same in a test, in a Vercel function, and in the page. */

export const UTM_KEYS = ["source", "medium", "campaign", "content", "term"];

/* Which ad platform each click-id param belongs to. The id itself is stored
   as an opaque string; we never send it anywhere, it is only there to tell
   paid clicks apart from organic ones carrying the same utm_source. */
export const CLICK_IDS = Object.freeze({
  gclid: "google",
  fbclid: "meta",
  rdt_cid: "reddit",
  li_fat_id: "linkedin",
  twclid: "x",
  msclkid: "microsoft",
});

export function truncate(value, max = 200) {
  if (typeof value !== "string") return null;
  return value.length > max ? value.slice(0, max) : value;
}

function hostOf(referrer) {
  try {
    return truncate(new URL(referrer).hostname);
  } catch {
    return null;
  }
}

export function parseAttribution(search, referrer, path) {
  let params;
  try {
    params = new URLSearchParams(search || "");
  } catch {
    return null;
  }

  const attr = { landing_path: truncate(path) ?? "/" };
  let found = false;

  for (const key of UTM_KEYS) {
    const value = truncate(params.get(`utm_${key}`));
    attr[key] = value;
    if (value) found = true;
  }

  attr.click_id = null;
  attr.click_platform = null;
  for (const [param, platform] of Object.entries(CLICK_IDS)) {
    const value = truncate(params.get(param));
    if (value) {
      attr.click_id = value;
      attr.click_platform = platform;
      found = true;
      break;
    }
  }

  /* No campaign params means nothing to record. Returning null rather than
     an empty object is what lets the caller leave an earlier visit's
     attribution untouched on an internal page view. */
  if (!found) return null;

  attr.referrer_host = hostOf(referrer);
  return attr;
}

export function encodeAttribution(attr) {
  return Buffer.from(JSON.stringify(attr), "utf8").toString("base64url");
}

export function decodeAttribution(str) {
  if (typeof str !== "string" || str === "") return null;
  try {
    const parsed = JSON.parse(Buffer.from(str, "base64url").toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    // The value is attacker-controllable from the query string, so rebuild
    // with only the known keys and enforce the 200-char limit on each.
    const result = {};
    const allKeys = [...UTM_KEYS, "click_id", "click_platform", "landing_path", "referrer_host"];
    for (const key of allKeys) {
      result[key] = truncate(parsed[key]);
    }
    return result;
  } catch {
    return null;
  }
}
