-- Ops incidents: notification state for the cron watchdog (one row per incident key).
--
-- WHY: dispatcher-watchdog posted to Slack on every 3-hourly pass with no memory, so an
-- unchanged failure re-notified 8x/day (replay 2026-10-01 09:00 -> 10-05 06:00: 32 posts,
-- 31 carrying the same saved-search-alerts failure). See src/lib/cron/watchdog-incidents.ts.
--
-- This table holds NOTIFICATION state only. Every failed run stays in cron_job_runs.
--
-- Concurrency: every write is either INSERT ... ON CONFLICT DO NOTHING (open) or
-- UPDATE ... WHERE incident_key = $1 AND version = $2 (compare-and-set), so two overlapping
-- watchdog runs cannot both claim the same notification.
--
-- Access: service_role only (the watchdog route). RLS enabled AND forced, one service_role
-- policy, explicit REVOKE from anon/authenticated/PUBLIC — same pattern as org_member_invites /
-- mcp_credit_* (20260929_pooled_team_credits.sql, mcp_credit_* migrations).
--
-- Idempotent: safe to re-run. No DROP TABLE / DELETE / TRUNCATE; the only DROP is the guarded
-- DROP POLICY IF EXISTS that precedes its own CREATE POLICY.
CREATE TABLE IF NOT EXISTS public.ops_incidents (
  incident_key        text PRIMARY KEY,                -- e.g. 'failing:saved-search-alerts'
  source              text NOT NULL,                   -- 'dispatcher-watchdog'
  kind                text NOT NULL,                   -- failing | stuck | overdue | dispatcher_down | daily_summary
  job_name            text,
  status              text NOT NULL DEFAULT 'open'
                        CHECK (status IN ('open', 'resolved')),
  signature           text,                            -- stable failure identity (no volatile counts)
  processing_counts   jsonb NOT NULL DEFAULT '{}'::jsonb, -- latest customer-impacting class counts
  notified_counts     jsonb NOT NULL DEFAULT '{}'::jsonb, -- processing counts at the last notification
  suppression_counts  jsonb NOT NULL DEFAULT '{}'::jsonb, -- latest CONFIRMED recipient-suppression counts
  last_detail         text,
  opened_at           timestamptz NOT NULL DEFAULT now(),
  last_seen_at        timestamptz NOT NULL DEFAULT now(),
  resolved_at         timestamptz,
  observations        integer NOT NULL DEFAULT 1 CHECK (observations >= 0),
  last_notified_at    timestamptz,                     -- set when a post is CLAIMED (lease start)
  last_notified_event text,
  notify_pending      text,                            -- claimed post not yet confirmed delivered
  notify_attempts     integer NOT NULL DEFAULT 0 CHECK (notify_attempts >= 0),
  version             integer NOT NULL DEFAULT 0 CHECK (version >= 0),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- Re-run safety for an environment that created the table before notify_attempts existed.
ALTER TABLE public.ops_incidents ADD COLUMN IF NOT EXISTS notify_attempts integer NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS ops_incidents_source_status_idx ON public.ops_incidents (source, status);

COMMENT ON TABLE public.ops_incidents IS
  'Incident-based notification state for the cron watchdog. Notify on open / material change / worsening / recovery; unchanged incidents go to one daily summary. Run history stays in cron_job_runs.';

ALTER TABLE public.ops_incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ops_incidents FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ops_incidents_service ON public.ops_incidents;
CREATE POLICY ops_incidents_service ON public.ops_incidents
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.ops_incidents FROM anon, authenticated, PUBLIC;
