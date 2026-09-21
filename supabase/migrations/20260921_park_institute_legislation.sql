-- Institute legislation — classify as PARKED / BLOCKED_CONTROLLED.
--
-- Product decision 2026-09-21. The source is NOT broken and NOT misleading; it
-- is explicitly blocked and reaches nobody, and the control plane should say so
-- rather than reporting `current` / `none_required`.
--
-- ── THE EVIDENCE ───────────────────────────────────────────────────────────
--   · `CONGRESS_API_KEY` is ABSENT in production (verified via `vercel env ls`).
--     The collector runs on a fallback key, so the configured credential for
--     this source does not exist.
--   · The corpus reaches ZERO customer surfaces: `sourced-pain-points` filters
--     `.eq('source','gao')`, and nothing else reads `institute_sources`. All 29
--     rows are held and unreachable.
--   · Scope is one statute family: 28 of 29 rows are NDAA, under ONE agency.
--   · The weekly job has never resolved an outcome (`dispatched`/NULL), so its
--     run row cannot establish health either way.
--
-- ── WHY THESE TWO VALUES ───────────────────────────────────────────────────
-- `source_state` describes the DATA. The corpus is genuinely quiet — the
-- watermark has sat at 2026-07-30 while the collector polls weekly — and NDAA
-- legislative activity is seasonal, so `upstream_quiet` is the honest member of
-- the vocabulary. NOT `current`, which would imply the source is delivering.
-- NOT `unreachable`, which would imply it is broken: it is not.
--
-- `intervention_state = 'blocked'` carries the parked fact, and
-- `manual_action_type = 'credential_renewal'` names what unblocks it.
--
-- The two states stay independent on purpose: a human acknowledgement must never
-- be able to render the DATA current.
--
-- ── WHAT IS PRESERVED ──────────────────────────────────────────────────────
-- All 29 rows, the source registration, the clocks and the cron row. The job
-- stays ENABLED: unlike DARPA/NSF it is not emitting false-green evidence — it
-- reports `dispatched`, which is honestly "unknown", and #1593 makes its real
-- outcome observable from the next run.
UPDATE public.data_source_instances
SET source_state       = 'upstream_quiet',
    intervention_state = 'blocked',
    manual_action_type = 'credential_renewal',
    updated_at         = NOW()
WHERE source_key = 'institute_legislation';

UPDATE public.cron_jobs
SET notes = coalesce(notes, '') ||
  ' | PARKED/BLOCKED_CONTROLLED 2026-09-21: CONGRESS_API_KEY absent in production'
  || ' (running on a fallback key) and the 29-row corpus reaches zero customer'
  || ' surfaces. Job left ENABLED — it is not emitting false-green evidence, and'
  || ' #1593 makes its outcome observable. Unblock = provision CONGRESS_API_KEY,'
  || ' then wire the corpus to a surface.'
WHERE job_name = 'institute-legislation-sync'
  AND coalesce(notes, '') NOT LIKE '%PARKED/BLOCKED_CONTROLLED%';
