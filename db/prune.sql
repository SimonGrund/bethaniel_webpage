-- Retention. Run by hand every few months; there is no cron job for this.
-- 400 days keeps a full year of year-on-year comparison and no more.
delete from events where occurred_at < now() - interval '400 days';
