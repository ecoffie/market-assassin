# Mindy MCP: Federal Contracting Intelligence for Any AI Agent

### How Mindy exposes 40 credit-metered GovCon intelligence tools to Claude, Cursor, or any agent you build — grounded in real federal data and an 8-year proprietary moat, with a contract that never fabricates

---

## The shift: your agent is smart, but it's flying blind on federal contracting

AI agents are now doing real work — researching markets, drafting outreach, qualifying opportunities. But ask a general-purpose agent a federal-contracting question and it guesses:

- *"Who's the incumbent on this VA cybersecurity recompete, and when does it expire?"* — the model invents a plausible company and a made-up date.
- *"What's the fair labor rate for a Senior Software Engineer on a GSA schedule?"* — it produces a number with no source.
- *"Who at the Army Corps Los Angeles District actually buys this?"* — it returns a generic `contracting.officer@army.mil` that doesn't exist.

The intelligence isn't in the model. It's in SAM.gov, USASpending, SEC EDGAR, GSA CALC, and — for the parts no public API holds — in eight years of GovCon Giants teaching, curated contact rosters, and proprietary corpora. **Mindy MCP is the bridge.** It's a hosted Model Context Protocol (MCP) server that hands any agent a catalog of grounded federal-contracting tools, so the answers come from real data instead of the model's imagination.

---

## The commodity trap — why "wrap SAM.gov" isn't a moat

SAM.gov and USASpending are free, public APIs. Any competitor can wrap them in a weekend, and several have. That layer is a commodity.

Mindy leads with those public-data tools because they're genuinely useful — but the reason an agent stays on Mindy is the layer competitors **cannot** copy:

- **The winning-playbook corpus** — 8 years of course, proposal-template, and podcast-guest content that answers *"how do I actually win this,"* which no public API contains.
- **Office-level buying contacts** — the named contracting officers and small-business POCs at a *specific* buying office, not the whole-department firehose.
- **A curated SBLO teaming roster** — the Small Business Liaison Officer at 200 primes, re-researched and verified, so an agent knows *who to call* to team.
- **The podcast lesson corpus** — real lessons from real contractor and agency guests, matched by topic, agency, or set-aside.

Wrapping a public API is the price of entry. The moat is the intelligence that took eight years of subject-matter work to assemble.

---

## What Mindy MCP gives an agent — 52 tools across four layers

The hosted server exposes **40 credit-metered tools** (plus a free `get_balance` check). Thirty-six are purpose-built GovCon intelligence tools; four are the core public-data search tools reused from Mindy's own platform. They fall into four layers:

### Public data & search

| Tool | What it answers |
|---|---|
| `search_sam_opportunities` | Open federal solicitations by keyword / NAICS / set-aside |
| `get_market_vocabulary` | The real terms buyers use for a market |
| `get_keyword_coverage` | Total market $ for a product + every buying NAICS ("NAICS is the wrong primary key") |
| `search_grants` | Federal grant (assistance) opportunities |
| `get_agency_forecasts` | Planned procurements 6–18 months before solicitation |
| `search_sbir` | SBIR/STTR small-business R&D awards + open notices |
| `get_expiring_contracts` | Contracts expiring within a window — recompete targets |
| `match_recompete_sow` | Given an expiring contract's scope, the open solicitation that is likely its recompete — by semantic SOW similarity, not keywords |
| `search_idv_contracts` | IDIQ / GWAC / BPA vehicles + the task orders flowing through them |
| `get_solicitation_documents` | Full SOW/PWS + attachments for a notice |
| `extract_statement_of_work` | The SOW/PWS/SOO pulled out as clean text — recovers scope buried in a Section C blob, with a CLIN-scope fallback |
| `search_federal_events` | Industry days, matchmaking, sources-sought for an agency |
| `get_federal_event_series` | The recurring event calendar (AFCEA, NDIA, SAME, APEX…) — where a market networks year over year |

### Competitive intelligence

| Tool | What it answers |
|---|---|
| `get_contractor_profile` | A firm's federal award history and profile |
| `search_contractors` | The competitive landscape by keyword / NAICS / state |
| `find_capable_contractors` | "Who can actually win this" — capable-firm scan |
| `get_contractor_award_history` | A named firm's obligations, trend, top agencies/NAICS |
| `get_incumbent_financials` | Public-filer financials from SEC EDGAR (revenue, margin, 10-K) |
| `get_pricing_intel` | GSA CALC price-to-win labor rates (p25/p50/p75, small-vs-large gap) |
| `get_sblo_contact` | The Small Business Liaison Officer at a prime — the teaming front door (curated roster → live BigQuery prime-verification fallback) |
| `lookup_sam_entity` | Live SAM registration (UEI/CAGE, status, certifications) |

