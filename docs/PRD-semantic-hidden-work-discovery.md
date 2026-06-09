# PRD — Semantic "Find Work Hiding Under Funny Names"

**Status:** v1.1 (post-Juneteenth). Designed June 2026.
**Owner insight (Eric):** "The government often calls things funny names you don't
know, and bundles scopes together. My friend has a *building envelope* contract
that includes **leasing + cybersecurity**. How would a realtor or a cyber person
ever find that?"

---

## The problem

A single opportunity can contain multiple kinds of work, titled as none of them:

> "Building Envelope Services" → actually contains real-estate **leasing** +
> **cybersecurity** (continuous monitoring of building access/network controls) +
> construction.

Every filter we have fails on this, for a structural reason:

| Filter | Why it misses "building envelope = cyber" |
|--------|-------------------------------------------|
| **Title keyword** | Nobody searches "building envelope" expecting cyber work |
| **Description keyword** | Only works if the searcher guesses the funny name OR the exact word is in the (usually 94-char) cached blurb |
| **NAICS** | Coded as ONE thing (236220 construction *or* 531120 leasing) — the cyber facet is invisible |
| **PSC** | Gets one PSC, not three |

So the contract is **invisible to everyone who could do part of it** — the worst
discovery failure, because missing it = missing the work entirely. This is also
the **recompete** problem: the expiring predecessor may be worded nothing like how
you'd describe your own capability.

## The solution: semantic (embedding) matching on the FULL SOW

Match **meaning**, not words. Embed the user's capability AND each opportunity's
**full scope of work**, then surface opportunities whose meaning is close — even
when the words differ. A cyber contractor would surface a "building envelope...
continuous monitoring of network access controls" opp **without it ever saying
"cybersecurity" the way they'd phrase it.**

### Why semantic specifically (not more keywords)
Everything shipped in v1.0 made search *broader* (keyword-first, 3-digit prefix,
coverage) and *more accurate* (LLM industry labeling). But all assume the opp
describes itself in searchable terms. The funny-name case breaks that assumption —
only semantic matching on the real scope text cracks it.

---

## The hard constraint (feasibility, measured June 2026)

**The "cyber is in here" signal lives in the full SOW/attachments, NOT the cached
description.** Verified against live data:

- **33,205 active opps, all have a `description`** — BUT **median = 94 chars**
  (title-stub). Only **~5% are >200 chars** (rich enough to embed meaningfully).
- So **embedding the cached descriptions = ~95% noise** (embedding a title twice).
  *Do not ship semantic-over-stubs — it would be a 5%-effective feature.*
- The real scope is fetched on demand via **`/api/sam-description`** (cleans HTML,
  caps at `MAX_DESCRIPTION_LENGTH`) and lives in **attachments**.
- **Infra already exists:** `sam_opportunity_embeddings` + `opportunity_embeddings`
  tables (empty), pgvector + `get_rag_chunks` rpc, `src/lib/rag/`.

**Conclusion:** the expensive part isn't the embedding — it's **fetching + cleaning
the full SOW for 33K active opps** (rate-limited SAM calls). That's the build.

---

## The "in-between" workaround (Eric, #66) — do this FIRST

Don't process all 33K. **Target only the records that already have a scope
document.** Measured against live data:

- **~38% of active opps (~12,600) have attachments** (a doc to read). The other
  63% are stubs with nothing to fetch — no hidden scope to find anyway.
- The cache stores attachments as **opaque download URLs (no filename)** — BUT
  **fetching returns a `content-disposition` header with the real filename**:
  `filename=Performance+Work+Statement+Commercial+ISP.pdf`. So we **detect SOW/PWS
  by filename CHEAPLY** (from the HTTP header, often without extracting the PDF).
- **Measured hit-rate: 23% of FIRST-attachments are SOW/PWS/SOO/Specs by name** —
  and higher across all files (the SOW is often the 2nd/3rd doc in a bundle).

**Detection regex:** `/statement of work|performance work statement|\bSOW\b|\bPWS\b
|\bSOO\b|scope of work|combined synopsis|specifications?/i` against the filename.

**This is the affordable corpus:** ~12K not 33K, biased toward the records that
actually describe their scope (exactly where "building envelope = cyber" hides).
Cuts the rate-limited fetch work by ~62% vs the naive all-33K plan.

### Foundation build (ships value on its own — do before semantic)
1. **Schema** (hand-run SQL — no in-app DDL): add `has_sow_doc BOOLEAN`,
   `sow_doc_type TEXT` (sow|pws|soo|combined|specs), `sow_text TEXT`,
   `sow_checked_at TIMESTAMPTZ` to `sam_opportunities`.
2. **Resumable batch cron** (dispatcher `cron_jobs` row, same pattern as
   pursuit-changes): for active opps with attachments + `sow_checked_at IS NULL`,
   fetch attachment headers → detect SOW/PWS by filename → stamp `has_sow_doc` +
   `sow_doc_type`; for SOW/PWS hits, extract + cache `sow_text`. Soft time budget,
   `remaining` count, re-fires until drained. Respects SAM rate limits.
