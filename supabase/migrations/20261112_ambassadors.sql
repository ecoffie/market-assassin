-- Mindy Ambassadors program (2026-11-12). One row per applicant. An APPROVED ambassador gets free
-- Pro and uses Mindy without paying credits (src/lib/mcp/metered.ts → isApprovedAmbassador), gives
-- product feedback, and shares their referral link (src/lib/mcp/referrals.ts). Commission terms are
-- decided later; referrals are already tracked by the referral system. Idempotent.
CREATE TABLE IF NOT EXISTS ambassadors (
  email          text PRIMARY KEY,
  name           text NOT NULL,
  company        text,
  role           text,
  linkedin_url   text,
  website_url    text,
  audience       text NOT NULL,
  why            text NOT NULL,
  promote_plan   text,
  status         text NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'approved', 'rejected', 'removed')),
  referral_code  text,
  decided_at     timestamptz,
  decided_by     text,
  decision_note  text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ambassadors_status_created_idx ON ambassadors (status, created_at DESC);

-- Service role only (the API routes); no client access.
ALTER TABLE ambassadors ENABLE ROW LEVEL SECURITY;
