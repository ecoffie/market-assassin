# Provider cost controls: design (2026-11-02)

**Status:** DESIGN for review. Nothing here is built, and no dollar caps are set.
**Why:** DIBBS proved that a routing rule is not a budget. The Apify actor billed ≈$1,538 in four
cycles behind a "cost guard" (`docs/engineering/dibbs-cost-closeout-2026-11-02.md`). A 2026-11-02
audit found the same shape elsewhere:
- paid-provider fallbacks that escalate on any error, including invalid credentials;
- a per-user budget that only downgrades, undercounts and fails open;
- most provider spend not recorded at all. `llm_usage_log` shows ~$25 / 90 days, which cannot be
  the real total.

**Precedent:** this is the mature-SaaS shape. AWS Budgets and Service Quotas, OpenAI and Anthropic
workspace spend limits, and Vercel Spend Management all separate **attribution** (a ledger),
**pre-authorization** (a reservation against a limit) and **reconciliation** (against the invoice).
The same pattern already exists in this codebase: `mcp_debit_credits`, an atomic
`UPDATE … WHERE balance >= amount RETURNING`.

---

## 1. Principles (the requirements, as rules)

1. **Every paid call goes through one gate.** No direct `fetch` to a paid API outside the gate.
   A CI audit enforces this (in the style of the existing pre-push gates).
2. **Reserve before you spend.** The budget is checked and decremented atomically *before* the
   provider call, by the worst-case estimate.
3. **A hard limit is hard.** At 100% new reservations are refused. In-flight work holds an existing
   reservation, so the total can never pass the limit; there is no silent 150%.
4. **Unknown is not zero.** A call whose outcome is unknown (timeout, abort, a crash after the
   request was sent) keeps its full reservation as spent until reconciliation settles it.
5. **No escalation on caller error.** Invalid credentials (401/403) or an invalid request
   (400/404/413/422) never fall through to another paid provider. That failure is ours; a pricier
   model would fail too, and bill for it.
6. **Background and discretionary fail closed.** A blocked or exhausted budget stops and reports.
   Customer-critical work refuses new expensive operations with a clear message; it never errors
   mid-task and never silently degrades.
7. **No caps invented.** A budget without a measured limit runs in **shadow** mode: it records and
   reports "would have blocked" and blocks nothing. A limit is set only from measured spend.

## 2. Data model (Supabase, via the migration runner)

```text
provider_price_book      provider, sku (model / endpoint), unit ('input_token','output_token',
                         'request','item','gb','minute'), usd_per_unit, effective_from, source_url
                         -- versioned; estimates and reconciliation cite the row they used

provider_budgets         id, scope_kind ('provider'|'category'|'feature'|'customer'),
                         scope_key, period ('month'), limit_usd NULL (NULL = shadow),
                         alert_pcts int[] default {80,100}, mode ('shadow'|'enforce'),
                         owner, note

provider_budget_usage    budget_id, period_start, reserved_usd, committed_usd, unknown_usd,
                         alerted_pcts int[]          -- one row per budget per period

provider_spend_ledger    id, reservation_id, provider, sku, feature, route_or_job, category
                         ('customer_critical'|'operational'|'discretionary'), user_email NULL,
                         est_usd, actual_usd NULL, units jsonb, status
                         ('reserved'|'committed'|'released'|'unknown'|'refused'),
                         refusal_reason NULL, provider_request_id NULL, attempt int,
                         created_at, settled_at, reconciled_at
```

All tables are service-role only (RLS), matching the MCP credit tables.

## 3. The gate: `withProviderSpend(spec, call)`

```text
spec = { provider, sku, feature, routeOrJob, category, userEmail?, estimate:{units}, budgets:[scopes] }

1. est = priceBook(spec.sku) × worst-case units          (max_tokens, items, minutes, bytes)
2. reserve_provider_spend(budgets, est) → ok | refused(scope, pct)
     Postgres RPC, one statement per budget scope:
       UPDATE provider_budget_usage
          SET reserved_usd = reserved_usd + est
        WHERE … AND (limit IS NULL OR committed + reserved + unknown + est <= limit)
       RETURNING …
     Every scope succeeds or none does (one transaction).
     Shadow budgets always succeed but record would_block=true.
3. refused → ledger 'refused' and return the category's exhaustion behavior (§5). NO provider call.
4. call provider
     ok         → actual = usage from the response × price → commit; release (est − actual)
     error before send / definitive 4xx → release; ledger 'released'
     timeout / abort / no response after send → ledger 'unknown'; amount stays in unknown_usd
5. after commit, cross an alert threshold → alert (§6), once per threshold per period
```

**Concurrency:** the conditional `UPDATE … RETURNING` is the lock. N parallel reservations cannot
oversubscribe a budget, the same guarantee proven live for `mcp_debit_credits` (100 concurrent
debits, balance never < 0).

