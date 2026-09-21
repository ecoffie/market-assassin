-- Anonymous opportunity shortlist — its OWN table, deliberately not user_pipeline.
--
-- ── WHY NOT REUSE user_pipeline ────────────────────────────────────────────
-- The first draft of this feature stored anonymous saves in `user_pipeline`,
-- reasoning that signed-in VIEWS filter by account email. An audit of all 63
-- consumers showed that is not sufficient — six read the table GLOBALLY, with no
-- user_email filter:
--
--   src/app/api/cron/pursuit-changes/route.ts   ← and it SENDS EMAIL
--   src/lib/analytics/observatory.ts
--   src/lib/admin/demand-heatmap.ts
--   src/app/api/admin/dashboard/route.ts
--   src/app/api/admin/map-funnel/route.ts
--   src/app/api/admin/qualify-customers/route.ts
--
-- `cron/pursuit-changes` selects every non-archived row carrying a notice_id and
-- emails `owner_email || user_email`. An `anon:<uuid>` row would enter that scan
-- and Mindy would try to email a UUID. The others would count anonymous browsing
-- as real pursuit activity in customer metrics.
--
-- An anonymous shortlist is NOT a pursuit. It gets its own table so no consumer
-- can mistake one for the other, and `user_pipeline` keeps meaning exactly what
-- it meant before this feature existed.
--
-- ── SHAPE ──────────────────────────────────────────────────────────────────
-- Minimal on purpose: the owner, the notice, and when. NO title/agency/NAICS/
-- deadline columns, because the browser must not be able to manufacture
-- opportunity metadata that later becomes a real pursuit — everything else is
-- resolved from `sam_opportunities` at read and at claim time.

CREATE TABLE IF NOT EXISTS public.anonymous_shortlist (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- `anon:<uuid>` only. Enforced so an email can never own a row here: a real
  -- account's saves belong in user_pipeline, through the authenticated path.
  owner_anon_id   TEXT NOT NULL CHECK (owner_anon_id ~ '^anon:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),

  -- The ONLY opportunity fact the client supplies, and it must already exist.
  notice_id       TEXT NOT NULL REFERENCES public.sam_opportunities(notice_id) ON DELETE CASCADE,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Set when the row has been promoted into a real account's pursuits. Kept
  -- rather than deleted so a promotion is auditable and re-runnable safely.
  claimed_at      TIMESTAMPTZ,
  claimed_by      TEXT,

  -- Saving the same notice twice is the user repeating themselves, not a new row.
  UNIQUE (owner_anon_id, notice_id)
);

CREATE INDEX IF NOT EXISTS idx_anon_shortlist_owner
  ON public.anonymous_shortlist (owner_anon_id, created_at DESC);

COMMENT ON TABLE public.anonymous_shortlist IS
  'Opportunities kept by signed-out Map visitors. NOT pursuits: user_pipeline has six global consumers (one of which emails the owner), so anonymous rows must never live there. Holds only owner + notice_id; all opportunity metadata is resolved from sam_opportunities.';

-- Service-role only, like every other operational table here. The API is the
-- single entry point and applies the anon-id scoping.
ALTER TABLE public.anonymous_shortlist ENABLE ROW LEVEL SECURITY;