### Agency & award intelligence

| Tool | What it answers |
|---|---|
| `get_agency_intel` | Agency identity, pain points, and live obligations |
| `get_agency_spending_detail` | Sub-agency (component) breakdown + set-aside distribution |
| `get_sba_goaling_share` | Statutory small-business goals vs. the agency's actual set-aside obligations — "is this a good small-business market?" |
| `get_agency_budget_trends` | FY-over-FY discretionary budget-authority trend (growing / cut) |
| `get_award_detail` | Obligated-to-ceiling, parent IDV, period of performance, recipient |
| `find_predecessor_award` | The likely incumbent for an open opportunity |
| `get_regulatory_demand` | Federal Register signals — "demand before SAM," 6–18 months early |
| `lookup_federal_osbp` | The small-business front door (OSBP office + director) for a command |
| `search_agency_opps_by_office` | Open opportunities anchored to a *specific* buying office |
| `search_federal_contacts` | Named POCs at a specific buying office — from a ~167K-row directory (~85K emailable), DoDAAC-anchored |
| `assess_market_depth` | Rule-of-Two capable-small-business count for a NAICS |

### Proprietary & proposal

| Tool | What it answers |
|---|---|
| `get_winning_playbook` | Grounded "how to win this" coaching — **the moat** |
| `search_podcast_lessons` | Real lessons from contractor/agency podcast guests |
| `evaluate_bid_decision` | The 5-gate / 10-factor bid / no-bid framework, scored |
| `extract_compliance_matrix` | Every shall/must + Section L/M/C requirement, harvested into a structured matrix |
| `build_proposal_structure` | The compliance matrix → the volume/section outline the proposal must follow |
| `scan_proposal_compliance` | Pre-submit disqualification scan (deadline, page limits, reps/certs) |
| `referee_proposal_compliance` | An *independent* model reviews the draft against the matrix — met / partial / missing |
| `derive_company_keywords` | A company's own words → the search keywords buyers use |

---

## The no-fabrication contract — why grounding *is* the product

An agent that confidently invents a contract number or an incumbent's revenue is worse than useless — it's a liability. Every Mindy MCP tool ships under one contract:

- **`_meta { grounded, degraded }` always ships.** `grounded = true` means at least one real record came back. `grounded = false` means nothing matched — and the tool instructs the agent to say so, **never** to invent.
- **`degraded = true` is distinct from empty.** It means an upstream source *errored* (surfaced honestly as "unavailable"), not that the answer is $0.
- **Data first.** The raw grounded data is the product. Optional narration is off by default — Mindy hands the agent facts, not a pre-written story.

**Worked example.** An agent calls `get_incumbent_financials("Acme Integrated LLC")`. Acme is a private contractor with no SEC filing. A naïve tool would hallucinate a revenue figure. Mindy returns `grounded: false` and the honest instruction: *no EDGAR filing exists — the company is likely private; do not invent financials; use the contractor-profile tool for its federal award history instead.* The agent tells the truth because the data told the truth.

---

## Office-level precision — the buying office beneath the department label

Here's a concrete example of moat over commodity. A DoD sub-agency — a USACE district, DARPA, MDA — shares one department label, "Department of Defense." So a naïve "DoD contacts" lookup returns the whole-Pentagon firehose: thousands of irrelevant people and a generic `osd.osbp@mail.mil` mailbox.

Mindy resolves the **real buying office** beneath that label. Ask for the contacts at the Army Corps of Engineers Los Angeles District and Mindy returns *that office's own* people — eleven `@usace.army.mil` engineers with real email addresses — plus its eleven open solicitations, not the department-wide flood. That precision comes from understanding how federal buying is actually structured, and it's the difference between "we wrap the API" and "we know how the money is actually spent."

---

## The proposal pipeline — a full bid loop, composable and stateless

Most MCP servers stop at search. Mindy carries an agent through the actual proposal, as a chain of composable tools it can run on inputs it already holds:

