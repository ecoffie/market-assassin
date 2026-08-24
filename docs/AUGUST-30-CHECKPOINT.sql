-- AUGUST 30 CHECKPOINT — run all three together.
-- Baseline set 2026-08-23, the day after launch. All three verified to RUN and to reproduce
-- these numbers on that date, so a failure on the 30th is a real change, not a broken query:
--
--   connected 109 · activated 35 · still silent 74 · activation 32.1%
--   returned on 2+ days: 7 of 35
--   paywall attempts: 1 (v1) — far too few to read; the funnel was frozen 2026-08-23
--
-- WHAT COUNTS AS ACTIVATED: one status='success' call. Not a prompt copied, not an app
-- opened, not a tool invoked and refused — a grounded answer actually received. The four
-- refusal states (rejected_no_credits, requires_paid, gated, uncharged) are deliberately
-- excluded: a user who hit a wall did not get value.
--
-- READ IN ORDER. Activation without return is a novelty, not a habit — query 2 is the one
-- that says whether a first question became a behaviour.

-- 1. ACTIVATION: did a relevant first question move the connected-but-silent population?
--    "Activated" = at least one status='success' call. Not a copy, not an app open —
--    a grounded answer actually received.
WITH connected AS (
  SELECT DISTINCT user_email FROM mcp_oauth_tokens WHERE created_at >= '2026-08-20'
),
activated AS (
  SELECT DISTINCT user_email FROM mcp_call_log
  WHERE created_at >= '2026-08-20' AND status = 'success'
)
SELECT
  (SELECT count(*) FROM connected)                                            AS connected,
  (SELECT count(*) FROM activated)                                            AS activated,
  (SELECT count(*) FROM connected c
     WHERE NOT EXISTS (SELECT 1 FROM activated a WHERE a.user_email = c.user_email)) AS still_silent,
  round(100.0 * (SELECT count(*) FROM activated) / NULLIF((SELECT count(*) FROM connected), 0), 1) AS activation_pct;

-- 2. RETURN: activation is only real if they come back. Distinct days with a grounded call.
SELECT count(*) FILTER (WHERE days >= 2) AS returned_2plus_days,
       count(*)                          AS activated_total
FROM (
  SELECT user_email, count(DISTINCT date_trunc('day', created_at)) AS days
  FROM mcp_call_log
  WHERE created_at >= '2026-08-20' AND status = 'success'
  GROUP BY user_email
) t;

-- 3. PAYWALL FUNNEL (frozen since 2026-08-23; v1 offer only).
--    Read purchase/rejection FIRST, then completion/purchase — a gap in the second means
--    people paid and never got the thing.
SELECT offer_version,
       count(*)                                              AS rejected,
       count(*) FILTER (WHERE checkout_started_at IS NOT NULL) AS checkout_started,
       count(*) FILTER (WHERE purchased_at IS NOT NULL)        AS purchased,
       count(*) FILTER (WHERE completed_at IS NOT NULL)        AS completed
FROM mcp_paywall_attempts
GROUP BY offer_version;
