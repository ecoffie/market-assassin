# Mindy Credit & Pricing Model (2026-07-18)

The value-anchored credit model. **Decided by Eric across a long working session.** This
doc is the source of truth for the model; the code defaults implement the "ship now" column.

## Core principle: price on VALUE delivered, not our cost
Our real cost per credit is ~$0 (reads hit free APIs; LLM tools are capped at ~$15/user/mo
via `usage-cost.ts`). So credits are NOT priced to cover cost — they're a **budget of
premium, $1,000s-value deliverables.**

**Value anchors (real market rates):**
- **Market research report** = **$5,000** (Eric's own historical rate).
- **Federal proposal** = **$3,500–$7,500** standard, up to $50k complex; consultants $100–300/hr;
  full-time proposal writer $75k–$125k/yr. (Sources: FedMarket, OST Global, OCI, BidBionic.)

So the two flagship deliverables cost **100 credits each (~$10–26)** while replacing
**$5,000–$7,500** of work → ~500× value. That is the entire pitch: *"the $5,000 report, now
instant."* Nobody counts credits when one output would've cost them $5,000.

## The ladder — per-credit price DECREASES as you commit more (like cloud pricing)
Monotonic $/cr: top-ups (pay-as-you-go, priciest) → Starter → Pro → Team (cheapest). This is
what makes "buy more, save more" real and forces the upgrade.

### SHIP NOW — credit amounts only, current prices kept (no Stripe change)
| Plan | Price | Seats | Credits/mo | $/cr |
|---|---|---|---|---|
| **Starter** | $59 | 1 | **500** (was 2,400) | $0.118 |
| **Pro** | $149 | 2 | **1,500** (was 6,000) | $0.099 |
| **Team** | $499 | 5 | **8,000** | $0.062 |
| **Top-up S** | $49 | — | **300** (was 2,000) | $0.163 |
| **Top-up L** | $99 | — | **700** (was 5,000) | $0.141 |

Sizing rationale (realistic usage, not proposal count — the bulk of credits go to 1–2 cr
reads, not proposals): a busy 2-person Pro shop burns ~1,500/mo (≈30 proposals/YEAR per Eric's
real data point + daily research). An agency running 5 people + client work blows past it → Team.

### THE PRICE TEST — higher prices on NEW signups (Eric, 2026-07-19: "bump the price up again")
Value gives huge room; these stay below every direct competitor (SweetSpot $300, GovWin
$200/seat, BidSparq $249, HigherGov $150–500). Rolled out as a **market test: new signups
only, grandfather every existing customer** (Stripe doesn't touch an existing sub when new
prices are added). Rides with the gamified landing (the new-visitor surface). Credit amounts
UNCHANGED (env-tunable). **Needs new Stripe products (Eric's config) → wire the new price IDs.**
| Plan | Test price | Credits | $/cr |
|---|---|---|---|
| Starter | $99 | 500 | $0.198 |
| Pro | $249 | 1,500 | $0.166 |
| Team | $999 | 8,000 | $0.125 |
| Top-up S | $79 | 300 | $0.263 |
| Top-up L | $149 | 700 | $0.213 |
Dollar-price changes need NEW Stripe products (Eric's config) → point `packages.ts` price IDs
at them. Credit amounts are env-tunable live (`MCP_PRO_MONTHLY_CREDITS` / `MCP_SCALE_MONTHLY_CREDITS`).

## Flagship tool reprices (value-based, SHIPPING)
| Tool | Was | Now | Why |
|---|---|---|---|
| `generate_market_report` | 20 | **100** | replaces a $5,000 report |
| `draft_proposal` | 50 | **100** | replaces a $3,500–$7,500 proposal (full run ~150 w/ supporting tools) |
| `find_capable_contractors` | 25 | 30 | heavy live BigQuery scan |
| `referee_proposal_compliance` | 12 | 15 | independent Claude referee |
| `draft_proposal_section` | 12 | 15 | one LLM generation pass |
| `get_solicitation_documents` | 5 | 8 | cold downloads + extraction, heavily repeated |
Reads/searches stay 1–2 cr — they're inputs, not the product.

## Internal / comp audience (the Branden fix)
The monthly grant used to hit only KV `briefings:*` — which includes comp Pro (Kurt) but NOT
staff-by-domain (Branden). Three tiers:
- **Paid Pro + Team + team/staff + advocates** → ongoing monthly (Pro rate 1,500; Team rate 8,000).
  Team/staff = `INTERNAL_TEAM_EMAILS` + `branden@govcongiants.com`. Advocates = Sue, AJ (kept
  ongoing on purpose — they're the marketing engine; capping them defeats the comp).
- **Comp / testimonial** (Kurt, Ryan, pa.joof, Olga, Tavin, dare2dream) → 500 one-time, no refill (runs out). Ryan capped at 500 too (Eric, 2026-07-19).
- **New signup** → 100 trial (unchanged).
Existing comp balances reset to their cap (Kurt 911 → 500).

**⚠️ The grant cron is the exact code that caused the 688k-credit accident** (targeted the 688
beta cohort instead of ~75 real Pro). Always run `?preview=1` and eyeball the audience before it fires.

## How we roll it out (prove the model, don't big-bang)
Mindy just started selling + MCP is new → decouple:
1. **Ship now (zero market risk):** credit amounts + tool reprices + the internal/comp audience
   fix. No dollar-price change, existing customers untouched.
2. **Save this doc** (done).
3. **Test the STAGED prices on new signups later** — grandfather existing, new Stripe links for
   new signups, tune credit amounts via env, measure conversion / upgrade / top-up for ~a month.
4. Prove → commit, or dial back via env/config. No re-architecture either way.
