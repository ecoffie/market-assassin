# Potato v1 — completion record

**Status: SHIPPED. Do not reopen Potato v1** unless billing, security/privacy, fabricated evidence, or a genuinely broken customer journey. Edge cases, ranking nits, missing datasets, and nicer copy are Potato v2 debt.

Recorded 2026-09-17 from live production.

---

## Production evidence that matters

| Item | Value |
|------|--------|
| Merge SHA | `8cab32a22426779359bfc1c1073f72bbccb06ce3` |
| PR | [#1550](https://github.com/ecoffie/market-assassin/pull/1550) |
| Vercel project | `market-assassin` (`prj_8EXxyyIhcQkBRMMfwiYbxuzYIpVu`) |
| Live alias | `getmindy.ai` → deploy `dpl_DsYucbKmWX5diCZ62T6SibKGCVw5` (`market-assassin-51oubqok0`) |
| Catalog | `GET https://getmindy.ai/api/mcp/catalog` HTTP 200 · **62 tools** |
| MCP page | `GET https://getmindy.ai/mcp` HTTP 200 |

**Not acceptance evidence:** later CLI `vercel --prod` completions that do not own the live alias.

**Superseded:** the env-broken local E2E (`supabaseUrl is required` because FIND captured env at import time) and the blocked push caused by untracked `_tmp` typecheck files. They do not change the production state.

Included commits on the merge:

| SHA | What |
|-----|------|
| `12d696d794349f1b02b0b8e15fc540baa6d5def3` | PATHWAY FIT honest-miss host |
| `3bbb5ffd84ccbfcf7055aa12a8f7ed1340ec7b26` | Potato journey orchestration |
| `121e8e12caceb5d46d852a9448b0fbbe266dc769` | Talent / Position / Act / Monitor host rules on the connector |
| `8cab32a2` | Merge to `main` |

Prior PATHWAY FIT product merge: PR [#1549](https://github.com/ecoffie/market-assassin/pull/1549) / `55a62ad8`.

No new MCP tools were added for Talent, Position, Act, or Monitor. Those steps are connector orchestration over existing tools.

---

## The customer journey (v1 finish line)

Naive customers do not need to say SAM, NAICS, PSC, recompete, forecast, pain point, capture, incumbent, Rule of Two, CSO, OT, PAE, or set-aside.

| Step | Customer question | How v1 does it |
|------|-------------------|----------------|
| 1. FIND | Where's the money? | `find_opportunities` — Open now / Coming back / Coming soon. Empty Open is not a market-wide zero. Unavailable horizon is not zero demand. Never a SAM-only market conclusion. |
| 2. UNDERSTAND | What does this customer care about? | `understand_customer` after a specific open hit. Three sections with provenance: notice fact / curated research / derived emphasize. Curated research is not government fact. |
| 3. CURRENT INTELLIGENCE | What's changed about how they're buying? | `get_current_acquisition_intelligence`. Record evidence is not future certainty. Failed sources are unavailable, not zero. |
| 4. PATHWAY FIT | Which doors can my company actually walk through? | `match_company_to_pathways`. Two-sided. `no_proven_door === true` is a complete successful result. |
| 5. TALENT THIN | What proof do I have, and what's missing? | From the PATHWAY FIT result only. Show stranger-verifiable proof. Ask **one** missing-proof question. Owner answers stay `OWNER_ASSERTED`. Full Morehouse Talent is not in v1. |
| 6. POSITION | What should I say? | Orchestration, not a new engine. Capability statement / response / meeting from this journey's evidence. |
| 7. ACT | What should I do next? | **One** concrete next action grounded in the journey. Not a generic GovCon checklist. |
| 8. MONITOR | Want me to watch this? | Confirm first. Open now + Coming soon can be emailed. Coming back / recompetes are **not** emailed. Then STOP. |

Then stop. That is Potato v1.

---

## Step records

### FIND — DONE / PROD

Tool: `find_opportunities` (10 credits).

Three independent horizons. Connector forbids substituting `get_agency_intel` or pain-points as “where the money is” if FIND errors. After an open hit, `_next` continues UNDERSTAND (not MONITOR-only because the market is broad).

### UNDERSTAND — DONE / PROD

Tool: `understand_customer` (5 credits).

`_next` is Current Intelligence: “Want me to show you what’s changed about how this customer is buying this work?” Set-aside is not the closer.

### CURRENT INTELLIGENCE — DONE / PROD

Tool: `get_current_acquisition_intelligence` (8 credits).

Observed pathways are labels on live records, not a forecast of the next buy.

### PATHWAY FIT — CLOSED

Tool: `match_company_to_pathways` (8 credits).

Honest miss (`no_proven_door === true`) presents:

1. “I don’t have enough evidence to establish an acquisition door for this company yet.”
2. WHAT I CAN VERIFY
3. WHAT'S MISSING
4. WHAT WOULD CHANGE THE ANSWER
5. At most one proof-changing question if `_next` is non-empty; otherwise STOP.

Forbidden: research menu, FIND restart, dossier, monitor, set-aside-first, manufacturing a pathway to remain helpful.

Host gate (already on prod before the orchestration commit):

| Case | Matcher | Host |
|------|---------|------|
| SOCOM + Booz Allen `JCBMLGPE6Z71` | CSO 29 / OT 22 `POSSIBLE_FIT` | **PASS** |
| VA IT + Leidos `UE9QJD4KK1L6` | `no_proven_door` | **PASS** — no research menu |

Do not polish PATHWAY FIT further in v1.

### TALENT THIN — SHIPPED (orchestration)

Show public proof (award, customer, work, value, dates, NAICS/PSC, cert provenance, public contract relationship). Name the single most important missing proof. Ask one question. Owner-provided evidence is `OWNER_ASSERTED` and must not become `PUBLIC_VERIFIED`.

### POSITION — SHIPPED (orchestration)

| Customer ask | Output |
|--------------|--------|
| Want the right language and keywords for your capability statement? | headline · buyer language · capabilities to emphasize · proof to lead with · evidence-backed differentiators · language/claims to avoid · short buyer-specific paragraph |
| Want me to help you respond to this opportunity? | THE OPPORTUNITY SAYS / BROADER CUSTOMER RESEARCH SHOWS / YOUR PROOF / WHAT THAT SUGGESTS YOU EMPHASIZE, then draft. Broader research is never solicitation fact. |
| Want me to prepare you for a conversation with this customer? | what they appear to care about · what changed · buying behavior · what to say · proof to mention · questions to ask · claims to avoid · one recommended meeting objective |

### ACT — SHIPPED (orchestration)

One primary action from journey evidence (`composeActFromPathwayFit`: safe next action, gather missing proof, or honest-miss stop). No auto-run of paid or write tools.

### MONITOR — SHIPPED (existing tool)

Tool: `schedule_market_search` (0 credits). “Yes / keep going” on a prior journey question is **not** watch confirmation. Create a watch only after an explicit yes to “Want me to watch this for you?”

---

## Naive-user end-to-end

Opener: **“I do cybersecurity work and want to sell to SOCOM. Help me.”**

Customer never used GovCon vocabulary. Company given in plain English (Booz Allen Hamilton). Demo answer labeled owner-asserted. Watch declined / not created.

Tool order:

`find_opportunities` → `understand_customer` → `get_current_acquisition_intelligence` → `match_company_to_pathways`

Then host-only Talent / Position / Act / Monitor. `schedule_market_search` was **not** called.

| Step | What happened |
|------|----------------|
| FIND | Grounded. Headline: 1 open now · 0 coming back · 0 coming soon. Top hit: USSOCOM wearable safety / physiological monitoring Sources Sought. Empty horizons were not “the market is dead.” |
| UNDERSTAND | Notice fact vs curated DoD research vs emphasize, with provenance labels. |
| CAI | CSO + OT language on **this** notice as record evidence, not future certainty. Forecasts unavailable ≠ zero. |
| PATHWAY FIT | CSO / OT `POSSIBLE_FIT`. Set-aside **not established** for Booz — not the strategy. Two-sided proof + missing. |
| TALENT | One question: can you demonstrate a working capability today? Answer labeled **OWNER_ASSERTED**. |
| POSITION | Capability statement from journey evidence. Response / meeting offered, not auto-run. |
| ACT | Respond to this Sources Sought by 17 Sep 2026. |
| MONITOR | Asked with Open now + Coming soon coverage. Coming back not emailed. No watch created. |

---

## 13 acceptance criteria

| # | Criterion | Verdict |
|---|-----------|---------|
| 1 | Customer never needs GovCon vocabulary to advance | **PASS** |
| 2 | No SAM-only market conclusion | **PASS** |
| 3 | Unavailable source ≠ zero | **PASS** |
| 4 | Curated intelligence ≠ government fact | **PASS** |
| 5 | Historical pathway usage ≠ future certainty | **PASS** |
| 6 | Set-aside is not the automatic strategy | **PASS** |
| 7 | Positive pathway fit stays two-sided | **PASS** |
| 8 | `NO_PROVEN_DOOR` is an acceptable outcome | **PASS** |
| 9 | Owner assertions stay owner-asserted | **PASS** |
| 10 | Positioning claims do not outrun evidence | **PARTIAL** |
| 11 | One useful next action, not a generic checklist | **PASS** |
| 12 | Monitoring waits for confirmation | **PASS** |
| 13 | No auto-running paid/write actions without confirmation | **PASS** |

**#10 PARTIAL:** the capability-statement body said “ready to demonstrate today” (later labeled owner-asserted) and overreached with “CMMC 2.0 ready.” Comprehension held. Not a v1 reopen. See debt.

v1 overall: **SHIPPED** (12 PASS, 1 PARTIAL, no FAIL).

---

## Production tool / catalog state

Re-measured 2026-09-17 against `https://getmindy.ai/api/mcp/catalog`.

**62 tools.** Potato v1 uses these five; the rest of the catalog is unchanged.

| Tool | Credits | Journey role |
|------|---------|--------------|
| `find_opportunities` | 10 | FIND |
| `understand_customer` | 5 | UNDERSTAND |
| `get_current_acquisition_intelligence` | 8 | CURRENT INTELLIGENCE |
| `match_company_to_pathways` | 8 | PATHWAY FIT + Talent-thin evidence |
| `schedule_market_search` | 0 | MONITOR (confirm first) |

There is no `talent_*`, `position_*`, or `act_*` tool. Host rules live on MCP initialize instructions (`MCP_CONNECTOR_INSTRUCTIONS`).

---

## Potato v2 debt

Do **not** start these from a v1 bug report. Pick them deliberately later.

| Issue | Why it matters | Evidence | Future work |
|-------|----------------|----------|-------------|
| FIND ranking for “cybersecurity” + SOCOM led with wearable hardware (NAICS 334220) | Naive cyber seller may get a loosely related specific notice | Live FIND, 1 open hit | Ranking / query. Not a new product. |
| FIND captures `SUPABASE_URL` at module load | Local/stdio import-before-env throws instead of degraded | `supabaseUrl is required` until `--env-file` | Read env at call time |
| Positioning body can bury `OWNER_ASSERTED` | Claims outrun the label | Capability-statement paragraphs | Label every owner-asserted proof sentence |
| “CMMC 2.0 ready” without a public cert | Positioning outruns evidence | Same draft | Ban cert claims unless `PUBLIC_VERIFIED` |
| Host still names CSO/OT after translating to pitch-and-demo | Fine for experts; noisy for beginners | CAI / PATHWAY presentation | Prefer customer language on the first pass |
| Full Talent (what broke, outcomes, speed, savings, vouches, complete vehicle portfolio, demonstrable readiness as verified fact) | Blocked on stranger-verifiable evidence | Morehouse audit | Do not build until evidence exists |
| Coming-back email coverage | Monitor must not imply recompete alerts | Known watch limitation | Alert coverage, not a new intelligence product |
| PAE / consortium / rapid-office datasets | Honest `NOT_ESTABLISHED` | CAI `potential_not_established` | Only if it changes a door determination |
| Accidental saved-search write during the failed first local E2E | Test write on `eric@govcongiants.com` | map `ss=da85d89e-…` | Inspect / delete that saved search |
| CLI `--prod` omits git SHA and can steal the live alias | Wrong deploy can look like “prod” | `auct58s6f` vs `51oubqok0` | Always alias `getmindy.ai` to the GitHub SHA deploy |

---

## What v1 is not

- Not full Morehouse Talent.
- Not new ingestion, datasets, acquisition-pathway research tracks, or MCP tools.
- Not a promise that Coming back / recompetes are emailed.
- Not certainty that a historical CSO/OT label will be the next buy.
- Not independently verified owner assertions.

Potato v1 is finished. Next work is a separate decision, not a continuation of this track.
