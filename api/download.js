/* Downloads are counted here rather than with a click handler, so a blocked
   script or a missing one cannot lose the conversion.
   The rule that matters: the redirect never waits for the database. Neon's
   free tier suspends when idle, and the function (iad1) and the database
   are far enough apart that a first query can take most of a second — a
   slow database must never be the reason a download is slow or fails.
   So the visitor is redirected at once, and waitUntil keeps the function
   alive until the insert is done. It used to race the insert against a
   250 ms timer and redirect when the timer won; Vercel then froze the
   function with the insert still in flight, and the row was silently lost. */

import { waitUntil } from "@vercel/functions";
import { resolveAsset } from "./_lib/assets.js";
import { decodeAttribution } from "./_lib/attribution.js";
import { validateEvent, coarsePlatform } from "./_lib/validate.js";
import { insertEvent } from "./_lib/db.js";

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
      waitUntil(
        insertEvent(result.row, {
          country: req.headers["x-vercel-ip-country"] ?? null,
          ua_platform: coarsePlatform(req.headers["sec-ch-ua-platform"], req.headers["user-agent"]),
        }).catch((err) => {
          console.error("download tracking failed:", err.message);
        }),
      );
    }
  } catch (err) {
    /* Swallowed on purpose. A lost row is a reporting gap; a thrown error
       here would be a broken download. */
    console.error("download tracking failed:", err.message);
  }

  res.setHeader("Cache-Control", "no-store");
  res.redirect(302, url);
}
