# Card chat: activation readiness (prepared 2026-11-15, Agent 2)

**Status: NOT requesting activation.** `MAP_CARD_CHAT_ENABLED` stays OFF until Eric authorizes it separately. The billing policy is approved provisionally: free accounts pay 10 credits per successfully completed new question, Pro pays 0, and replays and failures are free. This document collects the evidence Eric asked for before any activation request, plus the plan and procedures for activation.

## 1. Combined B2 + card-chat integration

**Tree:** `main` @ `8bb887bd`, which contains #2049, merged with Agent 1's B2 PR #2053 @ `8d0677ce`. The merge is clean and adds no dependency changes.

**Results:** `src/app/api/app/chat`, `src/lib/chat` and the card-chat drawer give **25 files / 432 tests passing**, and `tsc` is clean. #2053 adds three B2 × charge-once tests:
- A primary model fails and the supported fallback answers: charged once, and no error is shown.
- Every answer model fails: the customer sees a fixed message, nothing is charged, and the turn stays free to re-ask.
- A thrown stream error gives a fixed message and no charge. A retry then answers and charges once.

**Ordering:** #2053 must merge, and its replacement model must be approved, before activation. Without B2 the route still has a retired fallback and can stream raw provider text (checklist B2).

## 2. Failed, empty, degraded and truncated answers are not charged

**Live harness:** the combined tree, run on a local server against the production database. `MAP_CARD_CHAT_ENABLED=true` and the forcing settings were set only in that local process. The account was the synthetic free account `agent2-cardchat-free-20261115@example.com`.

| Case | How it was forced | Customer saw | Turn | Credits |
|---|---|---|---|---|
| Failed (every answer model fails) | Invalid OpenAI key; answer fallbacks disabled | The fixed message "Mindy couldn't answer right now…" (`answer_unavailable`), with no provider text | `failed` / `turn_error`, about 1 s after the stream closed | 0 (balance 60 → 60, no ledger row) |
| Degraded (planner/tools unavailable) | Invalid planner model; answer through the `gpt-4o-mini` fallback | A 217-character answer with a `tools_unavailable` notice | `failed` / `tools_unavailable` | 0 |
| Disconnected | Client aborted mid-turn (run of 2026-11-15) | n/a | `failed` / `client_disconnected` | 0 |
| Truncated (`finish_reason=length`) | Attempted with a long-output prompt. The model returned a complete 2,584-character answer, so no truncation happened | Complete answer | `completed` | 10 (correct: the answer was complete) |
| Empty | Can't be forced against a live model | n/a | n/a | n/a |

**Truncated and empty are proven by unit tests only.** `card-chat.route.unit.test.ts` covers `isBillableTurn` with `finishReason: 'length'` and with an empty answer. `card-chat-turns.sql.unit.test.ts` runs the real migration on PGlite and confirms `card_chat_complete_turn` refuses an empty answer. A live truncation would need a test-only cap on answer tokens, which is not added.

**Known window:** in the failed case the turn is released by the route's `finally` block about 1 second after the response ends. A retry inside that second gets `409 turn_in_progress` with `Retry-After: 3`, and the drawer waits and retries.

## 3. Saved-answer replay stays free

Proven on the production database: a refresh/reopen (`replay_only`), a full retry with the same turn id, and the duplicate side of a concurrent request each returned the saved answer with a `replayed` event and **0** credits. The same holds on the combined tree: replaying the 2,584-character answer left the balance at 50. A turn id reused with a different question gets `409 turn_mismatch` and is never replayed.

## 4. Synthetic accounts are excluded from activation metrics

`isExcludedAccount()` in `src/lib/activation/load.ts` excludes any `@example.com` address. Checked directly: both `agent2-cardchat-*-20261115@example.com` accounts return `true`, and a real domain returns `false`. Every synthetic account used here is `@example.com`.

## 5. Controlled production-route acceptance plan (needs approval at each gate)

The flag is global today: on means on for every free and Pro account. A controlled production test therefore needs one of these:

- **A. Allowlist (recommended).** A small PR adds `MAP_CARD_CHAT_ALLOWLIST` (comma-separated emails). When it is set, card chat is enabled only for those verified accounts, even with the global flag off. This tests the real production route with synthetic accounts while customers keep today's behaviour.
- **B. Preview deployment.** Set the flag in Vercel's Preview scope only. Preview has its own Supabase settings, so first confirm which database it targets. It also isn't the production route.

**Gates (A assumed):**
1. #2053 merged; B1/C1 graded runs pass (Agent 1).
2. Allowlist PR merged and deployed. Set `MAP_CARD_CHAT_ALLOWLIST` to the two synthetic accounts and redeploy, because env vars only bind on a new build.
3. On **getmindy.ai**:
   - Repeat the six charge-once cases and the Pro case.
   - Repeat the failed case by asking about a card whose record can't be loaded (a `503`/`404` before any claim).
   - Confirm a free account **not** on the allowlist still gets `403 pro_required`.
   - Reconcile the ledger with `card_chat_turns`.
4. Eric reviews the evidence and decides whether to set the global flag.
5. If he approves global activation: set `MAP_CARD_CHAT_ENABLED=true` and redeploy. Watch the monitoring below for 24 hours before any announcement.

## 6. Monitoring (daily during rollout; SQL is read-only)

- **Charge integrity.** For each account, the sum of `card_chat_turns.credits_charged` must equal the sum of `-delta` on `mcp_credit_ledger` rows with `reason='card_chat_turn'`. Any difference is a stop.
- **Stuck turns.** Count of `status='in_progress' AND lease_expires_at < now() - interval '10 minutes'` should be 0 (these are re-claimable, but a rising count means requests are dying).
- **Failure mix.** `failure_reason` counts per day. A spike in `turn_error` or `tools_unavailable` means a provider or tool outage.
- **Errors.** `tool_errors` and the provider-event log for `/api/app/chat`. Customer-visible text must come only from the fixed B2 messages.
- **Cost.** `llm_usage_log` for card turns. The 2026-11-15 runs averaged about $0.011 per answer on gpt-4o.

## 7. Rollback

- **Feature off:** unset `MAP_CARD_CHAT_ENABLED` (and `MAP_CARD_CHAT_ALLOWLIST` if used), then **redeploy**; the env var binds only on a new build. With the flag off, the route ignores card context, so a free account gets `403 pro_required`. Saved turns stay in the table, and no customer is charged.
- **Code:** revert #2049. Only do this with the flag off.
- **Database:** drop `card_chat_claim_turn`, `card_chat_complete_turn` and `card_chat_fail_turn`, drop the `card_chat_turns` table, and delete its `schema_migrations` row. Do this only after the code revert, and only if the saved answers are no longer needed.
- **Charges:** a wrongly charged turn is identified by the reconciliation above and refunded with a `mcp_grant_credits(<email>, <credits>, 'admin_grant')` row, noted against the turn id.
