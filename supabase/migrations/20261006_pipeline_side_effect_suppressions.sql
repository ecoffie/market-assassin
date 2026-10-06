-- Side-effect suppression for scanner-created pipeline rows (hotfix, 2026-10-06).
--
-- Before #1845, the daily alert's save link was a GET that inserted into user_pipeline, so mail
-- link scanners created pursuits nobody chose. Those rows keep generating downstream side effects:
-- "your pursuit changed" emails (3,408 sent so far) and automatic document fetches.
--
-- This migration does NOT touch user_pipeline. It adds:
--   1. pipeline_side_effect_suppressions — one AUDITED row per suppressed pursuit, with the reason,
--      the criteria version and the evidence. The pipeline row itself stays visible and unchanged.
--   2. scanner_save_candidates_v1(cutoff) — a read-only function returning ONLY the
--      high-confidence (T1) rows: a daily_alert save < 120 s after an alert to that user that
--      contained the notice, AND another daily_alert save for that user within ±1 s (the burst),
--      created before the cutoff (the #1845 deploy), with no user confirmation record.
--      Probable/indeterminate rows (T2–T5) are deliberately NOT returned: uncertain cases fail open.
--
-- Additive only. Populating the table is a separate, dry-run-first script
-- (scripts/record-scanner-save-suppressions.ts), not part of this migration.

CREATE TABLE IF NOT EXISTS public.pipeline_side_effect_suppressions (
  pipeline_id                   uuid PRIMARY KEY,
  user_email                    text        NOT NULL,
  reason                        text        NOT NULL,
  criteria_version              text        NOT NULL,
  evidence                      jsonb       NOT NULL,
  suppress_change_notifications boolean     NOT NULL DEFAULT true,
  suppress_doc_fetch            boolean     NOT NULL DEFAULT true,
  created_at                    timestamptz NOT NULL DEFAULT now(),
  created_by                    text
);

CREATE INDEX IF NOT EXISTS idx_pipeline_side_effect_suppressions_user
  ON public.pipeline_side_effect_suppressions (user_email);

ALTER TABLE public.pipeline_side_effect_suppressions ENABLE ROW LEVEL SECURITY;
-- No policies: service role only.
REVOKE ALL ON public.pipeline_side_effect_suppressions FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.scanner_save_candidates_v1(p_cutoff timestamptz)
RETURNS TABLE(
  pipeline_id uuid,
  user_email text,
  notice_id text,
  created_at timestamptz,
  alert_sent_at timestamptz,
  seconds_after_send numeric,
  burst_peers bigint
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
  WITH p AS (
    SELECT id, user_email, notice_id, created_at
    FROM user_pipeline
    WHERE source = 'daily_alert' AND created_at < p_cutoff AND notice_id IS NOT NULL
  ), g AS (
    SELECT p.*,
      (SELECT max(a.sent_at) FROM alert_log a
        WHERE a.user_email = p.user_email
          AND a.sent_at <= p.created_at
          AND a.sent_at > p.created_at - interval '2 days'
          AND a.opportunities_data @> jsonb_build_array(jsonb_build_object('noticeId', p.notice_id))) AS alert_sent_at,
      (SELECT count(*) FROM user_pipeline q
        WHERE q.source = 'daily_alert' AND q.user_email = p.user_email AND q.id <> p.id
          AND q.created_at BETWEEN p.created_at - interval '1 second' AND p.created_at + interval '1 second') AS burst_peers
    FROM p
  )
  SELECT g.id, g.user_email, g.notice_id, g.created_at, g.alert_sent_at,
         round(extract(epoch FROM (g.created_at - g.alert_sent_at))::numeric, 3),
         g.burst_peers
  FROM g
  WHERE g.alert_sent_at IS NOT NULL
    AND extract(epoch FROM (g.created_at - g.alert_sent_at)) < 120
    AND g.burst_peers >= 1
    AND NOT EXISTS (SELECT 1 FROM pipeline_save_confirmations s WHERE s.pipeline_id = g.id);
$function$;

REVOKE ALL ON FUNCTION public.scanner_save_candidates_v1(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.scanner_save_candidates_v1(timestamptz) TO service_role;
