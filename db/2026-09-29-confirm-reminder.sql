-- Run once by hand against Neon, after 2026-09-29-newsletter.sql.
--
-- One reminder to a signup nobody confirmed, three days in, sent by the
-- scheduler (/api/cron). This column is how it is never sent twice. Safe to
-- run twice. Until it has been run, the scheduler logs the reminders as
-- failed and carries on sending newsletters.

alter table subscribers add column if not exists reminder_sent_at timestamptz;
