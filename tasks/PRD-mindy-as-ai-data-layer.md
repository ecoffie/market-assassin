# PRD: Mindy as the AI Data Layer for Federal Contracting

**Status:** Strategic direction, May 22 2026
**Owner:** Eric / Claude
**Time horizon:** v3+ (after Target Market Research workspace ships)

---

## The shift

> "With regard to the AI, I was thinking about how we can help their AI
> use our data to do something. Instead of building for humans maybe we
> build for other AI to use our data and info." — Eric, May 22 2026

Most SaaS products in 2026 are racing to **add a chatbot on top of
their data** ("Chat with our docs!"). That keeps them locked in the
B2C attention war they're losing to ChatGPT / Claude / Gemini.

Mindy flips the polarity: **become the federal-contracting data layer
that OTHER AI agents call.** Whoever wins the consumer AI race in
2027-28 (Anthropic, OpenAI, someone else) will need real-time federal
data when their agents handle BD tasks. We are either their supplier
or their competitor. Supplier is structurally a better business.

---

## The three layers we'd build

### Layer 1: MCP server (`mindy-mcp`)

Anthropic shipped the Model Context Protocol in 2024. By mid-2026 it's
the de facto standard for letting AI agents (Claude Desktop, Cursor,
Continue, custom agents on the Anthropic SDK) call external tools.

**What we ship:**

```
$ npx @govcongiants/mindy-mcp
> Starting Mindy MCP server on stdio
> Exposing 8 tools:
>   - search_opportunities(naics, agency, deadline_before)
>   - get_agency_intel(agency_name) → spend, pain points, OSBP, events
>   - get_pricing_intel(naics) → labor rates, GSA/SCA, price-to-win
>   - find_target_agencies(naics, business_type, psc?)
>   - track_to_pipeline(notice_id, user_email)
>   - search_recompetes(agency, naics, expires_within_months)
>   - get_market_summary(naics) → narrative + key stats
>   - search_grants(keyword, agency, status)
```

Anyone running Claude Desktop drops this in their `mcp.json` config
and Claude can now answer:
- "What are the 5 biggest DOD opportunities under $250K closing in
  the next 30 days for NAICS 541512?"
- "Add the Lockheed cybersecurity training recompete to my pipeline
  and find me 3 teaming partners."

The LLM does the reasoning. We supply the federal-contracting facts.

**Auth model:** API key per user (Mindy Pro subscription level), rate
limited per tier. Pro = 1000 calls/day, Team = 10K/day, Enterprise =
unlimited.

**Existing infrastructure:** CLAUDE.md already lists `mcp__samgov__*`,
`mcp__grantsgov__*`, `mcp__usaspending__*`, `mcp__multisite__*` tools
we use internally. The MCP servers ARE running; we just don't publish
them as a product. ~2 weeks of work to package + auth + publish.

### Layer 2: OpenAPI spec with `_ai_hint` fields

Every Mindy API endpoint already returns structured JSON. We add:

1. A versioned `/api/v1/*` namespace (we never accidentally break
   downstream agents with internal refactors).
2. A published `openapi.yaml` so any LLM can self-document our API.
3. **`_ai_hint` summaries** on every response — pre-narrated facts
   the calling LLM can pass verbatim to its user.

Example response:

```jsonc
GET /api/v1/agencies/DOD/intel?naics=541512

{
  "agency": "Department of Defense",
  "fy2026_budget": 850_000_000_000,
  "naics_spend": 4_200_000_000,
  "naics_contract_count": 12_847,
  "sat_friendly_pct": 0.18,
  "top_3_subagencies": ["Air Force", "Army", "Navy"],
  "open_opportunities": 234,
  "upcoming_events": 8,

  // ← This is the new bit. Pre-narrated. LLM-passable.
  "_ai_hint": {
    "summary": "DOD spent $4.2B in NAICS 541512 (Computer Systems Design) across 12,847 contracts in FY2026. Air Force is the largest sub-agency buyer. 18% of contracts were under the $250K Simplified Acquisition Threshold, making this an SAT-friendly market for new entrants. 234 opportunities are currently open with response deadlines.",
    "recommended_next_actions": [
      "Filter to open opportunities under $250K to find first-contract candidates",
      "Track the 8 upcoming industry events to meet Air Force decision-makers",
      "Compare your team's GSA Schedule rates against the price-to-win guidance"
    ],
    "key_caveats": [
      "FY2026 budget figure is congressional authorization; actual obligations TBD"
    ]
  }
}
```

The LLM consuming this can quote `_ai_hint.summary` directly to its
user. No re-summarization, no hallucination risk on numbers. We're
the source of truth for federal facts.

**Why this matters more than the raw data:** The LLM doesn't WANT to
do the math on 12,847 contracts. It wants the conclusion. Pre-doing
that conclusion is our product.

