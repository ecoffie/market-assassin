-- Card chat: charge once per question (approved by Eric 2026-11-14).
--
-- Billing rule: one successfully completed AND durably saved answer = one charge. A retry, a browser
-- disconnect, a page refresh or reopening the conversation must never create a second charge for the
-- same question.
--
-- How:
--   * The browser gives every submitted question a stable turn id (uuid) and reuses it on retry/reopen.
--   * card_chat_claim_turn() is the single gate: the first request for a turn claims it (a lease); a
--     concurrent duplicate sees 'in_progress'; a request for a completed turn gets the SAVED answer back
--     (no model call, no debit); a failed or abandoned turn can be claimed again.
--   * card_chat_complete_turn() saves the answer + sources AND debits through the existing atomic ledger
--     function mcp_debit_credits() in ONE transaction. An answer is therefore never charged without being
--     recoverable by its owner, and a turn is debited at most once (the row is locked and must still be
--     'in_progress' under the caller's claim token).
--   * card_chat_fail_turn() marks a failed / empty / degraded / incomplete answer free and re-claimable.
--
-- ADDITIVE ONLY: one new table, three new functions. No existing table or function is changed.
-- Access: RLS enabled with no policies (service role only), like the mcp_* credit tables.
-- Rollback: nothing else reads this table; DROP FUNCTION x3 + DROP TABLE card_chat_turns is safe once
-- the route no longer calls them (card chat itself is gated by MAP_CARD_CHAT_ENABLED).

CREATE TABLE IF NOT EXISTS public.card_chat_turns (
  turn_id          uuid PRIMARY KEY,
  user_email       text NOT NULL,
  notice_id        text NOT NULL,
  session_id       uuid,
  question         text NOT NULL,
  question_hash    text NOT NULL,
  status           text NOT NULL,
  claim_token      uuid,
  lease_expires_at timestamptz,
  attempts         integer NOT NULL DEFAULT 1,
  answer           text,
  cited_sources    jsonb NOT NULL DEFAULT '[]'::jsonb,
  credits_charged  integer NOT NULL DEFAULT 0,
  charge_outcome   text,
  balance_after    integer,
  failure_reason   text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  completed_at     timestamptz,
  CONSTRAINT card_chat_turns_status_chk CHECK (status IN ('in_progress', 'completed', 'failed')),
  -- A completed turn always holds a non-empty answer: "completed" can never mean "charged but lost".
  CONSTRAINT card_chat_turns_completed_has_answer CHECK (
    status <> 'completed' OR (answer IS NOT NULL AND length(btrim(answer)) > 0 AND completed_at IS NOT NULL)
  ),
  CONSTRAINT card_chat_turns_credits_nonneg CHECK (credits_charged >= 0),
  CONSTRAINT card_chat_turns_charge_outcome_chk CHECK (
    charge_outcome IS NULL OR charge_outcome IN ('charged', 'not_billable', 'insufficient_balance')
  )
);

CREATE INDEX IF NOT EXISTS idx_card_chat_turns_user ON public.card_chat_turns (user_email, created_at DESC);

ALTER TABLE public.card_chat_turns ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.card_chat_turns IS
  'One row per Opportunity Map card-chat question (turn id from the browser). The durable copy of the answer that a retry/reopen replays for free, and the once-only charge record.';

-- ---- claim -------------------------------------------------------------------------------------
-- outcome:
--   'claimed'       this caller owns the turn now (new, or a failed / lease-expired turn re-claimed)
--   'completed'     already answered: answer/sources/session returned for a free replay
--   'in_progress'   another live request owns it (concurrent duplicate)
--   'mismatch'      the turn id exists for another user, opportunity or question (never replayed)
--   'not_completed' p_replay_only and the turn is absent or failed (nothing claimed, no model call)
CREATE OR REPLACE FUNCTION public.card_chat_claim_turn(
  p_turn uuid, p_user text, p_notice text, p_session uuid, p_question text,
  p_lease_seconds integer, p_replay_only boolean DEFAULT false
) RETURNS TABLE(outcome text, claim_token uuid, answer text, cited_sources jsonb, session_id uuid, credits_charged integer)
LANGUAGE plpgsql AS $$
DECLARE
  r public.card_chat_turns%ROWTYPE;
  v_hash  text := md5(btrim(coalesce(p_question, '')));
  v_token uuid;
BEGIN
  IF NOT p_replay_only THEN
    v_token := gen_random_uuid();
    INSERT INTO public.card_chat_turns AS t (turn_id, user_email, notice_id, session_id, question, question_hash,
                                             status, claim_token, lease_expires_at)
    VALUES (p_turn, lower(p_user), p_notice, p_session, btrim(p_question), v_hash,
            'in_progress', v_token, now() + make_interval(secs => p_lease_seconds))
    ON CONFLICT (turn_id) DO NOTHING;
    IF FOUND THEN
      RETURN QUERY SELECT 'claimed'::text, v_token, NULL::text, '[]'::jsonb, p_session, 0;
      RETURN;
    END IF;
  END IF;

  SELECT * INTO r FROM public.card_chat_turns t WHERE t.turn_id = p_turn FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'not_completed'::text, NULL::uuid, NULL::text, '[]'::jsonb, NULL::uuid, 0;
    RETURN;
  END IF;

  IF r.user_email <> lower(p_user) OR r.notice_id <> p_notice OR r.question_hash <> v_hash THEN
    RETURN QUERY SELECT 'mismatch'::text, NULL::uuid, NULL::text, '[]'::jsonb, NULL::uuid, 0;
    RETURN;
  END IF;

  IF r.status = 'completed' THEN
    RETURN QUERY SELECT 'completed'::text, NULL::uuid, r.answer, r.cited_sources, r.session_id, r.credits_charged;
    RETURN;
  END IF;

  IF r.status = 'in_progress' AND r.lease_expires_at > now() THEN
    RETURN QUERY SELECT 'in_progress'::text, NULL::uuid, NULL::text, '[]'::jsonb, r.session_id, 0;
    RETURN;
  END IF;

  IF p_replay_only THEN
    -- Failed, or a stale lease whose request died: nothing saved to replay. Never claim on a replay probe.
    RETURN QUERY SELECT (CASE WHEN r.status = 'in_progress' THEN 'in_progress' ELSE 'not_completed' END)::text,
                        NULL::uuid, NULL::text, '[]'::jsonb, r.session_id, 0;
    RETURN;
  END IF;

  v_token := gen_random_uuid();
  UPDATE public.card_chat_turns t
     SET status = 'in_progress', claim_token = v_token,
         lease_expires_at = now() + make_interval(secs => p_lease_seconds),
         attempts = t.attempts + 1, failure_reason = NULL,
         session_id = coalesce(t.session_id, p_session), updated_at = now()
   WHERE t.turn_id = p_turn;
  RETURN QUERY SELECT 'claimed'::text, v_token, NULL::text, '[]'::jsonb, coalesce(r.session_id, p_session), 0;
END $$;

-- ---- complete (save + charge, one transaction) -------------------------------------------------
-- outcome:
--   'charged'              saved and debited p_credits
--   'not_billable'         saved; p_credits = 0 (Pro)
--   'insufficient_balance' saved; the ledger refused the debit (balance fell below the price during the
--                          turn). Nothing charged, never negative — same rule the route had before.
--   'already_completed'    the turn was completed earlier (idempotent; nothing changed, nothing charged)
--   'lost_claim'           this caller no longer owns the turn (a newer claim replaced it): nothing saved
--                          or charged by this call
--   'not_found'            no such turn for this user
CREATE OR REPLACE FUNCTION public.card_chat_complete_turn(
  p_turn uuid, p_token uuid, p_user text, p_answer text, p_sources jsonb, p_session uuid, p_credits integer
) RETURNS TABLE(outcome text, credits_charged integer, new_balance integer)
LANGUAGE plpgsql AS $$
DECLARE
  r public.card_chat_turns%ROWTYPE;
  v_ok boolean := true;
  v_balance integer := NULL;
  v_charged integer := 0;
  v_outcome text;
BEGIN
  IF p_answer IS NULL OR length(btrim(p_answer)) = 0 THEN
    RAISE EXCEPTION 'card_chat_complete_turn: empty answer cannot complete a turn';
  END IF;

  SELECT * INTO r FROM public.card_chat_turns t WHERE t.turn_id = p_turn AND t.user_email = lower(p_user) FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'not_found'::text, 0, NULL::integer; RETURN;
  END IF;
  IF r.status = 'completed' THEN
    RETURN QUERY SELECT 'already_completed'::text, r.credits_charged, r.balance_after; RETURN;
  END IF;
  IF r.status <> 'in_progress' OR r.claim_token IS DISTINCT FROM p_token THEN
    RETURN QUERY SELECT 'lost_claim'::text, 0, NULL::integer; RETURN;
  END IF;

  IF coalesce(p_credits, 0) > 0 THEN
    SELECT d.ok, d.new_balance INTO v_ok, v_balance
      FROM public.mcp_debit_credits(lower(p_user), p_credits, 'card_chat_turn', 'ask_mindy_card', NULL) d;
    v_charged := CASE WHEN v_ok THEN p_credits ELSE 0 END;
    v_outcome := CASE WHEN v_ok THEN 'charged' ELSE 'insufficient_balance' END;
  ELSE
    v_outcome := 'not_billable';
  END IF;

  UPDATE public.card_chat_turns t
     SET status = 'completed', answer = p_answer, cited_sources = coalesce(p_sources, '[]'::jsonb),
         session_id = coalesce(p_session, t.session_id),
         credits_charged = v_charged, charge_outcome = v_outcome, balance_after = v_balance,
         claim_token = NULL, lease_expires_at = NULL, completed_at = now(), updated_at = now()
   WHERE t.turn_id = p_turn;

  RETURN QUERY SELECT v_outcome, v_charged, v_balance;
END $$;

-- ---- fail (free, re-claimable) -----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.card_chat_fail_turn(p_turn uuid, p_token uuid, p_reason text)
RETURNS boolean
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public.card_chat_turns t
     SET status = 'failed', failure_reason = left(coalesce(p_reason, 'failed'), 200),
         claim_token = NULL, lease_expires_at = NULL, updated_at = now()
   WHERE t.turn_id = p_turn AND t.status = 'in_progress' AND t.claim_token = p_token;
  RETURN FOUND;
END $$;

REVOKE ALL ON FUNCTION public.card_chat_claim_turn(uuid, text, text, uuid, text, integer, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.card_chat_complete_turn(uuid, uuid, text, text, jsonb, uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.card_chat_fail_turn(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
