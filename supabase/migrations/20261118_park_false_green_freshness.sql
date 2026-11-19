-- Inventory honesty: DIBBS + null-clock demotion (Eric 2026-11-18, Agent 3 re-scope).
--
-- ── HISTORY ────────────────────────────────────────────────────────────────
-- An earlier draft of this file ALSO parked sync-dod-sbir (enabled=false). That
-- section was REMOVED before any production apply. Measured 2026-11-18: prod
-- still has sync-dod-sbir enabled=true — this migration was never applied.
-- Eric's approved scope: keep SBIR cron enabled; prefer controlled retries +
-- honest 503 + automatic recovery when sbir.gov returns. Do NOT park SBIR.
--
-- If you find a copy of this filename that still contains
--   UPDATE cron_jobs … WHERE job_name = 'sync-dod-sbir' … enabled = FALSE
-- do NOT run that statement. SBIR recovery is code-side (retries + empty→503).
--
-- ── THE DEFECT ─────────────────────────────────────────────────────────────
-- Measured live 2026-11-18 against production:
--
--   sync-dibbs        enabled=false since 2026-11-02 (Apify cost)
--                     → data_source_instances.dibbs_dla_flat_files still source_state=current
--                       with NULL last_verified_ingest / last_data_advance
--                       held_population 57,816 vs live ~103k
--   Same null-clock "current" on sam_opportunities_sam_gov, grants_gov_api,
--   forecast_dhs_apfs, forecast_doe_osbp.
--
-- Job success ≠ data advancement. Stored source_state=current without an
-- advancement clock manufactures health.
--
-- ── WHAT THIS DOES ─────────────────────────────────────────────────────────
-- 1. Tell the truth on DIBBS: content_stale + blocked; held_population = live count.
-- 2. Demote automated instances that claim current with null advancement clocks
--    to unmeasured (reader also refuses CURRENT without a clock).
-- 3. Document SBIR policy on the cron_jobs row WITHOUT disabling it.
--
-- ── WHAT THIS DOES NOT ─────────────────────────────────────────────────────
-- No DELETE / DROP / TRUNCATE. No specialty ingest reopen. No SAM fleet delete.
-- No forecast apply. No parking of sync-dod-sbir.
-- Does not touch institute_gao / Grokbot fresh-intel writers — only the four
-- false-green keys below plus dibbs_dla_flat_files.

-- ── 1. DIBBS: disabled sync cannot read current ────────────────────────────
-- Historical rows preserved. held_population corrected to the live count.
-- last_data_advance left null — we do not invent a verified-ingest stamp from a
-- disabled producer; max(dibbs_rfqs.synced_at) remains the data clock.
UPDATE public.data_source_instances
SET source_state       = 'content_stale',
    intervention_state = 'blocked',
    manual_action_type = 'cost_pause',
    held_population    = (SELECT count(*)::integer FROM public.dibbs_rfqs),
    updated_at         = NOW()
WHERE source_key = 'dibbs_dla_flat_files';

-- ── 2. Automated "current" with null advancement clocks → unmeasured ───────
-- DIBBS already set above (content_stale). Remaining false greens demoted so
-- the control plane cannot claim current without a data clock. Inventory falls
-- back to the table timestamp when instance state is UNKNOWN.
UPDATE public.data_source_instances
SET source_state = 'unmeasured',
    updated_at   = NOW()
WHERE ingest_mode = 'automated'
  AND source_state = 'current'
  AND last_verified_ingest IS NULL
  AND last_data_advance IS NULL
  AND source_key IN (
    'sam_opportunities_sam_gov',
    'grants_gov_api',
    'forecast_dhs_apfs',
    'forecast_doe_osbp'
  );

-- ── 3. SBIR stays ENABLED — retries + honest failure, not a park ───────────
-- Code path: sync-dod-sbir retries a down probe, then returns HTTP 503 when
-- still unreachable / empty. Next dispatcher tick recovers automatically.
UPDATE public.cron_jobs
SET notes = coalesce(nullif(trim(notes), ''), 'sync-dod-sbir')
  || ' | 2026-11-18: keep ENABLED. Temporary sbir.gov unavailability must report'
  || ' failure (HTTP 503), retry within the run, and recover on a later tick —'
  || ' never park this job for an empty corpus.'
WHERE job_name = 'sync-dod-sbir'
  AND notes IS DISTINCT FROM (
    coalesce(nullif(trim(notes), ''), 'sync-dod-sbir')
    || ' | 2026-11-18: keep ENABLED. Temporary sbir.gov unavailability must report'
    || ' failure (HTTP 503), retry within the run, and recover on a later tick —'
    || ' never park this job for an empty corpus.'
  );
