# Card chat charge-once: release and acceptance evidence (2026-11-15)

Owner: Agent 2. Approved by Eric on 2026-11-14/15: merge #2049 and #2051, apply each migration with `--only` after a dry run, and run the six synthetic free-account cases plus the Pro case. Card chat stays OFF.

## Releases

| Item | Result |
|---|---|
| PR #2051 | Squash-merged as `26e335dc`, pinned to the verified head `e92c5ff2` |
| PR #2049 | Squash-merged as `7f3a14ac`, pinned to the verified head `b4225f1e` |
| Production | Serves `7f3a14ac` (`maps-account-build` stamp). `/api/admin/activation` returns 401 without a password, and `/admin/activation` returns 200 |
| Card chat flag | `MAP_CARD_CHAT_ENABLED` is not set in production. A free synthetic account asking about a card on production gets `403 {"error":"pro_required"}` (the flag-off behaviour) |

## Migrations: each applied alone with `--only`, after a dry run that listed exactly one file

| File | Applied (UTC) | Verification |
|---|---|---|
| `20261114_signup_events_account_verified.sql` | 2026-11-15 00:57:32 | Index `signup_events_account_verified_once` exists, with `indisvalid` and `indisunique` both true. Its definition is `UNIQUE (user_email) WHERE event_type = 'account_verified'`. `signup_events` still has 2,990 rows, 0 of them `account_verified` |
| `20261114_card_chat_turns.sql` | 2026-11-15 00:59:10 | The table exists with RLS on and 0 policies, plus 5 constraints. The 3 functions are SECURITY INVOKER, and EXECUTE is granted only to postgres and service_role. **PostgREST:** the service role can read the table and call the RPC. **Anon:** the RPC returns `42501 permission denied`, and a table read returns `[]` |

The other 4 pending migrations (`20260924_saved_search_forecast_watermark`, `20261108_contractor_job_postings`, `20261108_contractor_jobs_cron`, `20261113_trial_onboarding_cron`) were **not** run. Verified: no `contractor_job_postings` table and no `trial-onboarding` cron row.

**Rollback for card_chat_turns** (run only with the flag off): drop the 3 functions (`card_chat_claim_turn`, `card_chat_complete_turn`, `card_chat_fail_turn`), drop `card_chat_turns`, then delete its `schema_migrations` row. **Rollback for the index:** `DROP INDEX signup_events_account_verified_once`.

## Synthetic charge-once run (C2, C3 partial, C4)

**Harness:** the real `/api/app/chat` route, built from `main` @ `7f3a14ac` and run on a local server against the **production database**. `MAP_CARD_CHAT_ENABLED=true` was set only in that local process. Production flags were unchanged.

**Accounts:**
- `agent2-cardchat-free-20261115@example.com`: free, given the standard 100 credits through `mcp_grant_credits`.
- `agent2-cardchat-pro-20261115@example.com`: Pro through a temporary KV `briefings:` key, which was deleted after the run.

Both are synthetic. Exclude them from activation metrics.

| Case | Result | Credits |
|---|---|---|
| 1 Disconnect before completion | Turn `failed` with reason `client_disconnected` | 0 (balance 100 → 100) |
| 1b Same question asked again after that failure | Turn re-claimed (`attempts=2`), answered and saved | 10 (→ 90) |
| 2 Disconnect after the answer streamed (client aborted on `citations`, before `credits`/`done`) | Turn `completed` and saved | 10 (→ 80), once |
| 3 Refresh/reopen (`replay_only`) | Saved answer replayed, with a `replayed` event | 0 |
| 4 Retry (full request, same turn id) | Saved answer replayed | 0 |
| 4b Same turn id, different question | `409 turn_mismatch`; never replayed | 0 |
| 5 Concurrent duplicate (2 requests 400 ms apart) | First streams the answer. Second gets `409 turn_in_progress`, and its later replay returns the saved answer | 10 (→ 70), once |
| 6 Genuine follow-up (new turn id, new question) | Answered and saved | 10 (→ 60) |
| Pro | Answered. Turn saved with `charge_outcome=not_billable`; replay works. No balance row and no ledger row | 0 |

**Reconciliation for the free account:** `card_chat_turns` has 4 charged turns totalling 40. `mcp_credit_ledger` has 4 rows with reason `card_chat_turn` totalling 40. Balance is 60 (100 − 40). Exact.

**Not proven live:** empty, degraded and length-cut answers, which can't be forced on demand. The unit tests cover them (`card-chat.route.unit.test.ts`, `card-chat-turns.sql.unit.test.ts` on PGlite). C3 stays partial.

**Known gap for reconciliation:** a ledger row doesn't carry its turn id. Ledger and turns reconcile by account and sum, not row-to-row.

**LLM spend for the run:** $0.1119 (free account, 10 calls) + $0.0248 (Pro account, 2 calls) = **$0.1367**, all gpt-4o (`llm_usage_log`).
