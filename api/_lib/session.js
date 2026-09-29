/* Google sign-in for /admin, and the signed cookie that follows it.
   Unlike the shared /stats password in auth.js, this guards something that
   can email every subscriber and mint discounts, so it is a real login:
   an allowlisted Google account, verified by Google, per person. */

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { siteUrl } from "./mail.js";

const SESSION_COOKIE = "betty_admin";
const STATE_COOKIE = "betty_admin_state";
const SESSION_SECONDS = 12 * 3600;
/* Only the admin API ever needs to see these cookies. */
const COOKIE_PATH = "/api/admin";

export function parseCookies(header) {
  const out = {};
  for (const part of (header || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function cookie(name, value, maxAge) {
  return `${name}=${encodeURIComponent(value)}; Path=${COOKIE_PATH}; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
}

function mac(payload, secret) {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function signSession(email, secret, now = Date.now()) {
  const payload = Buffer.from(
    JSON.stringify({ email, exp: Math.floor(now / 1000) + SESSION_SECONDS }),
  ).toString("base64url");
  return `${payload}.${mac(payload, secret)}`;
}

/* The signed email, or null. The allowlist is checked again on every
   request, so removing someone from ADMIN_EMAILS ends their session. */
export function verifySession(value, secret, now = Date.now()) {
  if (!secret || typeof value !== "string") return null;
  const [payload, sig] = value.split(".");
  if (!payload || !sig) return null;
  const a = Buffer.from(sig);
  const b = Buffer.from(mac(payload, secret));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  let data;
  try {
    data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (typeof data.exp !== "number" || data.exp * 1000 < now) return null;
  return isAdmin(data.email) ? data.email : null;
}

export function isAdmin(email) {
  if (typeof email !== "string") return false;
  const list = (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return list.includes(email.toLowerCase());
}

export function currentAdmin(req) {
  return verifySession(parseCookies(req.headers.cookie)[SESSION_COOKIE], process.env.SESSION_SECRET);
}

/* Belt to SameSite's braces: a state-changing call must come from our own
   pages. Browsers always send Origin on a cross-origin POST. */
export function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

function redirectUri() {
  return `${siteUrl()}/api/admin?action=callback`;
}

/* Unset variables fail loudly at sign-in rather than minting a session
   signed with "undefined". */
function configured() {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
    && process.env.SESSION_SECRET && process.env.ADMIN_EMAILS);
}

export function startLogin(res) {
  if (!configured()) return res.status(500).send("Admin sign-in is not configured: see the newsletter spec's Setup section.");
  const state = randomBytes(16).toString("base64url");
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID || "",
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: "openid email",
    state,
    prompt: "select_account",
  });
  res.setHeader("Set-Cookie", cookie(STATE_COOKIE, state, 600));
  res.setHeader("Location", url.toString());
  return res.status(302).end();
}

/* The ID token comes straight from Google's token endpoint over TLS, in
   answer to our own client secret, so its signature need not be checked
   again — Google's documentation says as much. Its audience and issuer are
   still checked, so a token minted for some other client is never taken. */
export async function finishLogin(req, res) {
  if (!configured()) return res.status(500).send("Admin sign-in is not configured.");
  const { code, state } = req.query;
  const expected = parseCookies(req.headers.cookie)[STATE_COOKIE];
  if (!code || !state || !expected || state !== expected) {
    return res.status(400).send("Sign-in expired. Go back to /admin and try again.");
  }

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID || "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET || "",
      redirect_uri: redirectUri(),
      grant_type: "authorization_code",
    }),
  });
  const tokens = await tokenRes.json();
  if (!tokenRes.ok || !tokens.id_token) {
    console.error("google token exchange failed:", tokens.error);
    return res.status(502).send("Google sign-in failed.");
  }

  let claims;
  try {
    claims = JSON.parse(Buffer.from(tokens.id_token.split(".")[1], "base64url").toString("utf8"));
  } catch {
    return res.status(502).send("Google sign-in failed.");
  }
  const okIssuer = claims.iss === "https://accounts.google.com" || claims.iss === "accounts.google.com";
  if (!okIssuer || claims.aud !== process.env.GOOGLE_CLIENT_ID || claims.email_verified !== true
      || !isAdmin(claims.email)) {
    return res.status(403).send("That Google account is not an admin of this site.");
  }

  res.setHeader("Set-Cookie", [
    cookie(SESSION_COOKIE, signSession(claims.email.toLowerCase(), process.env.SESSION_SECRET), SESSION_SECONDS),
    cookie(STATE_COOKIE, "", 0),
  ]);
  res.setHeader("Location", "/admin");
  return res.status(302).end();
}

export function logout(res) {
  res.setHeader("Set-Cookie", cookie(SESSION_COOKIE, "", 0));
  return res.status(204).end();
}
