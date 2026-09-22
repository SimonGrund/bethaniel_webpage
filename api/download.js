/* Downloads are counted here rather than with a click handler, so a blocked
   script or a missing one cannot lose the conversion.
   The rule that matters: this function redirects whether or not the insert
   worked. Neon's free tier suspends when idle, so a cold start can take a
   second — and a slow database must never be the reason a download fails. */

import { resolveAsset } from "./_lib/assets.js";
import { decodeAttribution } from "./_lib/attribution.js";
import { validateEvent, coarsePlatform } from "./_lib/validate.js";
import { insertEvent } from "./_lib/db.js";

const INSERT_TIMEOUT_MS = 250;

export default async function handler(req, res) {
  const { id, url } = resolveAsset(req.query.asset);

  try {
    const attr = decodeAttribution(req.query.a) ?? {};
    const result = validateEvent({
      event: "download",
      props: { asset: id },
      attr,
    });

    if (result.ok) {
      await Promise.race([
        insertEvent(result.row, {
          country: req.headers["x-vercel-ip-country"] ?? null,
          ua_platform: coarsePlatform(req.headers["sec-ch-ua-platform"]),
        }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("insert timed out")), INSERT_TIMEOUT_MS),
        ),
      ]);
    }
  } catch (err) {
    /* Swallowed on purpose. A lost row is a reporting gap; a thrown error
       here would be a broken download. */
    console.error("download tracking failed:", err.message);
  }

  res.setHeader("Cache-Control", "no-store");
  res.redirect(302, url);
}
