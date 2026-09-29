-- Run once by hand against the Neon database, like schema.sql.
--
-- The newsletter is a separate, consented processing from the analytics in
-- `events`: nothing here references that table, and nothing may join the two.
-- See docs/superpowers/specs/2026-09-29-first-party-newsletter-design.md.

create table if not exists subscribers (
  id               bigserial primary key,
  email            text not null unique,          -- always lower-cased
  lang             text not null default 'en',
  source           text,                          -- phone | download | footer | import
  status           text not null default 'pending', -- pending | confirmed | unsubscribed | bounced | complained
  token            text not null unique,          -- confirm and unsubscribe links
  discount_code    text,
  created_at       timestamptz not null default now(),
  confirmed_at     timestamptz,
  unsubscribed_at  timestamptz,
  welcome_sent_at  timestamptz,
  reminder_sent_at timestamptz                    -- the one reminder; see 2026-09-29-confirm-reminder.sql
);

create index if not exists subscribers_status_idx on subscribers (status, id);

create table if not exists campaigns (
  id           bigserial primary key,
  subject      text not null default '',
  preheader    text not null default '',
  body_md      text not null default '',
  theme        text not null default 'parchment',
  lang         text,                              -- null: every language
  status       text not null default 'draft',     -- draft | scheduled | sending | sent
  send_at      timestamptz,
  sent_at      timestamptz,
  lease_until  timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists campaigns_due_idx on campaigns (status, send_at);

create table if not exists deliveries (
  campaign_id    bigint not null references campaigns (id) on delete cascade,
  subscriber_id  bigint not null references subscribers (id) on delete cascade,
  sent_at        timestamptz not null default now(),
  primary key (campaign_id, subscriber_id)
);

-- Switches the admin page flips. One row per setting; a missing row means
-- the default in api/_lib/newsletter-store.js.
create table if not exists settings (
  key         text primary key,
  value       jsonb not null,
  updated_at  timestamptz not null default now()
);

-- Codes minted by hand from /admin. The codes themselves live in Betty's
-- own cloud service, where the app looks them up; this is the site's record
-- of which it minted, for whom, on what terms. The welcome codes are not
-- here — each lives on its subscriber row. Usage is read live from the
-- cloud service, the only place it is true. (Shape as of
-- 2026-09-30-promo-codes-in-the-app.sql.)
create table if not exists promo_codes (
  id               bigserial primary key,
  code             text not null unique,
  terms            text not null,
  max_redemptions  integer,
  expires_at       timestamptz,
  note             text,
  created_by       text not null,
  created_at       timestamptz not null default now()
);
