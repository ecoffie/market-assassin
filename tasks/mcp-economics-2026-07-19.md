# MCP Credit Economics + BigQuery Quota Isolation (2026-07-19)

Triggered by Eric: *"the $15/user LLM cap does NOT apply to MCP — run the economics on
mcp use. Token use for BQ should be considered. How do we ensure the BQ tokens don't get
cut off due to our daily allowance versus user use."*

**Bottom line:** the credit prices clear COGS with room to spare — **margins hold, and annual
front-loading is NOT a margin threat.** The real, unsolved risk is **BigQuery's shared daily
QUOTA** (an availability risk, not a dollar risk) plus the fact that **we don't measure real
COGS on the MCP path**, so today the margin is estimated, not proven.

---

## 1. What a credit costs us to deliver

Credit price by tier: Entry **$0.198/cr** · Mid $0.166 · Agency $0.125. Annual (12× upfront)
is lower per credit: Entry $0.165 · Mid $0.138 · Agency $0.104.

**Cost drivers (none capped by the app's $15/user LLM budget — that guard is app-routes only,
zero hits in `src/mcp`/`src/lib/mcp`):**

- **BigQuery** — $6.25/TB scanned. Per-query byte ceilings already exist: generic `bqQuery`
  = **5 GiB ≈ $0.031**/query (`client.ts:129`), recipients/awards = **20 GiB ≈ $0.122**/query
  (`recipients.ts:23`). Measured `find_capable_contractors` cold call = **6.93 GB ≈ $0.043**
  (`tool-registry.ts:74-80`). 90-day KV cache in front (`cache.ts:47`), and the heavy tool
  tries cache-only FIRST, cold-scanning only on an empty result.
- **LLM** — routing is Groq-8B-first for extraction (cheap), **Claude-first for drafting/referee**
  (`call-llm.ts` JOB_CHAINS). Estimated per call: Groq extraction ~$0.01–0.05; Claude
  `draft_proposal` (multi-section) ~$0.20–0.50; `draft_proposal_section`/`referee` ~$0.05–0.30;
  OpenAI embeddings (keywords/SOW match) fractions of a cent.
- **External APIs** — SAM, USASpending, EDGAR, GSA CALC, Federal Register, Grants.gov are all
  free (rate-limited). ~$0 marginal.

### Per-tool margin (charged at the Entry rate $0.198/cr — the worst case for us)

| Tool | cr | We charge | Est. COGS (worst) | Markup |
|---|---|---|---|---|
| find_capable_contractors | 30 | $5.94 | $0.043 cold / ~$0 cached | ~140× |
| search_contractors | 2 | $0.40 | ≤$0.12 | 3×+ |
| get_contractor_profile | 5 | $0.99 | ≤$0.12 | 8×+ |
| generate_market_report | 100 | $19.80 | ~$0.15 (BQ, no LLM) | ~130× |
| draft_proposal | 100 | $19.80 | ~$0.20–0.50 (Claude) | 40–100× |
| draft_proposal_section | 15 | $2.97 | ~$0.05–0.15 | 20–60× |
| referee_proposal_compliance | 15 | $2.97 | ~$0.10–0.30 | 10–30× |
| extract_compliance_matrix | 8 | $1.58 | ~$0.02–0.05 (Groq) | 30–80× |
| data tools (SAM/USASpending/…) | 1–2 | $0.20–0.40 | ~$0 | huge |

**Every tool clears margin.** The tightest is `search_contractors` at ~3× worst-case (usually
cached → far higher). Nothing is underwater.

### Annual front-loading (Eric's "how many heavy users will eat through it")
Worst case, a front-loaded **Agency annual** = 96,000 credits paid **$9,990**:
- All spent on `draft_proposal` (100 cr) = 960 drafts × ~$0.50 = **~$480 LLM** → **95% margin.**
- All spent on `find_capable_contractors` (30 cr) = 3,200 cold calls × $0.043 = **~$138 BQ** → **98.6% margin.**

**Conclusion: front-loading is a non-issue for margin.** Eric's instinct is correct — the money
is upfront and the markup is large. Do NOT drip credits for margin reasons.

---

## 2. The REAL risk: BigQuery's shared daily QUOTA (availability, not dollars)

The danger isn't per-call dollars — it's the **GCP `QueryUsagePerDay` custom quota**, a hard
per-day scan cap on the **whole project**, enforced by GCP (surfaced as "Custom quota exceeded",
`cache.ts:107-125`).

- **One project, one service account, one quota — shared by app + SEO + MCP** (`live-bq.ts:6-11`,
  `client.ts:60-66`). This already bit us once: public SEO cold scans drained the day's quota and
  the **authenticated Contractors panel returned 0 for everyone**.
