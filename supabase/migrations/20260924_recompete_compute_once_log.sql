-- Recompete compute-once rollout log (Gate 2 · shadow → canary → authority, 2026-09-24).
-- Record: tasks/recompete-compute-once-design-2026-09-24.md
--
-- One row per /api/app/recompete-map request while RECOMPETE_COMPUTE_ONCE_MODE != 'off':
-- which path SERVED it, both paths' latency when both ran, and the field-by-field comparison outcome.
-- It is the evidence the rollout is judged on (sample coverage, mismatches, P50/P95, errors, fallbacks),
-- so it records outcomes, never payloads. Additive + idempotent; service-role only (RLS on, no policies).
CREATE TABLE IF NOT EXISTS public.recompete_compute_once_log (
  id               bigserial PRIMARY KEY,
  at               timestamptz NOT NULL DEFAULT now(),
  deployment       text,                 -- VERCEL_GIT_COMMIT_SHA
  mode             text NOT NULL,        -- shadow | canary | authority
  served           text NOT NULL,        -- old | new | fallback (new failed → old served)
  forced           boolean NOT NULL DEFAULT false,
  compared         boolean NOT NULL DEFAULT false,
  outcome          text,                 -- identical | churn | mismatch | new_error | old_error | null (not compared)
  mismatch_fields  text[],
  params           jsonb NOT NULL,       -- the recompete-map query params (no user identity is sent to this route)
  bbox             jsonb NOT NULL,
  plan_status      text,
  plan_via         text,
  old_ms           integer,
  new_ms           integer,
  market_total     integer,
  in_view          integer,
  pins             integer,
  follow_ons       integer,
  error            text
);
CREATE INDEX IF NOT EXISTS recompete_compute_once_log_at_idx ON public.recompete_compute_once_log (at DESC);
CREATE INDEX IF NOT EXISTS recompete_compute_once_log_outcome_idx ON public.recompete_compute_once_log (outcome, at DESC);
ALTER TABLE public.recompete_compute_once_log ENABLE ROW LEVEL SECURITY;
