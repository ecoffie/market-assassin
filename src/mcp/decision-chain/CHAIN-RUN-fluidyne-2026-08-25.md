# End-to-end chain run — Fluidyne Corporation, MCP surface, 2026-08-25

**Objective given to the chain:** *"I want to pursue federal opportunities similar to the
work Fluidyne Corporation has already won. Analyze its market, identify the best agencies
and competitors, find likely recompetes/open opportunities, identify incumbents, and tell
me what it should pursue next and why."*

**No fixes were made during this run.** Findings only, prioritized at the end.

## Ground truth (our own data, before asking any tool)

| | |
|---|---|
| `sam_entities` | `RG3VUTDYFNF8` FLUIDYNE CORPORATION · Active · NJ · synced 2026-08-25 |
| also present | `JW4XHMAB8GR7` FLUIDYNE ENGINEERING CORP · Active · MN |
| award history | 8 rows, NAICS 332919 / 335312 / 333914 / 334220 / 332911 / 333413 |
| annual obligations | FY23 $7.18M · FY24 $7.22M · FY25 $5.83M = **$20.2M** |

## Hop-by-hop

| Hop | Tool | Result |
|---|---|---|
| 1 identity (by NAME) | `lookup_sam_entity` | ❌ **CHAIN-1** `grounded=false degraded=false` — asserts the company does not exist |
| 1b identity (by UEI) | `lookup_sam_entity` | ✅ resolves FLUIDYNE CORPORATION, NJ, Active |
| 2 past performance | `get_contractor_award_history` | ❌ **CHAIN-2** `grounded=false`, 0 awards, $0 |
| 2b obligations | `get_recipient_annual_obligations` | ✅ grounded, $20.2M FY23-25 |
| 3 market/competitors | `assess_market_depth` | ✅ 332919 depth 471, Rule-of-Two met, 591 businesses, real performers leading |
| 4 opportunity | `get_expiring_contracts` | ✅ grounded, 50 recompetes with incumbents + dates |
| 5 decision | `capability_market_match` | ❌ **CHAIN-3** returns 6 tables, **no recommendation** |

## CHAIN-1 — name lookup asserts non-existence (P0)

`lookup_sam_entity({name:'Fluidyne Corporation'})` → `grounded=false, degraded=false`.
That pair means *"we checked and this company does not exist."* It does exist, in our own
mirror, synced the same day.

**Root cause (traced, not inferred):** in `src/mcp/tools/sam-entity.ts` the local-registry
fallback lives **only inside the `catch` block**. Live SAM returned a successful 200 with
zero results, so nothing threw, so the mirror was never consulted. DEFECT-7 hardened the
*throw* path; the *empty-success* path was never covered.

**Severity:** a user who knows their UEI succeeds; a user who types their company name is
told it does not exist. Name is the normal way a human asks.

**Same class as the P0 already fixed on `/api/entity-lookup`** — an evidence gap rendered
as a world fact — on a different surface.

## CHAIN-2 — two tools, same company, contradictory answers (P0)

At the same moment, on the same corpus:

* `get_recipient_annual_obligations(recipient:'FLUIDYNE CORPORATION')` → **grounded, $20.2M**
* `get_contractor_award_history(company:'FLUIDYNE CORPORATION')` → **grounded=false, $0**

Tried `FLUIDYNE CORPORATION`, `Fluidyne Corporation`, `Fluidyne` — all zero. This is the
previously-reported defect reproduced exactly: identity resolves, agencies and awards come
back empty. **Not diagnosed further during this run** (no fixes rule).

⚠️ The tools disagree *without either reporting degradation*. An agent calling only
`get_contractor_award_history` would tell the user Fluidyne has no federal history.

## CHAIN-3 — the decision hop produces tables, not a decision (P1)

`capability_market_match` returns `subject, keywords, market, buyer_vocabulary,
competitors, upcoming_forecasts, recompete_opportunities`. There is **no field naming a
next action, a ranked pursuit, or a rationale.** The user's actual question —
*"what should it pursue next, and why?"* — is left to the reader.

Worse, the content drifted off the company:

* `lead_keyword: "manufactures"` — a generic verb from the description, not a capability
* `top_naics`: 332993 Ammunition, 336414 Guided Missile, 334511 Navigation — **none of
  Fluidyne's six real award NAICS**
* `competitors`: Boeing ($10.8B), Raytheon ($6.4B), General Dynamics, Northrop — primes
  two to three orders of magnitude larger than a $20M fluid-power manufacturer
* `buyer_vocabulary`: "small diameter bomb", "propelling charges", "ukraine"

The tool never consulted Fluidyne's **actual award history**, which we hold. It matched on
free-text keywords instead — so the answer is confidently about a market Fluidyne is not in.

## What is HEALTHY (recent fixes verified in a real journey)

* **DEFECT-9B holds.** Market depth returns real performers first (ATLANTIC DIVING SUPPLY,
  W S DARLEY, KIPPER TOOL — all `active_performer`), not arbitrary registrants.
* **Rule-of-Two determinations** are conclusive and defensible (332919: depth 471 of 1,060
  eligible; 332911: 495 of 1,099).
* **Recompete data is rich** — 50 contracts with named incumbents, real end dates, values.
* **Identity by UEI** is correct and fast.

## Priority

| # | Finding | Sev | Why |
|---|---|---|---|
| 1 | CHAIN-1 name lookup asserts non-existence | **P0** | Same class as the closed P0; a demo attendee typing their company name is told it does not exist |
| 2 | CHAIN-2 award history empty while obligations are grounded | **P0** | Two tools contradict each other with no degradation signalled |
| 3 | CHAIN-3 decision hop ungrounded in the company's own history | **P1** | Produces a confident answer about the wrong market |

**The chain's weakest link is not any single tool — it is that hop 5 never consumes hops
2-4.** Fluidyne's real NAICS, agencies and recompetes were all available and all ignored.
