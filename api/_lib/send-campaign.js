/* Sending one campaign, a step at a time. A step sends batches of 100 until
   its time budget runs out, so neither the cron nor the browser's "Send now"
   ever depends on a whole list fitting inside one function invocation. */

import { renderNewsletter } from "./email-render.js";
import { sendBatch, siteUrl } from "./mail.js";
import {
  acquireLease, releaseLease, markSent, nextRecipients, recordDeliveries,
} from "./newsletter-store.js";

const BATCH = 100;
const LEASE_SECONDS = 90;
/* Stands in for each recipient's unsubscribe token, so the Markdown is
   rendered once per step rather than once per recipient. */
const TOKEN_SLOT = "__BETTY_TOKEN__";

export async function sendStep(campaignId, budgetMs) {
  const started = Date.now();
  const campaign = await acquireLease(campaignId, LEASE_SECONDS);
  /* Someone else holds the lease, or the campaign is not due or not
     sendable. Either way this step has nothing to do. */
  if (!campaign) return { busy: true, sent: 0 };

  const base = renderNewsletter(campaign, {
    unsubscribeUrl: `${siteUrl()}/api/newsletter?action=unsubscribe&t=${TOKEN_SLOT}`,
  });
  let sent = 0;
  try {
    while (Date.now() - started < budgetMs) {
      const recipients = await nextRecipients(campaign, BATCH);
      if (recipients.length === 0) {
        await markSent(campaign.id);
        return { done: true, sent };
      }
      const msgs = recipients.map((r) => {
        const unsubscribeUrl = `${siteUrl()}/api/newsletter?action=unsubscribe&t=${r.token}`;
        return {
          to: r.email,
          subject: base.subject,
          html: base.html.replaceAll(TOKEN_SLOT, r.token),
          text: base.text.replaceAll(TOKEN_SLOT, r.token),
          unsubscribeUrl,
        };
      });
      /* Covers the one gap the deliveries table cannot: Resend accepted the
         batch, then this function died before recording it. The retry picks
         the same recipients and so the same key, and Resend sends nothing. */
      const ids = recipients.map((r) => r.id);
      await sendBatch(msgs, `campaign-${campaign.id}-${ids[0]}-${ids.at(-1)}-${ids.length}`);
      await recordDeliveries(campaign.id, ids);
      sent += ids.length;
    }
    return { done: false, sent };
  } finally {
    await releaseLease(campaign.id);
  }
}
