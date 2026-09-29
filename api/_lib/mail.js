/* Resend, over its HTTP API — no SDK, like the rest of api/. */

import { createHmac, timingSafeEqual } from "node:crypto";

const API = "https://api.resend.com";

export function siteUrl() {
  return (process.env.SITE_URL || "https://www.bethaniel.eu").replace(/\/$/, "");
}

/* A confirm or unsubscribe link for one subscriber. */
export function subscriberLink(action, token) {
  return `${siteUrl()}/api/newsletter?action=${action}&t=${encodeURIComponent(token)}`;
}

async function call(path, payload, idempotencyKey) {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("RESEND_API_KEY is not set");
  const headers = { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  const res = await fetch(API + path, { method: "POST", headers, body: JSON.stringify(payload) });
  const text = await res.text();
  if (!res.ok) throw new Error(`resend ${path} ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

/* One message: { to, subject, html, text, unsubscribeUrl? }. */
export function toResend(msg) {
  const out = {
    from: process.env.NEWSLETTER_FROM || "Betty <newsletter@bethaniel.eu>",
    to: [msg.to],
    subject: msg.subject,
    html: msg.html,
    text: msg.text,
  };
  if (process.env.NEWSLETTER_REPLY_TO) out.reply_to = process.env.NEWSLETTER_REPLY_TO;
  /* RFC 8058 one-click unsubscribe. Gmail and Yahoo require it of bulk
     senders; the POST it triggers is handled by /api/newsletter. */
  if (msg.unsubscribeUrl) {
    out.headers = {
      "List-Unsubscribe": `<${msg.unsubscribeUrl}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    };
  }
  return out;
}

export async function sendOne(msg, idempotencyKey) {
  return call("/emails", toResend(msg), idempotencyKey);
}

/* Up to 100 per call, Resend's limit. */
export async function sendBatch(msgs, idempotencyKey) {
  if (msgs.length > 100) throw new Error("sendBatch: at most 100 messages");
  return call("/emails/batch", msgs.map(toResend), idempotencyKey);
}

/* Resend signs webhooks with Svix: HMAC-SHA256 over "id.timestamp.body",
   keyed by the base64 part of the whsec_ secret; the header may carry
   several space-separated "v1,<sig>" entries during a key rotation. */
export function verifyWebhook(rawBody, headers, secret, nowSeconds = Date.now() / 1000) {
  const id = headers["svix-id"];
  const ts = headers["svix-timestamp"];
  const sigHeader = headers["svix-signature"];
  if (!secret || !id || !ts || !sigHeader) return false;
  /* Five minutes either way: an old, captured request is not replayable. */
  if (!/^\d+$/.test(ts) || Math.abs(nowSeconds - Number(ts)) > 300) return false;
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const expected = createHmac("sha256", key).update(`${id}.${ts}.${rawBody}`).digest();
  return sigHeader.split(" ").some((part) => {
    const [version, sig] = part.split(",");
    if (version !== "v1" || !sig) return false;
    const given = Buffer.from(sig, "base64");
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}
