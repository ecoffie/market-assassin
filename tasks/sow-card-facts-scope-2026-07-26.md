# SOW → Card Facts — Scope (2026-07-26)

**Reframed ask:** the earlier scope killed *"SOW → dollar estimate"* (correctly — no rate source,
mostly noise). But that threw the baby out. The SOW text we already have is **full of card-worthy
qualifying facts** that help a small biz decide "is this for me?" in 2 seconds — even though it
can't produce a price. This scopes **SOW → structured card facts**, not SOW → price.

## The corpus (MEASURED, active opps only, `length(sow_text) > 200`)

- **2,502** active opps carry real SOW text (>200 chars). That's the addressable set.
- What's ALREADY a clean structured column (so we do NOT re-extract it):
  | Column | Populated | Note |
  |---|---|---|
  | `notice_type` | 2,502 (100%) | RFQ/RFP/SS/etc — already have it |
  | `psc_code` | 2,463 (98%) | the what-was-bought code |
  | `set_aside_code` / `set_aside_description` | 1,956 (**78%**) | NOT null like recompete — mostly present |
  | `pop_state` | 1,888 (75%) | place-of-performance state |
  | `seo_summary` | 1,709 (68%) | a plain-English blurb already exists for most |

## The REAL gap SOW extraction fills (fields with NO structured column)

Regex-probed prevalence across the 2,502 (a floor — an LLM finds more, cleaner):

| Card fact | In-text hits | % of SOW opps | Why it matters on the card | Structured col? |
|---|---|---|---|---|
| **Evaluation basis** (Best Value / LPTA / trade-off) | 254 | 10% | "Can I win on price, or do I need past perf?" — changes bid/no-bid | ❌ none |
| **Brand-name / brand-name-or-equal** | 192 | 8% | 🚩 wired-buy signal — "equal to Pollstar", "BRAND NAME STRATASYS" = likely incumbent-favored | ❌ none |
| **SB size standard** (employees/$) | 318 | 13% | "Do I even *qualify* as small here?" — instant self-filter | ❌ none |
| **Period of performance** (base + option years) | 1,100 | **44%** | 1-yr buy vs 5-yr IDIQ = totally different pursuit | ❌ none |
| **Set-aside (from text)** | 503 | 20% | **fills the 22% gap** where `set_aside_code` is null + reconciles mismatches | ⚠️ partial (78%) |
| **Delivery / FOB terms** | 1,900 | 76% | product buys: where + how delivered | ❌ none |
| **Plain-English "what they need"** | ~all | — | the single most useful card line; `seo_summary` covers 68%, SOW fills the rest | ⚠️ partial (68%) |

## What to actually build (ranked by value / effort)

**Tier 1 — ship first (highest signal, cleanest extraction):**
1. **🚩 Brand-name / or-equal flag** — a boolean + the named brand. Highest *decision* value (it's a
   wired-buy tell), only 8% but those are exactly the ones a user should be warned about. Easy: the
   phrase "brand name" / "brand-name or equal" / "equal to X" is unambiguous.
2. **Evaluation basis chip** — `Best Value` vs `LPTA` vs `Trade-off`. One clean enum, changes the
   whole bid strategy. Small LLM classification or tight regex.
3. **Set-aside reconciliation** — extract set-aside from SOW text, use it to **fill the 22% where
   `set_aside_code` is null**, and FLAG the rare mismatch (structured says full-and-open, text says
   100% SB). Directly improves the #1 small-biz filter.

**Tier 2 — nice adds:**
4. **Period of performance** (base year + N option years) — 44% coverage, real pursuit-sizing signal.
5. **SB size standard** (e.g. "750 employees", "$X M") — the qualify/don't-qualify line.

**Tier 3 — skip for now:** delivery/FOB terms (76% but low decision value — it's logistics, not a
bid/no-bid input).

## How to extract (grounds every fact in the real doc — NO LLM guessing of facts)

- **The LLM LABELS, the text is the FACT** ([[ground_in_real_data]]). Extraction returns the
  verbatim span it matched ("evidence") so the card never shows a fact the SOW doesn't contain.
- **Cheapest path:** these are classification/span tasks → a small model (mini tier), OR tight
  regex for the unambiguous ones (brand-name, RFQ, size standard). Reserve the LLM only for eval
  basis + the plain-English line. This is NOT the expensive multi-pass extraction the price model
  needed.
- **Store like the existing intel pattern:** one JSONB column `sow_card_facts` on
  `sam_opportunities` (mirrors `intel_value_range` / `sow_text` / `map_lat`), computed by the
  precompute-opp-intel cron + a resumable backfill script. Store `{brandName, brandNameOrEqual,
  evalBasis, setAsideFromText, popPeriod, sizeStandard, evidence:{...}}`; null when not found.
- **DDL is hand-run** ([[cron_use_dispatcher]] sibling rule): deliver the `ALTER TABLE ... ADD
  COLUMN sow_card_facts JSONB` migration to Eric via clipboard; add the col to DETAIL_COLS only
  AFTER it exists ([[postgrest_missing_column_nulls]]).

## Card display (where it goes)

- Map popup card + detail drawer already render a facts row (Set-aside · Response due · NAICS ·
  Notice type). **Add:** a 🚩 brand-name pill (only when true — it's a warning), an eval-basis chip
  (`Best Value` / `LPTA`), and PoP ("1 base + 4 option yrs") when present.
- Keep it a **cap-the-view** treatment: 2-3 highest-signal facts on the card; the full extracted set
  in the drawer. Don't wall it — this is free qualifying data that makes the card more useful and
  the habit stickier ([[mindy_product_principles]]: free = the signal that gets them in).

## Honest verdict

**Worth building — Tier 1 (brand-name flag, eval basis, set-aside fill/reconcile).** These are
high-decision-value, cheap to extract (regex + one small LLM call), fill genuine gaps with NO
structured column, and make the card materially more useful for a bid/no-bid call. This is the
*right* use of the SOW corpus — surface the qualifying facts, don't fabricate a number.

**Next step:** if approved, build as a Data Feature (measure ✓ done → migration → `sow-card-facts`
shared lib → cron + backfill → wire popup/drawer → marketing literature). Start Tier 1 only; prove
extraction accuracy on a 50-opp sample before backfilling all 2,502.
