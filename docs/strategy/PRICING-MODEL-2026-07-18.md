# Mindy Pricing Model — Two Products (2026-07-19)

Decided by Eric across a long session. **Mindy is two products** (the ChatGPT model:
flat app subscription + metered API/agent access). This doc is the source of truth.

## The two products
### 1. Mindy App — flat subscription, NO credits
The web UI: briefings, market research, tools, dashboard. Features are **tier-gated**, not
credit-counted (this is how the app already works). Eric's original, proven prices:
| Tier | Price | What you get |
|---|---|---|
| **Free** | $0 | daily alerts, Discover, 5 NAICS |
| **Pro** | **$149/mo** | full web tools + AI briefings (1 seat) |
| **Team** | **$499/mo** | everything + 5 seats + shared workspace |

**App subscribers get NO bundled MCP credits.** (Changed 2026-07-19 — was bundling 1,500/8,000.)

### 2. Mindy MCP — metered agent access, bought separately
Connect an AI agent (Claude Desktop, etc.) to run Mindy's tools programmatically. This is the
credit-metered product, priced on the VALUE of what an agent produces.
- **Entry:** **$99/mo → 500 credits** (≈ 3–4 proposals or 5 market reports).
- **Top-ups (premium "one more" valve):** 300 cr / $79 · 700 cr / $149.
- (An MCP Pro/Team subscription tier can come later if agent usage takes off — for now:
  the $99 entry sub + credit packs is enough. Eric, 2026-07-19.)

**Why separate:** it's the ChatGPT split — ChatGPT Plus ($20 flat app) vs OpenAI API (metered);
Anthropic, Cursor, Perplexity all do the same. Mindy already works this way (app tier-gated,
MCP the only credit-metered surface), so this just formalizes it.

## Core principle: price MCP on VALUE, not our cost
Our real cost per credit is ~$0 (reads hit free APIs; LLM tools capped at ~$15/user/mo via
`usage-cost.ts`). Credits are a **budget of premium, $1,000s-value deliverables**:
- **Market research report** = **$5,000** (Eric's historical rate) → **100 credits (~$20)**.
- **Federal proposal** = **$3,500–$7,500** (consultants $100–300/hr) → **100 cr (~$20)**.
  (Sources: FedMarket, OST Global, OCI.) So even MCP entry hands over **$5,000 of work for
  lunch money** — a ~250× steal.

## MCP credit mechanics (SHIPPING in code; $ prices need Stripe products)
- **Credit amounts** (env-tunable — `MCP_*_MONTHLY_CREDITS`): MCP entry 500/mo; internal comp 1,500/mo.
- **Tool costs** (value-anchored): `generate_market_report` 100 · `draft_proposal` 100 (full run
  ~140 w/ matrix+referee+docs) · `find_capable` 30 · `referee` 15 · `draft_section` 15 · `sol-docs` 8.
  Reads/searches stay 1–2 (inputs, not products).
- **Top-ups repriced** so per-credit steps DOWN by commitment (top-ups priciest, subs cheaper):
  Plus 300/$79, Scale 700/$149 (was 2,000/$49 & 5,000/$99 — those undercut everything).

## Internal / comp (the Branden fix — grant cron, internal-only)
The monthly grant cron now serves **only internal comp** (no app-Pro population, near-zero
accident risk):
- **Team/staff + advocates** → 1,500/mo ongoing (`INTERNAL_TEAM_EMAILS` + `branden@govcongiants.com`
  + Sue + AJ). Branden confirmed in the audience.
- **Comp / testimonial** (Kurt, Ryan, pa.joof, Olga, Tavin, dare2dream) → **500 one-time**, no
  refill (`scripts/reset-comp-credits.ts`, dry-run default).
- **App-Pro subscribers** are no longer auto-granted MCP — existing balances kept (grandfathered),
  future MCP is bought.

## Rollout — prove it, don't big-bang
Mindy just started selling + MCP is new → decouple:
1. **Ship now (code, zero market risk):** MCP credit amounts + value-anchored tool costs + the
   internal-comp grant fix (Branden). No dollar-price change; existing customers untouched.
2. **The MCP price test** (needs new Stripe products — Eric's config): MCP entry $99/500 + top-ups
   $79/$149, surfaced on the gamified landing / MCP signup. App stays flat at $149/$499. Grandfather
   existing. Tune credit amounts via env; measure signup→paid / top-up frequency ~a month.
3. Prove → commit, or dial back via env/config. No re-architecture.
