-- Email "add to pipeline": the explicit user confirmation, recorded separately from link
-- delivery/open (2026-10-06, the link-scanner defect).
--
-- THE DEFECT: the daily alert's save link was a GET that inserted into user_pipeline. Mail
-- security scanners fetch links on delivery, so they created saves nobody chose (83% of
-- source='daily_alert' saves in 30 days landed within 2 minutes of the send). The link now opens a
-- read-only confirmation page; only its button POST saves, and every such POST is recorded here.
--
-- One row per submitted confirmation form. The PRIMARY KEY on idempotency_key is what makes a
-- repeated submission of the same form a replay instead of a second pipeline row.
--
-- Additive only: a new table. No existing table, row, or column is changed.

CREATE TABLE IF NOT EXISTS public.pipeline_save_confirmations (
  idempotency_key   uuid PRIMARY KEY,
  user_email        text        NOT NULL,
  opportunity_key   text        NOT NULL,          -- 'notice:<id>' or 'title:<title>'
  notice_id         text,
  source            text,                          -- the email the link came from (e.g. daily_alert)
  pipeline_id       uuid,                          -- the row created or already present (no FK: rows may be deleted later)
  outcome           text        NOT NULL DEFAULT 'pending'
                    CHECK (outcome IN ('pending', 'created', 'already_tracking', 'failed')),
  confirmed_by_user boolean     NOT NULL DEFAULT true, -- true only via the explicit button POST
  link_issued_at    timestamptz,                   -- when the email link was signed (delivery side)
  form_rendered_at  timestamptz,                   -- when the confirmation page minted the form
  confirmed_at      timestamptz NOT NULL DEFAULT now(),
  user_agent        text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pipeline_save_confirmations_user
  ON public.pipeline_save_confirmations (user_email, confirmed_at DESC);
CREATE INDEX IF NOT EXISTS idx_pipeline_save_confirmations_pipeline
  ON public.pipeline_save_confirmations (pipeline_id);

ALTER TABLE public.pipeline_save_confirmations ENABLE ROW LEVEL SECURITY;
-- No policies: service role only (the confirm route uses the service client).
REVOKE ALL ON public.pipeline_save_confirmations FROM anon, authenticated;