1. **`extract_compliance_matrix`** harvests every shall/must obligation and Section L/M/C requirement from the solicitation into a structured matrix — the foundation nothing downstream can skip.
2. **`build_proposal_structure`** turns that matrix into the volume → section outline the proposal must follow, with the critical deadline/cert items surfaced up front and the cross-cutting format rules that apply to every volume.
3. The agent drafts each section — using its own model, grounded in the requirements.
4. **`referee_proposal_compliance`** runs the assembled draft past an **independent** model that did *not* write it, for a per-requirement verdict — met / partial / missing, with evidence and a compliance score. Independence is the point: the drafter thinks it's done; a fresh referee catches the unmet "shall" items before submission.

Alongside the chain, **`match_recompete_sow`** closes the recompete loop — hand it an expiring contract's scope and it finds the open solicitation that is likely its recompete by semantic SOW similarity, and **`extract_statement_of_work`** pulls a clean scope out of a combined solicitation to hand to subs.

One line stays deliberately fixed: the actual **drafting of proprietary content** — the evidence-weave from a company's private past performance — stays inside Mindy's authenticated Vault, which an external agent can't and shouldn't reach. The MCP hands over the *inputs, structure, and independent judgment*; the customer's own agent does the writing. That boundary is what keeps private data private and the moat defensible.

---

## Pricing — credit-metered, pay only for a successful call

An agent connects, and its owner funds a credit balance; each call debits on success. A failed or empty call costs nothing.

- **100 free credits on your first connect** — roughly one real evaluation, so an agent can prove value before anyone pays.
- **Debit-on-success only.** The credit ledger is atomic at the database layer — a hundred concurrent calls can't corrupt a balance, and a balance never goes negative.
- **Plus and Scale credit plans** — monthly or annual — for ongoing use; **Pro subscribers get a monthly credit allowance included.**

Representative prices (credits per successful call):

| Price | Tools |
|---|---|
| **1 credit** | Most lookups — opportunity search, pricing intel, agency intel, OSBP contacts, keyword coverage, compliance scan, bid/no-bid, proposal outline, event series |
| **2 credits** | Deeper reads — incumbent financials, award detail, predecessor trace, competitive landscape, agency spending breakdown, buying-office roster, SBLO teaming lookup, recompete match, SOW extraction, SBA goaling |
| **3 credits** | Solicitation documents + compliance-matrix extraction (fetches + extracts on demand) |
| **4 credits** | Independent proposal referee (a separate model reviews your draft against the matrix) |
| **5 credits** | Contractor deep-dive profile (live data scan) |
| **25 credits** | "Who can win this" capable-contractor scan (the heaviest compute) |
| **Free** | `get_balance` |

---

## Connect in minutes — keyless

Add one endpoint to Claude, Cursor, or your own MCP client and sign in through your browser. No API key to copy.

```
https://getmindy.ai/mcp/mcp
```

The default connect path is **keyless OAuth 2.1** — the agent's owner signs in through the browser, and the first connect grants the 100-credit welcome balance. Running headless or in CI? Mint an API key from the dashboard at `getmindy.ai/mcp` and send it as a bearer token instead.

---

## The data behind the tools

Every figure Mindy returns traces to a real source. That's a rule, not a marketing line — provenance is documented for every tool.

| Source | Powers |
|---|---|
| **SAM.gov** | Open solicitations, buying-office POCs, entity registrations |
| **USASpending.gov** | Award detail, agency & component spending, recompetes, IDVs |
| **SEC EDGAR** | Public-filer incumbent financials |
| **Federal Register** | Regulatory-demand leading indicators |
| **GSA CALC+** | Price-to-win labor rates |
| **Grants.gov / NIH RePORTER** | Grants + SBIR/STTR |
| **Curated GovCon corpora** | Winning playbook, podcast lessons, SBLO roster, OSBP directory, agency intel |

Public data is labeled public; curated intelligence is labeled curated; an honest miss is labeled `grounded: false`. Nothing is dressed up as something it isn't.

---

## The bottom line

Mindy MCP is not "an API wrapper for federal contracting." It's a grounded intelligence layer for AI agents — **52 tools** spanning the public data any agent needs, a full proposal pipeline, and the proprietary intelligence no competitor can copy, all under a contract that returns real data or honestly returns nothing.

- **Commodity done right** — the public-data tools are fast, cached, and useful on call one.
- **Moat where it counts** — winning playbooks, office-level buying contacts, SBLO teaming, and podcast lessons that took eight years to build.
- **Trustworthy by construction** — `grounded` and `degraded` on every response; `grounded = false` never invents.

Point your agent at `getmindy.ai/mcp/mcp`, sign in, and the first 100 credits are on us.

---

*Mindy is a product of GovCon Giants. For demos, partnerships, or enterprise inquiries: hello@govcongiants.com*
