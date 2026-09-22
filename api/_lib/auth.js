/* Shared password check for the /stats surface (read and delete).
   The password is a shared secret guarding aggregate counts, not an
   authentication system — which is proportionate to what it protects, but
   worth knowing before anything more sensitive is put behind it. */

import { timingSafeEqual } from "node:crypto";

export function passwordMatches(given) {
  const expected = process.env.STATS_PASSWORD;
  /* Fail closed: an unset variable must never be treated as "no password
     required". */
  if (!expected || typeof given !== "string") return false;
  const a = Buffer.from(given, "utf8");
  const b = Buffer.from(expected, "utf8");
  /* timingSafeEqual throws on a length mismatch, so compare lengths first —
     which leaks only the length, not the contents. */
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
