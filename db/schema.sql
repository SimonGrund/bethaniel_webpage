-- Run once by hand against the Neon database.
-- No migration tooling: this is one table, and it does not change shape.
--
-- Deliberately absent: ip address, user-agent string, and any visitor or
-- device identifier — including a per-click id such as gclid/fbclid/msclkid,
-- which singles out one ad click and is joinable back to a person by the
-- platform that issued it. That absence is what keeps the site consent-free.
-- Do not add an identifying column here without revisiting the spec's
-- privacy position first.

create table if not exists events (
  id             bigserial primary key,
  occurred_at    timestamptz not null default now(),
  event          text not null,
  asset          text,
  form           text,
  source         text,
  medium         text,
  campaign       text,
  content        text,
  term           text,
  click_platform text,
  landing_path   text,
  referrer_host  text,
  country        text,
  ua_platform    text
);

create index if not exists events_occurred_at_idx on events (occurred_at);
create index if not exists events_event_idx on events (event, occurred_at);
