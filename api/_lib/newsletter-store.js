/* The newsletter's tables: subscribers, campaigns, deliveries.
   Kept apart from the analytics queries in db.js on purpose — the two are
   separate processings, and nothing here touches `events`. */

import { randomBytes } from "node:crypto";
import { sql } from "./db.js";

export function newToken() {
  return randomBytes(24).toString("base64url");
}

/* ── Subscribers ─────────────────────────────────────────────────────── */

/* A signup. An address that unsubscribed and signs up again is asking to be
   back: it returns to pending and must confirm again. A bounced or
   complained address keeps its status — it is suppressed, and the caller
   sends it nothing. */
export async function upsertPending({ email, lang, source }) {
  const rows = await sql()`
    insert into subscribers (email, lang, source, token)
    values (${email}, ${lang}, ${source}, ${newToken()})
    on conflict (email) do update set
      lang = excluded.lang,
      status = case when subscribers.status = 'unsubscribed'
                    then 'pending' else subscribers.status end,
      unsubscribed_at = case when subscribers.status = 'unsubscribed'
                             then null else subscribers.unsubscribed_at end
    returning *
  `;
  return rows[0];
}

/* coalesce, so two signups racing each other keep the first code minted. */
export async function setDiscountCode(id, code) {
  const rows = await sql()`
    update subscribers set discount_code = coalesce(discount_code, ${code})
    where id = ${id}
    returning discount_code
  `;
  return rows[0]?.discount_code ?? null;
}

/* At most one welcome per address per 10 minutes: the endpoint is public,
   and must not be a way to fill a stranger's inbox. */
export async function claimWelcome(id) {
  const rows = await sql()`
    update subscribers set welcome_sent_at = now()
    where id = ${id}
      and (welcome_sent_at is null or welcome_sent_at < now() - interval '10 minutes')
    returning id
  `;
  return rows.length === 1;
}

/* A welcome that failed to send was not sent: let the visitor try again. */
export async function releaseWelcome(id) {
  await sql()`update subscribers set welcome_sent_at = null where id = ${id}`;
}

export async function byToken(token) {
  const rows = await sql()`select * from subscribers where token = ${token}`;
  return rows[0] ?? null;
}

export async function confirmByToken(token) {
  const rows = await sql()`
    update subscribers
    set status = 'confirmed', confirmed_at = coalesce(confirmed_at, now())
    where token = ${token} and status in ('pending', 'confirmed')
    returning *
  `;
  return rows[0] ?? null;
}

export async function unsubscribeByToken(token) {
  const rows = await sql()`
    update subscribers
    set status = 'unsubscribed', unsubscribed_at = now()
    where token = ${token} and status in ('pending', 'confirmed')
    returning *
  `;
  return rows[0] ?? null;
}

/* From the Resend webhook: a hard bounce or a spam complaint. */
export async function suppressEmail(email, status) {
  const rows = await sql()`
    update subscribers set status = ${status}
    where email = ${email} and status in ('pending', 'confirmed')
    returning id
  `;
  return rows.length;
}

export async function subscriberCounts() {
  const rows = await sql()`
    select status, count(*)::int as n from subscribers group by status
  `;
  return Object.fromEntries(rows.map((r) => [r.status, r.n]));
}

export async function listSubscribers({ q, status, limit, offset }) {
  const pattern = q ? `%${q.toLowerCase().replace(/[\\%_]/g, "\\$&")}%` : null;
  return await sql()`
    select id, email, lang, source, status, discount_code,
           created_at, confirmed_at, unsubscribed_at
    from subscribers
    where (${pattern}::text is null or email like ${pattern})
      and (${status ?? null}::text is null or status = ${status ?? null})
    order by id desc
    limit ${limit} offset ${offset}
  `;
}

export async function allSubscribers() {
  return await sql()`
    select email, lang, source, status, discount_code,
           created_at, confirmed_at, unsubscribed_at
    from subscribers order by id
  `;
}

export async function deleteSubscriber(id) {
  const rows = await sql()`delete from subscribers where id = ${id} returning id`;
  return rows.length;
}

/* Imported addresses opted in elsewhere, so they arrive confirmed. An
   address already here — in any status — is left exactly as it is: an
   import must never resubscribe someone who unsubscribed. */
export async function importEmails(emails, lang) {
  const tokens = emails.map(() => newToken());
  const rows = await sql()`
    insert into subscribers (email, lang, source, status, token, confirmed_at)
    select e, ${lang}, 'import', 'confirmed', t, now()
    from unnest(${emails}::text[], ${tokens}::text[]) as x(e, t)
    on conflict (email) do nothing
    returning id
  `;
  return rows.length;
}

/* ── Campaigns ───────────────────────────────────────────────────────── */

export async function listCampaigns() {
  return await sql()`
    select c.id, c.subject, c.preheader, c.theme, c.lang, c.status,
           c.send_at, c.sent_at, c.created_at, c.updated_at,
           (select count(*)::int from deliveries d where d.campaign_id = c.id) as delivered
    from campaigns c
    order by coalesce(c.send_at, c.updated_at) desc, c.id desc
  `;
}

export async function getCampaign(id) {
  const rows = await sql()`
    select c.*,
           (select count(*)::int from deliveries d where d.campaign_id = c.id) as delivered
    from campaigns c where c.id = ${id}
  `;
  return rows[0] ?? null;
}

