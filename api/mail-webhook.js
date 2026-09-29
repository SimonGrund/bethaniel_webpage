/* Resend's delivery events. Only two matter: a hard bounce and a spam
   complaint each stop all further mail to that address — mailing either
   again is what gets a sending domain blocked. */

import { verifyWebhook } from "./_lib/mail.js";
import { suppressEmail } from "./_lib/newsletter-store.js";
import { normaliseEmail } from "./_lib/signup.js";

/* The signature covers the exact bytes Resend sent, so the body is read
   from the stream. req.body must not be touched first: Vercel parses it
   lazily on access, and parsing consumes the stream. */
async function rawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).end();
  }
  const raw = await rawBody(req);
  if (!verifyWebhook(raw, req.headers, process.env.RESEND_WEBHOOK_SECRET)) {
    return res.status(401).end();
  }

  let event;
  try {
    event = JSON.parse(raw);
  } catch {
    return res.status(400).end();
  }

  let status = null;
  if (event.type === "email.complained") status = "complained";
  /* A transient bounce — a full mailbox, a server briefly down — is not a
     reason to give up on someone. */
  if (event.type === "email.bounced" && event.data?.bounce?.type !== "Transient") status = "bounced";
  if (!status) return res.status(204).end();

  try {
    for (const to of [].concat(event.data?.to ?? [])) {
      const email = normaliseEmail(to);
      if (email) await suppressEmail(email, status);
    }
  } catch (err) {
    /* A 500 makes Resend retry, which is what we want here. */
    console.error("mail webhook failed:", err.message);
    return res.status(500).end();
  }
  return res.status(204).end();
}
