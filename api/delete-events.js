/* Delete side of /stats. Scoped and bounded: a single source/medium/campaign
   combination, and only within an explicit, caller-supplied date range — an
   unbounded delete must never be reachable by omitting a field. */

import { deleteEvents } from "./_lib/db.js";
import { parseRange } from "./_lib/aggregate.js";
import { passwordMatches } from "./_lib/auth.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).end();
  }

  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      return res.status(400).json({ error: "bad request" });
    }
  }
  body ??= {};

  if (!passwordMatches(body.password)) {
    /* Same fixed pause as /api/stats, so a wrong password is not worth
       guessing at speed. */
    await new Promise((r) => setTimeout(r, 400));
    return res.status(403).json({ error: "wrong password" });
  }

  /* A range is required for a delete — unlike /api/stats, there is no
     default-to-30-days fallback here, because that would make an unbounded
     delete reachable simply by omitting from/to. */
  if (body.from === undefined || body.to === undefined) {
    return res.status(400).json({ error: "a date range is required" });
  }

  const range = parseRange(body.from, body.to);
  if (!range.ok) return res.status(400).json({ error: range.error });

  try {
    const deleted = await deleteEvents({
      from: range.from,
      to: range.to,
      source: body.source ?? null,
      medium: body.medium ?? null,
      campaign: body.campaign ?? null,
    });
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({ deleted });
  } catch (err) {
    console.error("stats delete failed:", err.message);
    return res.status(500).json({ error: "could not delete the rows" });
  }
}