export async function createCampaign(f) {
  const rows = await sql()`
    insert into campaigns (subject, preheader, body_md, theme, lang)
    values (${f.subject}, ${f.preheader}, ${f.body_md}, ${f.theme}, ${f.lang})
    returning *
  `;
  return rows[0];
}

/* Only a campaign that has not started sending can be edited. Editing a
   scheduled one keeps its schedule. */
export async function updateCampaign(id, f) {
  const rows = await sql()`
    update campaigns set
      subject = ${f.subject}, preheader = ${f.preheader}, body_md = ${f.body_md},
      theme = ${f.theme}, lang = ${f.lang}, updated_at = now()
    where id = ${id} and status in ('draft', 'scheduled')
    returning *
  `;
  return rows[0] ?? null;
}

export async function deleteCampaign(id) {
  const rows = await sql()`
    delete from campaigns where id = ${id} and status in ('draft', 'scheduled')
    returning id
  `;
  return rows.length;
}

export async function scheduleCampaign(id, sendAt) {
  const rows = await sql()`
    update campaigns set status = 'scheduled', send_at = ${sendAt}, updated_at = now()
    where id = ${id} and status in ('draft', 'scheduled')
    returning *
  `;
  return rows[0] ?? null;
}

export async function unscheduleCampaign(id) {
  const rows = await sql()`
    update campaigns set status = 'draft', send_at = null, updated_at = now()
    where id = ${id} and status = 'scheduled'
    returning *
  `;
  return rows[0] ?? null;
}

export async function dueCampaignIds() {
  const rows = await sql()`
    select id from campaigns
    where status in ('scheduled', 'sending') and send_at <= now()
    order by send_at
  `;
  return rows.map((r) => r.id);
}

/* The lease is what stops the cron and a "Send now" in the browser from
   sending the same campaign side by side. It outlives one send step, and
   lapses on its own if a function dies holding it. */
export async function acquireLease(id, seconds) {
  const rows = await sql()`
    update campaigns
    set status = 'sending', lease_until = now() + make_interval(secs => ${seconds})
    where id = ${id} and status in ('scheduled', 'sending') and send_at <= now()
      and (lease_until is null or lease_until < now())
    returning *
  `;
  return rows[0] ?? null;
}

export async function releaseLease(id) {
  await sql()`update campaigns set lease_until = null where id = ${id}`;
}

export async function markSent(id) {
  await sql()`
    update campaigns set status = 'sent', sent_at = now(), lease_until = null
    where id = ${id}
  `;
}

export async function audienceSize(lang) {
  const rows = await sql()`
    select count(*)::int as n from subscribers
    where status = 'confirmed' and (${lang}::text is null or lang = ${lang})
  `;
  return rows[0].n;
}

export async function nextRecipients(campaign, limit) {
  return await sql()`
    select s.id, s.email, s.token, s.lang from subscribers s
    where s.status = 'confirmed'
      and (${campaign.lang}::text is null or s.lang = ${campaign.lang})
      and not exists (
        select 1 from deliveries d
        where d.campaign_id = ${campaign.id} and d.subscriber_id = s.id
      )
    order by s.id
    limit ${limit}
  `;
}

export async function recordDeliveries(campaignId, subscriberIds) {
  await sql()`
    insert into deliveries (campaign_id, subscriber_id)
    select ${campaignId}, unnest(${subscriberIds}::bigint[])
    on conflict do nothing
  `;
}

/* ── Settings ────────────────────────────────────────────────────────── */

/* The welcome discount is on unless switched off: that is what the
   site's copy promises by default once the offer is confirmed live. */
const SETTING_DEFAULTS = { welcome_discount: true };

export async function getSetting(key) {
  const rows = await sql()`select value from settings where key = ${key}`;
  return rows.length ? rows[0].value : SETTING_DEFAULTS[key];
}

export async function setSetting(key, value) {
  await sql()`
    insert into settings (key, value) values (${key}, ${JSON.stringify(value)}::jsonb)
    on conflict (key) do update set value = excluded.value, updated_at = now()
  `;
}

/* ── Hand-minted codes ───────────────────────────────────────────────── */

export async function recordPromoCode(r) {
  await sql()`
    insert into promo_codes
      (stripe_id, code, coupon_id, coupon_label, max_redemptions, expires_at, note, created_by)
    values
      (${r.stripe_id}, ${r.code}, ${r.coupon_id}, ${r.coupon_label}, ${r.max_redemptions},
       ${r.expires_at}, ${r.note}, ${r.created_by})
  `;
}

export async function listPromoCodes(limit) {
  return await sql()`
    select id, stripe_id, code, coupon_id, coupon_label, max_redemptions,
           expires_at, note, created_by, created_at
    from promo_codes order by id desc limit ${limit}
  `;
}

export async function welcomeCodeCount() {
  const rows = await sql()`select count(*)::int as n from subscribers where discount_code is not null`;
  return rows[0].n;
}

export async function getPromoCode(id) {
  const rows = await sql()`select id, stripe_id, code from promo_codes where id = ${id}`;
  return rows[0] ?? null;
}

/* The privacy policy's promise: an address never confirmed is deleted
   after 90 days. Run by the scheduler, so it needs no job of its own. */
export async function purgeUnconfirmed(days) {
  const rows = await sql()`
    delete from subscribers
    where status = 'pending' and created_at < now() - make_interval(days => ${days})
    returning id
  `;
  return rows.length;
}
