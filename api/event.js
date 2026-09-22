/* Beacons from forms. Downloads do not come through here — they are counted
   by the redirect in download.js, which cannot be blocked. */

import { validateEvent, coarsePlatform } from "./_lib/validate.js";
import { insertEvent } from "./_lib/db.js";

const ALLOWED_ORIGINS = [
  "https://bethaniel.eu",
  "https://www.bethaniel.eu",
  "http://localhost:3000",
];

function isAllowedOrigin(origin) {
  if (!origin) return false;
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  /* Vercel preview deployments, so a branch can be checked before it ships. */
  try {
    return new URL(origin).hostname.endsWith(".vercel.app");
  } catch {
    return false;
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).end();
  }

  if (!isAllowedOrigin(req.headers.origin)) {
    return res.status(403).end();
  }

  /* sendBeacon posts a Blob, so the body may arrive as a string. */
  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      return res.status(400).end();
    }
  }

  const result = validateEvent(body);
  if (!result.ok) return res.status(400).end();

  try {
    await insertEvent(result.row, {
      country: req.headers["x-vercel-ip-country"] ?? null,
      ua_platform: coarsePlatform(req.headers["sec-ch-ua-platform"]),
    });
  } catch (err) {
    console.error("event insert failed:", err.message);
  }

  /* 204 either way: the page has already told the visitor their message
     was sent, and a tracking failure is not their problem. */
  return res.status(204).end();
}
