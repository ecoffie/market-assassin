-- Paywall attempts: the record of "someone wanted a premium tool and could not have it".
--
-- WHY: when a metered call is refused for credits (or a Pro gate), the request itself was
-- discarded. That cost us two things at once:
--
--   1. RESUME — after they pay there is nothing to put them back into, so a user who just
--      bought lands on a dashboard instead of the report they were three seconds from.
--   2. MEASUREMENT — `rejected_no_credits` in mcp_call_log says a refusal happened, but not
--      what they were reaching for. That makes "wanted another report, hit the wall, did not
--      buy" indistinguishable from "never wanted another report" — two completely different
--      product problems that need opposite fixes.
--
-- One row per refused attempt, carrying the whole funnel:
--   rejected → checkout_started → purchased → resumed → completed
--
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS mcp_paywall_attempts (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_email         text NOT NULL,
  tool_name          text NOT NULL,
  -- The exact arguments, so the request can be reconstructed verbatim after payment.
  args               jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- 'insufficient_credits' | 'requires_pro'
  reason             text NOT NULL,
  credits_required   integer,
  balance_at_attempt integer,

  rejected_at        timestamptz NOT NULL DEFAULT now(),
  checkout_started_at timestamptz,
  purchased_at       timestamptz,
  resumed_at         timestamptz,
  completed_at       timestamptz,

  -- Set once the attempt is consumed so a single purchase cannot replay forever.
  consumed_at        timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

-- The hot read: "does this user have a pending attempt to resume?"
CREATE INDEX IF NOT EXISTS mcp_paywall_attempts_pending_idx
  ON mcp_paywall_attempts (user_email, rejected_at DESC)
  WHERE consumed_at IS NULL;

-- Cohort analysis by funnel stage.
CREATE INDEX IF NOT EXISTS mcp_paywall_attempts_rejected_at_idx
  ON mcp_paywall_attempts (rejected_at DESC);

CREATE INDEX IF NOT EXISTS mcp_paywall_attempts_tool_idx
  ON mcp_paywall_attempts (tool_name, rejected_at DESC);

COMMENT ON TABLE mcp_paywall_attempts IS
  'One row per premium tool call refused at the paywall. Carries the full rejected -> checkout -> purchase -> resume -> complete funnel, and the args needed to resume the exact request after payment.';
COMMENT ON COLUMN mcp_paywall_attempts.args IS
  'Verbatim tool arguments. Lets us restore the exact request (e.g. NAICS 541512 x Virginia) rather than dropping a paying user on a dashboard.';
COMMENT ON COLUMN mcp_paywall_attempts.consumed_at IS
  'Set when the attempt has been resumed or explicitly dismissed. Prevents one purchase from replaying an attempt repeatedly.';
COMMENT ON COLUMN mcp_paywall_attempts.completed_at IS
  'The run actually finished after resume. completed_at IS NULL with resumed_at set = they clicked Run and it failed or was abandoned.';

-- Service-role only; nothing here is client-readable.
ALTER TABLE mcp_paywall_attempts ENABLE ROW LEVEL SECURITY;
