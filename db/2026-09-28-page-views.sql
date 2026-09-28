-- Page views. Run once by hand against the Neon database, like schema.sql.
-- Safe to run twice.
--
-- page:  which page was viewed, normalised to one spelling and checked
--        against the site's own pages (anything else is stored as null).
-- entry: true on the first page of a browser session, false after it. A
--        visit is an entry view; the flag that decides it lives in the
--        visitor's sessionStorage and is sent only as this boolean — it is
--        not an identifier, and no two rows can be tied to the same visitor.

alter table events add column if not exists page  text;
alter table events add column if not exists entry boolean;
