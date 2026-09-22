/* Read side. The password is a shared secret guarding aggregate counts, not
   an authentication system — which is proportionate to what it protects, but
   worth knowing before anything more sensitive is put behind it. */

import { timingSafeEqual } from "node:crypto";
import { queryEvents } from "./_lib/db.js";
import { aggregate, parseRange } from "./_lib/aggregate.js";

function passwordMatches(given) {
  const expected = process.env.STATS_PASSWORD;
  if (!expected || typeof given !== "string") return false;
  const a = Buffer.from(given, "utf8");
  const b = Buffer.from(expected, "utf8");
  /* timingSafeEqual throws on a length mismatch, so compare lengths first —
     which leaks only the length, not the contents. */
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

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
    /* A fixed pause, so a wrong password is not worth guessing at speed. */
    await new Promise((r) => setTimeout(r, 400));
    return res.status(403).json({ error: "wrong password" });
  }

  const range = parseRange(body.from, body.to);
  if (!range.ok) return res.status(400).json({ error: range.error });

  try {
    const rows = await queryEvents(range.from, range.to);
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({
      from: range.from.toISOString().slice(0, 10),
      to: new Date(range.to.getTime() - 86_400_000).toISOString().slice(0, 10),
      ...aggregate(rows),
    });
  } catch (err) {
    console.error("stats query failed:", err.message);
    return res.status(500).json({ error: "could not read the numbers" });
  }
}
