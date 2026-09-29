-- Run once by hand against Neon, after 2026-09-29-newsletter.sql.
--
-- Discount codes moved from Stripe to Betty's own cloud service, where the
-- app actually looks them up (the app never used Stripe's codes). The site's
-- promo_codes table loses its Stripe columns: a code is now identified by
-- itself, and its terms are a line of text. Safe to run twice, and safe on a
-- database created with the current 2026-09-29 file — it does nothing there.
-- The table was empty when this was written; nothing in it is lost.

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_name = 'promo_codes' and column_name = 'stripe_id'
  ) then
    alter table promo_codes drop column stripe_id;
    alter table promo_codes drop column coupon_id;
    alter table promo_codes rename column coupon_label to terms;
    alter table promo_codes add constraint promo_codes_code_key unique (code);
  end if;
end $$;
