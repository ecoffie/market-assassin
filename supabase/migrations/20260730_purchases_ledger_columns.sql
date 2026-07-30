-- Fix: the Stripe webhook's purchase insert references 4 columns that don't exist,
-- so EVERY Mindy sale fails to record and the idempotency guard is dead.
--
-- Proven 2026-07-30: purchases has 0 Mindy rows despite 28 active $149/mo subs and
-- 21/21 webhook deliveries marked "delivered" by Stripe. Reproduced the insert:
--   "Could not find the 'bundle' column of 'purchases' in the schema cache"
--
-- The handler logs insertError and continues, so it returns 200 and Stripe never retries.
-- The dedup check .eq('stripe_session_id', ...) also errors on a missing column; its error
-- is discarded, so the "already processed" early-return NEVER fires — a webhook retry
-- re-runs the whole access-grant path.

alter table purchases add column if not exists stripe_session_id text;
alter table purchases add column if not exists tier              text;
alter table purchases add column if not exists bundle            text;
alter table purchases add column if not exists metadata          jsonb;

-- Idempotency: one row per Stripe Checkout session. This is what makes the
-- "Session already processed, skipping" guard actually work.
create unique index if not exists uniq_purchases_stripe_session_id
  on purchases (stripe_session_id)
  where stripe_session_id is not null;

-- Lookup path used by the dedup check and the admin dashboard.
create index if not exists idx_purchases_user_email_created
  on purchases (lower(user_email), created_at desc);

-- Verify (expect all 4 present):
select column_name, data_type
  from information_schema.columns
 where table_name = 'purchases'
   and column_name in ('stripe_session_id','tier','bundle','metadata')
 order by column_name;
