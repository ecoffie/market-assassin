-- Rules register: allow official statistics (Eric 2026-11-28: CRS In Focus IF12558 IDV share of contract dollars).
--   claim_id  KB-S<n>            (was ^KB-([CX])?[0-9]+$)
--   part      'E'                (official statistics)
--   legal_status 'official_statistic'
-- Idempotent: drops and re-adds the three CHECK constraints by name; skips cleanly if kb_rule_claims does not exist
-- yet (20261127_kb_rule_claims.sql creates it). No data change. Apply with
--   npm run migrate -- --go --only 20261128_kb_rule_claims_official_statistic.sql
DO $$
BEGIN
  IF to_regclass('public.kb_rule_claims') IS NULL THEN
    RAISE NOTICE 'kb_rule_claims does not exist yet; nothing to alter';
    RETURN;
  END IF;

  ALTER TABLE kb_rule_claims DROP CONSTRAINT IF EXISTS kb_rule_claims_claim_id_check;
  ALTER TABLE kb_rule_claims ADD CONSTRAINT kb_rule_claims_claim_id_check CHECK (claim_id ~ '^KB-([CXS])?[0-9]+$');

  ALTER TABLE kb_rule_claims DROP CONSTRAINT IF EXISTS kb_rule_claims_part_check;
  ALTER TABLE kb_rule_claims ADD CONSTRAINT kb_rule_claims_part_check CHECK (part IN ('A', 'B', 'C', 'D', 'E'));

  ALTER TABLE kb_rule_claims DROP CONSTRAINT IF EXISTS kb_rule_claims_legal_status_check;
  ALTER TABLE kb_rule_claims ADD CONSTRAINT kb_rule_claims_legal_status_check CHECK (legal_status IN (
    'final_rule', 'class_deviation', 'proposed_rule', 'statute', 'withdrawn',
    'executive_order', 'omb_memo', 'agency_memo', 'regulation', 'practice', 'operational_fact', 'official_statistic'));
END $$;

NOTIFY pgrst, 'reload schema';
