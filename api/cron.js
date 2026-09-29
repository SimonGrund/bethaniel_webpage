/* Sends whatever is due. Called every 15 minutes by
   .github/workflows/newsletter-cron.yml; on Vercel Pro it could be a
   vercel.json cron instead, which sends the same Authorization header. */

import { timingSafeEqual } from "node:crypto";
import {
  dueCampaignIds, purgeUnconfirmed, dueReminders, claimReminder, releaseReminder, getSetting,
} from "./_lib/newsletter-store.js";
import { sendStep } from "./_lib/send-campaign.js";
import { renderReminder } from "./_lib/email-render.js";
import { sendOne, subscriberLink } from "./_lib/mail.js";

/* At most this many reminders a run; the scheduler runs every 15 minutes. */
const REMINDERS_PER_RUN = 30;

/* One reminder per unconfirmed signup, three days in, and never a second.
   Claimed before sending, released if the send fails. */
async function sendReminders() {
  const due = await dueReminders(REMINDERS_PER_RUN);
  if (!due.length) return 0;
  const offerOn = (await getSetting("welcome_discount")) === true;
  let sent = 0;
  for (const sub of due) {
    if (!(await claimReminder(sub.id))) continue;
    const unsubscribeUrl = subscriberLink("unsubscribe", sub.token);
    try {
      const mail = renderReminder({
        lang: sub.lang,
        confirmUrl: subscriberLink("confirm", sub.token),
        unsubscribeUrl,
        offer: offerOn && !sub.discount_code,
      });
      await sendOne({ to: sub.email, ...mail, unsubscribeUrl });
      sent += 1;
    } catch (err) {
      await releaseReminder(sub.id);
      console.error("newsletter reminder failed:", err.message);
    }
  }
  return sent;
}

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
    /* A failure here must not stop the newsletters below. It is what
       happens if db/2026-09-29-confirm-reminder.sql has not been run. */
    try {
      results.reminded = await sendReminders();
    } catch (err) {
      console.error("newsletter reminders failed:", err.message);
      results.reminded = "error";
    }
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
