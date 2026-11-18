-- Honesty park: false-green freshness (Agent 3 / Eric decisions 2026-11-18).
--
-- ── THE DEFECT ─────────────────────────────────────────────────────────────
-- Measured live 2026-11-18 against production:
--
--   sync-dod-sbir     enabled, last_status=success every 6h, HTTP 200
--                     → dod_sbir_topics = 0 rows (api-down path claimed success)
--   sync-dibbs        enabled=false since 2026-11-02 (Apify cost)
--                     → data_source_instances.dibbs_dla_flat_files still source_state=current
--                       with NULL last_verified_ingest / last_data_advance
--                       held_population 57,816 vs live 103,076
--   Same null-clock "current" on sam_opportunities_sam_gov, grants_gov_api,
--   forecast_dhs_apfs, forecast_doe_osbp.
--
-- Job success ≠ data advancement. Stored source_state=current without an
-- advancement clock manufactures health.
--
-- ── WHAT THIS DOES ─────────────────────────────────────────────────────────
-- 1. Park sync-dod-sbir (same pattern as 20260921_park_false_green_producers).
-- 2. Tell the truth on DIBBS: content_stale + blocked; held_population = live count.
-- 3. Demote automated instances that claim current with null advancement clocks
--    to unmeasured (reader also refuses CURRENT without a clock).
--
-- ── WHAT THIS DOES NOT ─────────────────────────────────────────────────────
-- No DELETE / DROP / TRUNCATE. No specialty ingest reopen. No SAM fleet delete.
-- No forecast apply. Re-enable sync-dod-sbir only with proven DATA advancement.

-- ── 1. Stop the DoD SBIR false-green producer ──────────────────────────────
UPDATE public.cron_jobs
SET enabled = FALSE,
    notes = coalesce(notes, '') ||
      ' | PARKED 2026-11-18: reported success/HTTP 200 while dod_sbir_topics held 0 rows'
      || ' (api-down path treated unreachable as success). Disabled so the job can no longer'
      || ' manufacture evidence of health. Re-enable only when sbir.gov drain is proven by'
      || ' held row advancement.'
WHERE job_name = 'sync-dod-sbir'
  AND enabled IS TRUE;

-- ── 2. DIBBS: disabled sync cannot read current ────────────────────────────
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

-- ── 3. Automated "current" with null advancement clocks → unmeasured ───────
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
