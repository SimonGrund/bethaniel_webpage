/* The only module that talks to Postgres — with newsletter-store.js, which
   borrows sql() from here for the newsletter's tables.
   neon() speaks HTTP rather than holding a TCP connection: serverless
   invocations come and go too fast for a pool, which would exhaust
   connections under any real concurrency. */

import { neon } from "@neondatabase/serverless";

export const MISSING_DATABASE_URL = "DATABASE_URL is not set";

let cached;

export function sql() {
  if (!process.env.DATABASE_URL) throw new Error(MISSING_DATABASE_URL);
  cached ??= neon(process.env.DATABASE_URL);
  return cached;
}

/* Postgres's code for a column that does not exist. The page and entry
   columns arrive with db/2026-09-28-page-views.sql, which is run by hand;
   until it has been, the code below falls back to the columns every
   database has, so a deploy that lands first costs page views, never a
   download or an enquiry. */
const UNDEFINED_COLUMN = "42703";

export async function insertEvent(row, { country, ua_platform }) {
  const q = sql();
  try {
    await q`
      insert into events (
        event, asset, form, source, medium, campaign, content, term,
        click_platform, landing_path, referrer_host,
        country, ua_platform, page, entry
      ) values (
        ${row.event}, ${row.asset}, ${row.form}, ${row.source}, ${row.medium},
        ${row.campaign}, ${row.content}, ${row.term},
        ${row.click_platform}, ${row.landing_path}, ${row.referrer_host},
        ${country ?? null}, ${ua_platform ?? null},
        ${row.page ?? null}, ${row.entry ?? null}
      )
    `;
  } catch (err) {
    if (err.code !== UNDEFINED_COLUMN || row.event === "view") throw err;
    await q`
      insert into events (
        event, asset, form, source, medium, campaign, content, term,
        click_platform, landing_path, referrer_host,
        country, ua_platform
      ) values (
        ${row.event}, ${row.asset}, ${row.form}, ${row.source}, ${row.medium},
        ${row.campaign}, ${row.content}, ${row.term},
        ${row.click_platform}, ${row.landing_path}, ${row.referrer_host},
        ${country ?? null}, ${ua_platform ?? null}
      )
    `;
  }
}

export async function queryEvents(from, to) {
  const q = sql();
  try {
    return await q`
      select occurred_at, event, asset, source, medium, campaign, click_platform,
             page, entry
      from events
      where occurred_at >= ${from} and occurred_at < ${to}
      order by occurred_at
    `;
  } catch (err) {
    if (err.code !== UNDEFINED_COLUMN) throw err;
    return await q`
      select occurred_at, event, asset, source, medium, campaign, click_platform
      from events
      where occurred_at >= ${from} and occurred_at < ${to}
      order by occurred_at
    `;
  }
}

export async function deleteEvents({ from, to, source, medium, campaign }) {
  const q = sql();
  /* source/medium/campaign are raw column values, which may be null — `=`
     never matches NULL, so a genuinely unattributed row (or a campaign
     legitimately named the same as a display placeholder) requires
     `is not distinct from` instead. The date range is bounded the same way
     queryEvents bounds it: >= from and < to, both required by the caller. */
  const rows = await q`
    delete from events
    where occurred_at >= ${from} and occurred_at < ${to}
      and source is not distinct from ${source}
      and medium is not distinct from ${medium}
      and campaign is not distinct from ${campaign}
    returning id
  `;
  return rows.length;
}
