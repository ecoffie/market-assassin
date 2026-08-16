-- Guard index: one checkout session, one canonical purchase row.
--
-- SPLIT FROM 20260815_purchases_canonical_view.sql, which tried to create this in
-- the same file that defines `superseded_by`. That cannot work on the live table:
-- the index is UNIQUE over rows where superseded_by IS NULL, and at that point all
-- 121 duplicated sessions are still unmarked, so Postgres rejects it with 23505 and
-- rolls the whole migration back. Verified by running it.
--
-- RUN ORDER (all three steps, in this order):
--   1. 20260815_purchases_canonical_view.sql   — adds superseded_by + view
--   2. npx tsx scripts/audit-purchases-duplicates.ts --mark
--   3. THIS FILE                                — adds the index
--
-- If step 2 has not run, this migration fails the same way — which is the correct
-- behaviour. A silently-skipped guard is how the double-write went unnoticed for
-- six months in the first place.
--
-- Two Stripe webhooks in two repos write `purchases` with different column and unit
-- conventions (market-assassin -> stripe_session_id/dollars, govcon-shop ->
-- order_id/cents), and each dedups on its OWN column, so neither sees the other's
-- row. This index is what makes a third one impossible.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_purchases_session_any
  ON purchases ((COALESCE(NULLIF(stripe_session_id, ''), NULLIF(order_id, ''))))
  WHERE superseded_by IS NULL
    AND COALESCE(NULLIF(stripe_session_id, ''), NULLIF(order_id, '')) LIKE 'cs_%';
