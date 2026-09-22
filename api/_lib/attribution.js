/* Campaign attribution, shared by the browser and the functions.
   Pure on purpose: no storage, no database, no window — so it runs the
   same in a test, in a Vercel function, and in the page. */

export const UTM_KEYS = ["source", "medium", "campaign", "content", "term"];

export function truncate(value, max = 200) {
  if (typeof value !== "string") return null;
  return value.length > max ? value.slice(0, max) : value;
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
    const allKeys = [...UTM_KEYS, "click_platform", "landing_path", "referrer_host"];
    for (const key of allKeys) {
      result[key] = truncate(parsed[key]);
    }
    return result;
  } catch {
    return null;
  }
}
