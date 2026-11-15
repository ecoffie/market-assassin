-- MCP credit objects: least privilege (prepared 2026-11-15, NOT APPLIED — awaiting Eric's review).
--
-- Every legitimate caller uses the service role (getWriteClient / getReadClient / createClient with
-- SUPABASE_SERVICE_ROLE_KEY). pg_stat_statements since 2026-08-01 shows no anon/authenticated query on
-- any mcp_ object other than security probes. This removes the PUBLIC/anon/authenticated grants that
-- Supabase's default privileges attached, and leaves service_role and postgres exactly as they are.
--
-- Not changed here (separate decision): ALTER DEFAULT PRIVILEGES in schema public still grants new
-- tables/functions to anon/authenticated, so every future mcp_* migration must revoke explicitly
-- (as 20261114_card_chat_turns.sql does).
--
-- Idempotent: REVOKE of an absent grant is a no-op, so a re-run is safe. A MISSING object aborts the whole
-- migration (RAISE EXCEPTION, Agent 5 review 2026-11-15) so the runner can never record ok with a hole open.
-- Also covers card_chat_turns (Agent 5 review: its table still granted ALL incl. TRUNCATE to anon/authenticated).

DO $$
DECLARE
  fn text;
  fns text[] := ARRAY[
    'public.mcp_apply_credit(text, text, integer, text)',
    'public.mcp_autorecharge_claim(text, integer, integer)',
    'public.mcp_credit_pool_guard()',
    'public.mcp_debit_credits(text, integer, text, text, uuid, text)',
    'public.mcp_debit_pool(uuid, text, integer, text, text, uuid)',
    'public.mcp_grant_credits(text, integer, text)',
    'public.mcp_grant_pool_once(text, uuid, integer, text, text)',
    'public.mcp_grant_resets_chatgpt_window(text)',
    'public.mcp_grant_signup_credits(text, integer)',
    'public.mcp_paywall_mirror_offer_open()',
    'public.mcp_recharge_gate(integer, integer, integer)',
    'public.mcp_replenish_pool(text, uuid, integer, text)',
    'public.mcp_topup_to_ceiling(text, text, integer, text)',
    'public.mcp_transfer_personal_to_pool(text, text, uuid, integer, jsonb)'
  ];
  tbl text;
  tbls text[] := ARRAY[
    'mcp_api_keys', 'mcp_autorecharge', 'mcp_call_log', 'mcp_credit_balance', 'mcp_credit_ledger',
    'mcp_credit_pool', 'mcp_credit_topups', 'mcp_external_cache', 'mcp_oauth_clients', 'mcp_oauth_codes',
    'mcp_oauth_tokens', 'mcp_paywall_attempts', 'mcp_pool_credit_grants', 'mcp_pool_grants',
    'mcp_prepaid_entitlements', 'mcp_referral_codes', 'mcp_referrals',
    -- card chat's charge-once record (20261114_card_chat_turns.sql revoked its functions, not the table)
    'card_chat_turns'
  ];
BEGIN
  FOREACH fn IN ARRAY fns LOOP
    IF to_regprocedure(fn) IS NOT NULL THEN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn);
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
    ELSE
      -- Fail the whole migration: a silent skip would let the runner report ok with a grant still open.
      RAISE EXCEPTION 'least-privilege: function % not found (signature drift) - aborting', fn;
    END IF;
  END LOOP;

  FOREACH tbl IN ARRAY tbls LOOP
    IF to_regclass('public.' || tbl) IS NOT NULL THEN
      -- ALL includes TRUNCATE, REFERENCES and TRIGGER, none of which RLS controls.
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon, authenticated', tbl);
      EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role', tbl);
    ELSE
      RAISE EXCEPTION 'least-privilege: table % not found - aborting', tbl;
    END IF;
  END LOOP;

  IF to_regclass('public.mcp_referrals_id_seq') IS NULL THEN
    RAISE EXCEPTION 'least-privilege: sequence mcp_referrals_id_seq not found - aborting';
  END IF;
  REVOKE ALL ON SEQUENCE public.mcp_referrals_id_seq FROM anon, authenticated;
  GRANT USAGE, SELECT, UPDATE ON SEQUENCE public.mcp_referrals_id_seq TO service_role;
END $$;