### Layer 3: Embeddings API

Vector search over our datasets:

- Every SAM opportunity (29K+) embedded
- Every pain point (3,045)
- Every agency profile (307)
- Every event (sam_events + static catalog)

Endpoint:

```
POST /api/v1/embeddings/search
{
  "query": "cybersecurity training for clinicians",
  "top_k": 20,
  "filters": { "naics_starts": "5415", "deadline_before": "2026-08-01" }
}
```

Returns top 20 semantically-matching opportunities with confidence
scores. The calling agent doesn't have to know SAM's notice types or
NAICS hierarchies — natural language in, ranked facts out.

**Cost note:** OpenAI text-embedding-3-small at $0.02/M tokens
embedding 29K opps is ~$0.50 one-time. Negligible.

---

## Business model implications

### Pricing

| Tier | Per-call rate | Daily limit | Monthly cap |
|---|---|---|---|
| Free (developer) | — | 100 calls | 1,000 |
| Pro ($49/mo) | $0.001/call | 1,000/day | 30,000/mo |
| Team ($249/mo) | $0.0005/call | 10,000/day | 300,000/mo |
| Enterprise ($999+/mo) | $0.0002/call | unlimited | volume-priced |

Compare to GovWin API access (custom enterprise quotes, $50K+/yr) —
we're 10-50x cheaper for an order of magnitude more developer-friendly
endpoints.

### Who buys this

1. **BD-tech startups** building AI agents for federal contracting
   (these will exist in 2027 — be the AWS to their Netflix)
2. **Federal consultancies** (Booz Allen, Leidos, smaller boutiques)
   wiring our data into their internal AI tools
3. **Big primes** giving their captures teams ChatGPT Enterprise
   with Mindy plugged in for real-time market data
4. **Existing GovCon SaaS** (GovWin, Bloomberg Government, Bgov)
   that don't want to build their own AI layer

### Why this is defensible

The moat isn't the API — it's:

1. **Cleaned, joined, NAICS-aligned data.** Raw USASpending +
   SAM.gov is hostile. We've spent years normalizing it.
2. **Agency aliasing.** "DoD" = "Department of Defense" = "DOD" =
   "Department Of Defense" — 450+ aliases in `agency-aliases.json`.
3. **Pain points + priorities.** 3,045 hand-curated entries no
   competitor has.
4. **OSBP + decision-maker contacts.** 2,768 contractors with SBLO
   contacts. No one else has scraped this together.
5. **`_ai_hint` summaries.** Trained / prompted to produce
   consistent voice + actionable framing. Hard to replicate at
   quality.

---

## Sequencing

| Phase | What | When |
|---|---|---|
| **Foundation** | Target Market Research workspace (current Phase 2) | This month |
| **v3.0** | OpenAPI spec + `_ai_hint` on existing endpoints | 1 month |
| **v3.1** | Public MCP server package | 2 months |
| **v3.2** | Embeddings API | 3 months |
| **v3.3** | Developer dashboard / API key management | 4 months |
| **v3.4** | Public launch + pricing | 5 months |

---

## What we DON'T do

- **Don't build our own chatbot for end users.** That's the trap
  everyone else is in. Mindy stays a workspace product for end
  users AND becomes a data product for AI builders. Two markets,
  same underlying infrastructure.
- **Don't build LLM inference.** We don't run models. We supply
  facts to whoever's running them.
- **Don't restrict access to internal use only.** The whole point
  is to be the federal data layer — open up the API.
- **Don't try to compete with Anthropic / OpenAI on agent quality.**
  Be the data plug they need, not the agent itself.

---

## Connection to existing work

This isn't a pivot. Everything we've already built (Target Market Research workspace,
events DB, pain points, contractor DB, AI Analyst caching) directly
maps to API endpoints. The data is there. We just expose it
differently.

The Target Market Research workspace becomes "the example app showing what's possible
with the Mindy API." Like Vercel ships Next.js (the framework) AND
runs Vercel.com (the example platform built on it). Two products,
one infrastructure.

---

## Open questions

1. **Naming.** "Mindy API" or something new (e.g. "GovCon.dev")? The
   B2B developer brand may want separation from the consumer Mindy
   brand.
2. **Auth.** API key (simpler) vs OAuth (better for embedded apps)?
3. **Hosting.** Stay on Vercel or move the API tier to a different
   provider for higher rate limits / lower per-call cost?
4. **Open source the MCP server?** Drives adoption but loses some
   control over how it's used. Probably yes — Anthropic open-sources
   most of their MCP work.
5. **First customer.** Who's the design partner? Booz Allen's AI lab,
   one of the BD-tech startups, or a GovCon-focused YC company?