## 4. Fallback policy (replaces callLLM's "any error → next provider")

| Failure | Next attempt |
|---|---|
| 401/403 (credentials, permission) | **none**: fail and alert ops (it's a config bug) |
| 400/404/413/422 (our request) | **none**: fail |
| 429 / 5xx / network / timeout | next provider **at the same or lower price tier**, with its own reservation |
| empty or unparseable completion | **none** to a pricier tier; at most one same-tier retry |

Customer-critical features may name an explicitly more expensive fallback. It is allowed only if
its own reservation succeeds; operational and discretionary never escalate. Each attempt is its
own ledger row (`attempt` = 1, 2, …), so failures that cost money stay visible.

## 5. Categories and what happens at 100%

| Category | Examples | At 100% of budget |
|---|---|---|
| **customer_critical** | Ask Mindy, proposal drafting/referee/compliance, alert email content | Refuse **new** expensive operations with an inline message ("monthly AI limit reached for this feature, resets on X; contact us to raise it"); reads, search and alerts keep working; in-flight work completes on its reservation |
| **operational** | briefing precompute, embeddings, opportunity precompute, enrichment | Skip the run, keep serving last-good output, report the skip (cron outcome `error` + ops alert). Never escalate the model |
| **discretionary** | content helper tools, SEO enrichment, web intel, Perplexity enrichment | Refuse (429 / skip), no fallback |

**Customer-facing limits for expensive operations** are per plan and per feature (for example
proposal drafts per month), shown in the UI next to the action with an inline upgrade path. This is
the "cap the view, not the action" and "inline contextual upsell" pattern. Chat-initiated MCP tools
draw from the **same allowance** as the direct tool. Today they bypass credits entirely, and that
is closed in the same phase.

## 6. Alerts

- **80%:** ops alert (Slack + email) naming the budget, spend, forecast to period end and top features.
- **100%:** ops alert, plus the enforcement in §5 takes effect (enforce-mode budgets only).
- **Daily digest:** spend by provider, feature and category; unknown-outcome total; refusals; and
  the reconciliation variance.
- **Silence is an alarm:** a provider with zero ledger rows for N days while its jobs ran means the
  gate is being bypassed.

## 7. Reconciliation against real charges

Daily job `reconcile-provider-spend`:

| Provider | Source of truth | Needs |
|---|---|---|
| OpenAI | Organization Usage / Costs API | admin API key (owner) |
| Anthropic | Admin API usage & cost reports | admin API key (owner) |
| GCP / BigQuery | Cloud Billing export or `INFORMATION_SCHEMA.JOBS` | billing export (owner) |
| Groq, Perplexity | dashboard export (no usage API known) | monthly manual import |
| Serper | `GET /account` balance delta (prepaid) | existing key |
| Apify, Twilio | usage APIs (verified 2026-11-02) | existing keys, until cancelled/released |

The job does three things:
1. Compares provider totals per day with ledger `committed + unknown`.
2. Settles `unknown` rows when a provider request id matches.
3. Alerts when variance exceeds a threshold. Variance means unattributed spend: a call outside the
   gate, a price-book error, or provider drift.

## 8. Provider-side caps (defense in depth; owner actions)

Set every cap the vendor offers. In-code budgets protect us from *our* bugs; provider caps protect
us from a bypassed gate. Confirm in each console which limits are **hard** (they block) and which
are **alerts only**, and record the result in `provider_budgets.note`.

| Provider | Cap mechanism (to verify in console) |
|---|---|
| OpenAI | project budget + per-project rate limits |
| Anthropic | workspace spend limit |
| GCP | budget alerts + BigQuery custom quotas (bytes/day) |
| Serper | prepaid credits (inherently hard) |
| Groq / Perplexity | plan limits / prepaid where offered |

## 9. Rollout (each step is its own PR)

1. **Ledger + gate in shadow** for every paid call site. It records and reports, blocks nothing.
   Includes the price book, the error-classified fallback policy, and logging every call that
   doesn't log today (embeddings, transcription, Perplexity, Serper, direct Anthropic and Groq).
2. **Measure 30 days.** Reconcile against invoices. Set `limit_usd` per budget from measured spend
   (owner approval per number).
3. **Enforce discretionary + operational** budgets.
4. **Enforce customer-critical**, with the customer-facing limits and inline messages, after the
   UI copy is reviewed.
5. **CI audit:** a new paid `fetch` outside the gate fails the push.

## Open decisions (owner)

- Admin usage keys for OpenAI and Anthropic (read-only usage scope), needed for automated reconciliation.
- Per-plan allowances for expensive customer operations (step 4).
- Releasing the idle Twilio numbers (~$4/mo, no live code path) and the Apify cancellation.
