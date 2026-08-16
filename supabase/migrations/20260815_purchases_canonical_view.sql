-- Purchases ledger: one row per checkout session, in one unit.
--
-- THE BUG THIS ADDRESSES
-- TWO Stripe webhooks in TWO repos write this same table, with different
-- column and unit conventions, and each dedups on its OWN column — so neither
-- ever sees the other's row:
--
--   market-assassin  /api/stripe-webhook  -> stripe_session_id, amount in DOLLARS
--   govcon-shop      /api/stripe-webhook  -> order_id,          amount in CENTS
--
-- Measured 2026-08-15: 283 rows covering 161 distinct checkout sessions.
-- 121 sessions are recorded TWICE — once by each writer. Any SUM over this
-- table overstates revenue by $20,858 (~22%), and any per-unit assumption is
-- wrong for roughly half the rows.
--
-- NOTHING IS DELETED. Duplicate rows are marked, not removed: they are the
-- only record of what each writer actually did, and the shop-side row carries
-- the true session id for its half. Readers use the view.

-- 1) A stable place to record "this row is a duplicate of another".
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS superseded_by UUID REFERENCES purchases(id);
COMMENT ON COLUMN purchases.superseded_by IS
  'Set when this row duplicates another (same Stripe checkout session written by the other repo''s webhook). The row is kept for provenance; readers should exclude it. NULL = canonical.';

-- 2) The session id, wherever the writer happened to put it.
CREATE OR REPLACE FUNCTION purchases_session_id(p purchases) RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p.stripe_session_id LIKE 'cs_%' THEN p.stripe_session_id
    WHEN p.order_id          LIKE 'cs_%' THEN p.order_id
    ELSE NULL
  END
$$;

-- 3) Amount in CENTS regardless of which writer produced the row.
--    Heuristic, and deliberately conservative: every real product here is >= $10,
--    so a stored value under 1000 can only be dollars. Documented rather than
--    guessed at each call site.
CREATE OR REPLACE FUNCTION purchases_amount_cents(p purchases) RETURNS BIGINT
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN COALESCE(p.amount_paid, 0) >= 1000 THEN (p.amount_paid)::BIGINT
    ELSE (COALESCE(p.amount_paid, 0) * 100)::BIGINT
  END
$$;

-- 4) THE READ SURFACE. Query this, not `purchases`.
CREATE OR REPLACE VIEW purchases_canonical AS
SELECT
  p.*,
  purchases_session_id(p)   AS session_id,
  purchases_amount_cents(p) AS amount_cents
FROM purchases p
WHERE p.superseded_by IS NULL;

COMMENT ON VIEW purchases_canonical IS
  'One row per checkout session with amount_cents normalized. Excludes rows marked superseded_by. Use this for ANY revenue or customer count — the base table double-counts every session written by both the market-assassin and govcon-shop webhooks.';

-- 5) The guard index that stops a THIRD double-write lives in the FOLLOW-UP
--    migration, 20260816_purchases_session_unique.sql — deliberately not here.
--
--    Ordering bug this fixes (hit on the first --go, 2026-08-15): the index is
--    UNIQUE over rows where superseded_by IS NULL, but on a live table with 121
--    already-duplicated sessions nothing is marked yet, so Postgres rejects it
--    (23505) and the whole migration rolls back. The column has to exist before
--    the marking script can run, and the marking has to finish before the
--    uniqueness constraint can hold. One file cannot do both.
--
--    So: this migration ships the column + helpers + view. Then
--    `npx tsx scripts/audit-purchases-duplicates.ts --mark` marks the
--    duplicates. Then the follow-up migration adds the index.