3. **Ships now: a "Has SOW/PWS" filter on the opportunity feed** — let users
   filter/sort to opps with a real scope document (the serious ones you can
   actually evaluate). Useful immediately, no semantic search required.

Then the embedding phases below run over `sow_text` (the clean ~12K corpus) instead
of 33K stubs.

---

## Build plan

### Phase 1 — Full-SOW corpus
- Background cron: for each active opp lacking full text, fetch via
  `/api/sam-description` (+ attachments where present), clean, store.
- Respect SAM rate limits (batch, resumable — same pattern as pursuit-changes).
- Only active + future-deadline opps (keep the corpus bounded).

### Phase 2 — Embeddings
- Embed each full-SOW doc (chunk if long) into `sam_opportunity_embeddings`
  (reuse the existing pgvector table + rpc).
- Provider: a cheap embedding model (text-embedding-3-small ≈ $0.02/1M tokens).
  33K × ~1K tokens ≈ 33M tokens ≈ **~$0.66 one-time**, then incremental on new opps.
- Re-embed only changed/new opps (cron, incremental).

### Phase 3 — Semantic match in the DAILY ALERTS feed (the headline)
- Embed each user's capability (from their `buildProfileFromText` profile +
  keywords + business description).
- Daily-alert pass: cosine-similarity the user vector against the opp vectors;
  surface high-similarity opps **that keyword/NAICS missed** — flagged as
  "💡 Hidden match: looks like your kind of work (titled '<funny name>')".
- Threshold tuned to avoid noise (this is the make-or-break — too low = spam,
  the exact deliverability risk from #58).

### Phase 4 — On-demand "find work like mine"
- A search box on ALL SAM: "describe what you do" → semantic results.
- Lower stakes than alerts; lets us tune the threshold before it drives sends.

### Phase 5 — RECOMPETE & FORECAST coverage (Eric: "did we include expiring + upcoming buys?")

Semantic search only works where there is **real scope text to embed**. The three
opportunity types differ structurally — measured June 2026 — so each gets the
honest treatment, not a forced weak version:

| Type | Scope text available | Semantic approach |
|------|---------------------|-------------------|
| **Active SAM opps** | ✅ Full SOW/PWS in attachments (the catalog, 6K–16K chars) | **Full semantic** — embed `sow_text`, match meaning. This is the core. |
| **Expiring / recompetes** | ❌ USASpending award = a **29–50 char transaction line** ("IT HELP DESK SUPPORT SERVICES"), NOT the original SOW | **Semantic kicks in at the FRESH solicitation.** When the recompete actually posts to SAM (sources-sought / RFI / RFP), it carries its own SOW → it's an active opp → it's already covered by the catalog. The *expiring predecessor itself* stays keyword/NAICS-matched (no embeddable scope). So a building-envelope recompete IS found semantically — once it's a live solicitation, not while it's still just an expiring award. |
| **Upcoming buys (forecasts)** | ❌ `agency_forecasts.description` = **~142 chars** (pre-solicitation stub; no SOW *exists* yet) | **Keyword/title match only**, by definition — there is no scope document before the solicitation drops. The forecast's value is the early *signal* ("this is coming"); semantic discovery of *what's hidden in it* isn't possible until the real RFP posts (at which point → active SAM → catalog). |

**The honest through-line:** the moment any opportunity has a real SOW, it's an
**active SAM opp**, and the catalog covers it. Recompetes and forecasts are
*earlier stages* of the same opportunity — they're matched by keyword/NAICS while
thin, then gain full semantic coverage the instant their solicitation (with a SOW)
posts. We do NOT fake scope text we don't have (same principle that killed
embedding the 94-char stubs).

**Optional enrichment (deferred, hard):** link an expiring contract's PIID back to
its *original* SAM solicitation's SOW so a recompete can be semantically matched on
real scope before the new RFP drops. Feasibility is poor — old solicitations are
often archived/purged and the PIID→original-notice link is unreliable. Investigate
only if recompete semantic-match proves high-value via the fresh-solicitation path
first.

---

## Open decisions for build time
- **Threshold tuning** — the deliverability line. Start conservative; measure
  helpful-rate (the #58 cap protects against over-sending either way).
- **Embed full SOW vs LLM scope-tags** — embeddings find fuzzy meaning; an LLM
  "what kinds of work is in this?" → `[leasing, cyber, construction]` is more
  precise but ~$0.0002/opp × 33K = ~$6 + slower. Could do embeddings for recall +
  LLM tags on the top-N for precision. Decide after Phase 1 corpus exists.
- **Cold-start** — semantic only works once the corpus is embedded; ship behind a
  flag, backfill, then enable.

## Why it's NOT in v1.0
Shipping semantic-over-the-94-char-stubs (the only cheap version) is a
5%-effective feature — worse than honest. The real version needs the full-SOW
pipeline, which is a multi-day data build that touches the core alert flow. Ship
it as the flagship v1.1 discovery feature, behind a flag, after the corpus exists.

*Grounds in the same principle as the whole v1.0 build: don't ship a plausible-but-
weak version; match the real scope, from real data.*
