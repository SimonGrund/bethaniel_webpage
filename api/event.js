/* Beacons from forms. This endpoint only accepts "enquiry" events — downloads
   are counted by the redirect in download.js instead. That is not a security
   boundary: /api/download has no Origin check (it can't — it's a top-level
   navigation, not a fetch/beacon), so a download row is forgeable regardless
   of what this endpoint accepts. Narrowing the allowlist here just keeps each
   endpoint doing its own job. */

import { validateEvent, coarsePlatform } from "./_lib/validate.js";
import { insertEvent } from "./_lib/db.js";

const ALLOWED_ORIGINS = [
  "https://bethaniel.eu",
  "https://www.bethaniel.eu",
];

function isAllowedOrigin(origin) {
  if (typeof origin !== "string" || !origin) return false;
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  /* Local dev only — never allow this in a deployed production instance. */
  if (process.env.VERCEL_ENV !== "production" && origin === "http://localhost:3000") {
    return true;
  }
  /* Vercel preview deployments, so a branch can be checked before it ships.
     VERCEL_URL is injected by Vercel with the CURRENT deployment's own
     hostname — it is not a wildcard, so it cannot be used by any other
     Vercel tenant's project. Matching *.vercel.app generally would accept
     origins from anyone's free Vercel account, since that domain is
     multi-tenant and not ours to trust. */
  const previewHost = process.env.VERCEL_URL;
  if (!previewHost) return false;
  try {
    return new URL(origin).hostname === previewHost;
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

  /* validateEvent's allowlist also covers "download", because /api/download
     legitimately needs that value. This endpoint doesn't accept it — not
     because that would make download rows forgeable (they already are, via
     a crafted GET to /api/download), but because this beacon endpoint has no
     business writing rows that belong to the redirect's job. */
  if (result.row.event !== "enquiry") return res.status(400).end();

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