- **No per-user or global BQ throttle exists.** The only guards are the two per-query byte
  ceilings and the GCP daily quota. There is **no per-user BQ cap, no BQ rate limit, no cumulative
  BQ meter.** The credit debit is the only throttle, and it counts credits, not BQ.
- **So the front-loaded Agency case that's harmless for margin is dangerous here:** 3,200 cold
  `find_capable` calls × ~7 GB = ~22 TB in a day — that would blow almost any daily quota and
  **500 the app's BQ panels for all users.** This is exactly Eric's "BQ tokens cut off due to our
  daily allowance vs user use."

### Fixing it — ENCOURAGE heavy BQ users, don't cap them (Eric, 2026-07-19)

**Reframe:** the BQ tools (contractor scans, market reports) may be the very thing that *makes*
someone a heavy paying user. So a per-user BQ throttle is the wrong instinct — it discourages our
best customer. The fix is entirely **supply-side**: make heavy BQ use cheap, fast, and isolated so
it's pure upside. The margins (§1) already say we can afford it.

1. **Isolate MCP onto its own BQ project / billing (or a reserved quota bucket).** The whole
   problem is one shared quota; split it so MCP can burst freely and **never** touch the app's
   Contractors panel. Two buckets, not one — this is the real answer to "our daily allowance vs
   user use," and it lets a heavy user run flat out with zero collateral.
2. **Raise (or lift) the custom `QueryUsagePerDay` quota for the MCP bucket.** That daily cap is a
   SELF-IMPOSED cost guard (set after the June-2026 $2,075 cache-wipe storm), not a hard GCP limit —
   on-demand BQ has no inherent daily cap. Per-query `maximumBytesBilled` ceilings (5/20 GiB) already
   stop any single runaway query, and the credit debit throttles abuse. With ~140× margin on
   `find_capable`, 22 TB/day is ~$137 — trivially affordable. Give MCP generous headroom.
3. **Optimize the hot tables so heavy use is CHEAP, not just allowed.** `find_capable` scans 6.93 GB
   because `recipients` isn't partitioned/clustered on NAICS (`tool-registry.ts:74-80`).
   Cluster/partition on NAICS (+ state) → the same query scans MB, not GB. That's a ~100× cost/latency
   cut: heavy use gets faster AND cheaper for us — the opposite of rationing.
4. **Cache harder for the BQ tools.** Longer external-cache TTL → repeat/near-repeat BD queries
   return instantly at $0. A cache HIT is *better* for the heavy user (faster), so this encourages,
   never throttles. `find_capable` already tries cache-first.

---

## 3. We're flying blind on real COGS (P1 — makes "run the economics" continuous)

Today the numbers above are **estimates**. The MCP path does NOT measure actual COGS:
- `metered.ts` logs credits/status/latency — **no USD, no BQ bytes, no COGS field.**
- MCP LLM calls log to `llm_usage_log` with **`userEmail:null`** (`draft-all.ts:126`) → real token
  cost can't be joined back to the credit call.
- `bqQuery` **discards `bytesProcessed`** (`client.ts:121-135`) → BQ cost per call is never captured.

To prove margin (not guess) and watch for a tool that inverts:
- Pass real `userEmail` + a distinct `tool` tag on MCP LLM calls → attributable `llm_usage_log`.
- Capture `bytesProcessed` from the BQ job → a per-call cost log.
- Reconcile credits charged vs real COGS monthly (a `bq-health`-style margin dashboard).

---

## 4. Recommendations / decisions

1. **Keep annual, 12× upfront** — validated. Margins hold at 80–99% even front-loaded. (Done:
   3 annual Stripe prices live, `packages.ts` wired.)
2. **ENCOURAGE heavy BQ users — supply-side, not a per-user cap** (Eric: the BQ tools may be
   *why* a heavy user exists). Do §2 in order of leverage: (a) **optimize the hot tables**
   (cluster `recipients` on NAICS → ~100× cheaper `find_capable`) — biggest win, makes heavy use
   cheap; (b) **isolate MCP's BQ project/quota** so it can't hurt the app; (c) **raise the MCP
   daily quota** (it's a self-imposed guard; margins allow it). Ship before promoting annual so a
   front-loaded burst can't 500 the app.
3. **Instrument COGS (§3)** so the model is proven, not estimated, and a bad tool is caught early.
4. **Optional:** an MCP-side LLM-dollar guard / model-downgrade on ABUSE only (the $15 app cap does
   not apply; `draft_proposal` is Claude-first with no cap) — a floor against runaway loops, NOT a
   throttle on legitimate heavy use. Low priority; margin is fat.

**Prices are validated; the work is: make heavy BQ use cheap + isolated (encourage it), then
instrument COGS. No repricing, and no per-user throttle.**
