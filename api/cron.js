/* Sends whatever is due. Called every 15 minutes by
   .github/workflows/newsletter-cron.yml; on Vercel Pro it could be a
   vercel.json cron instead, which sends the same Authorization header. */

import { timingSafeEqual } from "node:crypto";
import { dueCampaignIds, purgeUnconfirmed } from "./_lib/newsletter-store.js";
import { sendStep } from "./_lib/send-campaign.js";

/* Leaves headroom under the function's 60-second limit in vercel.json. */
const BUDGET_MS = 45_000;

function authorised(req) {
  const secret = process.env.CRON_SECRET;
  const given = req.headers.authorization;
  if (!secret || typeof given !== "string") return false;
  const a = Buffer.from(given);
  const b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

export default async function handler(req, res) {
  if (!authorised(req)) return res.status(401).end();
  const started = Date.now();
  const results = {};
  try {
    /* Every run, not once a day: it is one cheap delete, and running it
       often means the 90 days in the privacy policy are never overshot. */
    results.purged = await purgeUnconfirmed(90);
    for (const id of await dueCampaignIds()) {
      const left = BUDGET_MS - (Date.now() - started);
      if (left < 5_000) break;
      results[id] = await sendStep(id, left);
    }
    return res.status(200).json({ ok: true, results });
  } catch (err) {
    console.error("newsletter cron failed:", err.message);
    return res.status(500).json({ ok: false, results });
  }
}
