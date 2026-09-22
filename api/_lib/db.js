/* The only module that talks to Postgres.
   neon() speaks HTTP rather than holding a TCP connection: serverless
   invocations come and go too fast for a pool, which would exhaust
   connections under any real concurrency. */

import { neon } from "@neondatabase/serverless";

export const MISSING_DATABASE_URL = "DATABASE_URL is not set";

let cached;

function sql() {
  if (!process.env.DATABASE_URL) throw new Error(MISSING_DATABASE_URL);
  cached ??= neon(process.env.DATABASE_URL);
  return cached;
}

export async function insertEvent(row, { country, ua_platform }) {
  const q = sql();
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

export async function queryEvents(from, to) {
  const q = sql();
  return await q`
    select occurred_at, event, asset, source, medium, campaign
    from events
    where occurred_at >= ${from} and occurred_at < ${to}
    order by occurred_at
  `;
}
