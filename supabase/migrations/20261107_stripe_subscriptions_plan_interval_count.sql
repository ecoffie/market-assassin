-- plan_interval alone cannot describe a Stripe price: a price billed every 6 months is
-- interval='month', interval_count=6. Without the count, $799 per 6 months was stored as
-- month and counted as $799/mo of MRR. Measured 2026-11-07 on 94 active subscriptions:
-- mirror $12,726.75 vs Stripe $10,729.25. Filled by every mirror writer and the daily sync.
ALTER TABLE stripe_subscriptions
  ADD COLUMN IF NOT EXISTS plan_interval_count INTEGER;

COMMENT ON COLUMN stripe_subscriptions.plan_interval_count IS
  'Stripe price recurring.interval_count (billed every N plan_interval). NULL = not yet synced, never assume 1.';
