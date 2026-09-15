# Current Acquisition Intelligence v0 — Tool Contract

**Status:** SHIPPED via PR #1539. Compose-only. **No scrapers.** Fresh-host acceptance pending (catalog proof first).
**Provisional tool name:** `get_current_acquisition_intelligence`
**Credits (provisional):** 8 (between UNDERSTAND 5 and FIND 10 — revisit after host packages)
**Journey slot:** `FIND → UNDERSTAND → CURRENT INTELLIGENCE → PATHWAY → POSITION`
**Date:** 2026-09-15

---

## 1. Product question (the only one this tool answers)

> Given a **buyer + capability** (and optional opportunity/contract context):
> **What changed about how this customer is buying, and what should I do differently because of it?**

Not: news. Not: generic GovCon advice. Not: pathway recommendation. Not: set-aside-first qualification.

---

## 2. Killer rule (hard constraint — unit-testable)

> **No `do_differently` recommendation may ship without a cited `caused_by` pointer to either:**
> 1. an **OBSERVED CHANGE** item id, or
> 2. a **current-state fact** item id in `what_we_are_seeing_now` that is itself LIVE/GROUNDED.

If the pointer is missing, empty, or points at curated/static pain — **drop the recommendation** (do not soften into generic advice).

Same rule for `what_that_may_mean` (SUPPORTED IMPLICATION): every implication cites ≥1 OBSERVED CHANGE or LIVE current-state fact.

---

## 3. Epistemic classes (every claim is exactly one)

| Class | Meaning | Host language |
|-------|---------|---------------|
| **OBSERVED_CHANGE** | Grounded **delta** in Mindy live data inside the window | “What changed” |
| **CURRENT_STATE** | Grounded **as-of-now** concentration / distribution from live tables | “What we’re seeing now” |
| **SUPPORTED_IMPLICATION** | Interpretation **explicitly caused by** cited OBSERVED_CHANGE or CURRENT_STATE ids | “What that may mean” |
| **DO_DIFFERENTLY** | Action suggestion **only** if `caused_by` cites allowed ids | “What you should do differently” |
| **NOT_YET_MEASURABLE** | Pathway / ownership / change Mindy **cannot establish** from live evidence | “What Mindy cannot establish yet” |

**Forbidden class:** “playbook knowledge,” “typical SOCOM behavior,” curated pain-as-change, Federal Register passthrough (not persisted), set-aside as strategy center without notice evidence.

---

## 4. Inputs

```ts
export interface CurrentAcquisitionIntelligenceInput {
  /** Buying organization — required unless resolvable from notice_id / contract_id. */
  agency?: string | null;

  /** Optional office / DoDAAC when known (narrows concentration + contacts). */
  office?: string | null;
  dodaac?: string | null;

  /**
   * Capability / market scope — required in some form.
   * Prefer keywords (discovery key). NAICS/PSC optional refinements.
   */
  capability?: string | null;
  keywords?: string[] | null;
  naics?: string[] | null;
  psc?: string[] | null;

  /** Optional anchors from FIND / UNDERSTAND / recompete surfaces. */
  notice_ids?: string[] | null;
  contract_ids?: string[] | null;       // recompete_opportunities.contract_id
  piids?: string[] | null;

  /** Lookback for OBSERVED_CHANGE. Default 90 days. Cap 365. */
  window_days?: number | null;
}
```

### Input validation rules

1. Must resolve a **buyer scope**: `agency` OR notice/contract that yields department/sub_tier.
2. Must resolve a **capability scope**: non-empty `capability` / `keywords` / `naics` / `psc`, OR notice_ids whose titles/descriptions supply tokens (same spirit as UNDERSTAND `statedFocusFromText`).
3. If neither buyer nor capability can be resolved → `grounded:false`, empty sections, honest note — **do not invent SOCOM cyber**.
4. `window_days` default **90**, clamp `[7, 365]`.

---

## 5. Output contract

```ts
export type CaiEpistemicClass =
  | 'observed_change'
  | 'current_state'
  | 'supported_implication'
  | 'do_differently'
  | 'not_yet_measurable';

export type CaiSourceKind =
  | 'recompete_changes'
  | 'recompete_opportunities'
  | 'sam_opportunities'
  | 'agency_forecasts'
  | 'usaspending_spend'
  | 'idv_search'
  | 'federal_contacts'
  | 'dodaac_directory'
  | 'sam_events'
  | 'pursuit_change_log'; // only if caller-linked pursuits exist — never invent

export interface CaiCitation {
  source_kind: CaiSourceKind;
  /** Stable id when available (contract_id, notice_id, change row id, etc.). */
  source_id: string | null;
  /** Human-checkable pointer (table + key, or USASpending URL). */
  locator: string;
  as_of: string | null; // ISO date
}

export interface CaiItem {
  id: string; // stable within response, e.g. "chg_01", "see_02", "imp_01", "act_01", "nym_01"
  epistemic: CaiEpistemicClass;
  /** Host-facing sentence — customer language, not GovCon jargon dump. */
  statement: string;
  citations: CaiCitation[]; // OBSERVED_CHANGE / CURRENT_STATE: ≥1. Implications/actions: via caused_by
  /** Required for supported_implication and do_differently. */
  caused_by?: string[]; // CaiItem ids
  /** Optional magnitude when measured (counts, $). Never fabricate. */
  magnitude?: {
    label: string;
    value: number | null;
    unit: 'count' | 'usd' | 'percent' | 'days' | 'other';
    unknown?: boolean;
  } | null;
}

export type ObservedPathwayKind =
  | 'conventional_solicitation' // FAR-style SAM notice with established notice_type
  | 'idv_task_order'            // IDV / BPA / task order evidence
  | 'cso'                       // only when notice text/type explicitly establishes CSO
  | 'other_transaction'         // only when phrase/type explicitly establishes OT/OTA
  | 'set_aside';                 // only when notice/award carries an explicit set-aside code/label

export type PotentialPathwayKind =
  | 'consortium'
  | 'rapid_acquisition_office'
  | 'pae_portfolio'
  | 'other_mechanism';

export interface ObservedPathway {
  kind: ObservedPathwayKind;
  /** Must be true only when citations establish it for THIS scope. */
  established: true;
  statement: string;
  citations: CaiCitation[];
  /** How many scoped rows support this pathway — for host weight, not ranking. */
  evidence_count: number;
}

export interface PotentialPathwayNotEstablished {
  kind: PotentialPathwayKind;
  established: false;
  statement: string; // "I cannot yet establish whether …"
}

export interface CurrentAcquisitionIntelligenceResult {
  scope: {
    agency: string | null;
    office: string | null;
    dodaac: string | null;
    capability_label: string | null;
    keywords: string[];
    naics: string[];
    psc: string[];
    notice_ids: string[];
    contract_ids: string[];
    window_days: number;
    window_start: string; // ISO
    window_end: string;   // ISO
  };

  presentation: {
    sections: {
      what_changed: { display_title: string; provenance_label: string };
      what_we_are_seeing_now: { display_title: string; provenance_label: string };
      what_that_may_mean: { display_title: string; provenance_label: string };
      do_differently: { display_title: string; provenance_label: string };
      not_yet_measurable: { display_title: string; provenance_label: string };
      pathways: { display_title: string; provenance_label: string };
    };
    host_rules: string[];
  };

  what_changed: CaiItem[];           // epistemic: observed_change only
  what_we_are_seeing_now: CaiItem[]; // epistemic: current_state only
  what_that_may_mean: CaiItem[];     // epistemic: supported_implication only
  do_differently: CaiItem[];         // epistemic: do_differently only
  not_yet_measurable: CaiItem[];     // epistemic: not_yet_measurable only

  pathways: {
    observed: ObservedPathway[];
    potential_not_established: PotentialPathwayNotEstablished[];
  };

  _next: Array<{
    prompt: string;
    requires_confirmation: boolean;
    tool?: string;
    credits?: number;
  }>;

  _meta: {
    grounded: boolean;          // ≥1 OBSERVED_CHANGE or CURRENT_STATE with citations
    degraded: boolean;          // upstream read error (distinct from empty)
    journey: 'current_intelligence';
    epistemic_counts: Record<CaiEpistemicClass, number>;
    sources_queried: CaiSourceKind[];
    sources_failed: CaiSourceKind[];
    next_outputs_not_yet: [
      'pathway_recommendation',
      'talent_fit',
      'capability_statement',
      'response',
      'meeting_brief',
    ];
  };
}
```

### Fixed host titles (do not paraphrase into “actually cares” / “should bid”)

| Section | `display_title` | `provenance_label` |
|---------|-----------------|--------------------|
| what_changed | What changed | Observed deltas in Mindy’s live data for this buyer + capability |
| what_we_are_seeing_now | What we’re seeing now | Current concentration from live opportunities, recompetes, spend, vehicles |
| what_that_may_mean | What that may mean | Supported implications — each tied to a cited change or current-state fact |
| do_differently | What you should do differently | Actions only when caused by a cited change or current-state fact |
| not_yet_measurable | What Mindy cannot establish yet | Gaps — including acquisition pathways without explicit evidence |
| pathways | Acquisition pathways (evidence only) | Observed = explicitly established in records; potential = not established |

### Required `host_rules` (ship verbatim)

1. Present sections under `presentation.sections.*.display_title` — never reframe curated research as buyer intent.
2. Never invent a pathway (CSO, OT, consortium, rapid office, PAE) without an `pathways.observed` entry.
3. Never center strategy on set-aside unless `pathways.observed` includes `set_aside` with citations for this scope.
4. Every “do differently” line must mention what caused it (host should echo `caused_by`).
5. Empty `what_changed` is honest — do not fill with pain points or playbook.
6. After this package, ask the capability/door question — do **not** ask set-aside-first.

---

## 6. v0 data sources (LIVE only — compose, no new ingest)

| Allowed | Use for | Disallowed in v0 |
|---------|---------|------------------|
| `recompete_changes` | OBSERVED_CHANGE (POP end, ceiling, incumbent UEI) | — |
| `recompete_opportunities` | CURRENT_STATE (expiring in window, office/NAICS concentration) | Treat `recompete_likelihood` as implication only if labeled inference — prefer raw POP dates |
| `sam_opportunities` | CURRENT_STATE (open notices by office/notice_type); pathway observe | No fabricated pop_state; use pop OR office state rule |
| `agency_forecasts` | CURRENT_STATE (upcoming buys in scope) | Empty ≠ no demand — declare coverage limit in NYM if zero |
| USASpending spend-query / category | CURRENT_STATE (where $ concentrated) | Do not use stale budget-authority JSON as OBSERVED_CHANGE |
| `search_idv_contracts` / IDV fields | CURRENT_STATE + pathway `idv_task_order` | — |
| `federal_contacts` / `dodaac_directory` | CURRENT_STATE (which offices appear) | Do not claim PM/end-user ownership |
| `sam_events` | CURRENT_STATE (upcoming industry days in scope) | Past-heavy table — filter to upcoming only |
| `pursuit_change_log` | OBSERVED_CHANGE **only if** notice is in input `notice_ids` and user-linked — else skip | Never scan unrelated pursuits |

**Explicitly out of v0 reads:** `agency-pain-points.json`, budget JSON as change, Federal Register MCP (unpersisted), institute GAO pilot as buyer-fact, SBLO static roster as “what changed,” podcast playbook.

---

## 7. Pathway evidence rules (classification, not scrape)

### Observed (may only emit when evidence establishes)

| Kind | Establishment test (all must pass) |
|------|-----------------------------------|
| `conventional_solicitation` | ≥1 scoped open/active SAM notice with a standard notice type (solicitation, combined, etc.) — not solely Special Notice keyword fishing |
| `idv_task_order` | ≥1 IDV/BPA/task-order row in scope (USASpending IDV search or notice typed as TO/BPA call) |
| `cso` | Title/description/notice_type **explicitly** contains Commercial Solutions Opening / CSO as acquisition method — not “commercial” alone |
| `other_transaction` | Explicit “other transaction” / OTA / OT agreement language — **not** bare token `OTA` (keyword sanitizer rule) |
| `set_aside` | Non-null set-aside code/label on notice or award in scope |

### Potential — not established (always list when not observed)

Always include these in `potential_not_established` when no observed evidence exists for that kind:

- `consortium`
- `rapid_acquisition_office`
- `pae_portfolio`
- `other_mechanism` (catch-all for untyped innovation pathways)

**Statement template:**

> I cannot yet establish whether {agency} intends to use a {kind label} for this {capability} requirement from Mindy’s live records.

Do **not** omit the gap to look smarter. Exposing the gap is the product.

---

## 8. Compose algorithm (v0 — deterministic, no LLM for facts)

1. **Resolve scope** (agency, capability tokens, window).
2. **Query LIVE sources** in parallel; record `sources_failed` without fabricating zeros (`count` null → unknown / omit magnitude).
3. **Build `what_changed`** from `recompete_changes` (+ optional pursuit changes) filtered to scope tokens / NAICS / agency / ids. Cap 8 items, ranked by recency then magnitude.
4. **Build `what_we_are_seeing_now`** from concentrations:
   - top offices by open opp count / recompete count in scope
   - top vehicles / IDV families if any
   - spend concentration (agency/subagency) for capability NAICS set
   - forecast count in scope (with coverage caveat)
   Cap 8 items.
5. **Classify pathways** per §7.
6. **Derive implications** only from templates tied to change/state ids, e.g.:
   - If ≥N recompetes enter final 12 months → implication “replacement window opening”
   - If open demand concentrates at office X → implication “office-level positioning > department-level”
   Cap 5. Drop any implication that fails `caused_by`.
7. **Derive do_differently** from the same ids, e.g.:
   - “Engage these offices/contracts now rather than waiting for a new solicitation” **only if** recompete CURRENT_STATE or CHANGE cited
   Cap 5. **Empty is allowed and preferred over generic BD advice.**
8. **Fill `not_yet_measurable`**: pathway potentials + known structural gaps (PM ownership, CSO/OT if not observed, forecast agency coverage if zero rows, pop_state sparsity if location claimed).
9. **`_next`:** single confirmation prompt toward PATHWAY / capability door — **not** set-aside-first.

### `_next` prompt (locked)

```
Here's what changed around this market from Mindy's live records — and what I cannot yet establish about acquisition pathways.
Before I tell you how to position, let's determine which door the evidence says is actually open to you.
What capability can you deliver for this mission today, and what have you already done that proves it?
```

(`requires_confirmation: true`; no `tool` until PATHWAY ships.)

---

## 9. Example shape (SOCOM + cybersecurity) — illustrative, not fixtures

**what_changed (OBSERVED_CHANGE)**  
“Three relevant contracts in scope moved into their final 12 months.” → citations: `recompete_opportunities` / POP dates; magnitude count=3.

**what_we_are_seeing_now (CURRENT_STATE)**  
“Most current open demand in scope is concentrated at these offices / vehicles.” → citations: `sam_opportunities` by office + IDV rows.

**what_that_may_mean (SUPPORTED_IMPLICATION)**  
“This increases the importance of positioning before a replacement requirement posts.” → `caused_by: ["chg_01"]`.

**do_differently (DO_DIFFERENTLY)**  
“Start with these buyers/contracts now rather than waiting for a solicitation.” → `caused_by: ["chg_01","see_01"]`.

**not_yet_measurable**  
“I cannot yet establish whether SOCOM intends to use a CSO, OT, consortium, rapid-acquisition pathway, or conventional FAR vehicle for this requirement beyond what appears in the observed pathway list.”

**pathways.observed** — only kinds that pass §7.  
**pathways.potential_not_established** — consortium, rapid, PAE, etc.

---

## 10. Acceptance probes (before merge — host packages)

Same agent/host discipline as FIND/UNDERSTAND. **HOLD until PASS on all three:**

| Probe | Scope | Must show |
|-------|-------|-----------|
| A | USSOCOM + cybersecurity (+ any FIND notice ids if available) | Gaps for CSO/OT/rapid/consortium **named**; no set-aside-first `_next`; no do_differently without `caused_by` |
| B | VA + IT / health IT | Live spend/recompete/opp concentration; implications cite facts |
| C | Construction market (e.g. 236220 or “horizontal construction”) | Different concentration shape; still refuses unobserved pathways |

**Auto-fail if host says:** “What’s your set-aside?” as the closer; “SOCOM actually cares about…” from pain JSON; invents DIU/SOFWERX/consortium as strategy without observed evidence; emits do_differently with empty `caused_by`.

---

## 11. Explicit non-goals (v0)

- No new scrapers or tables for consortia / rapid orgs / PAE / legislation.
- No PATHWAY recommendation engine.
- No TALENT / capability-fit scoring.
- No capability statement / RFI / meeting draft.
- No LLM narration of facts (optional later for phrasing only; facts remain deterministic).
- No reading pain-points JSON as OBSERVED_CHANGE.
- No merging into UNDERSTAND — separate tool, separate credit, separate `_meta.journey`.

---

## 12. Implementation sketch (for the next PR — not this design doc)

| Piece | Location (proposed) |
|-------|---------------------|
| Compose lib | `src/lib/opportunities/current-acquisition-intelligence.ts` |
| Unit tests | killer rule + pathway establishment + empty do_differently |
| MCP wrapper | `src/mcp/tools/current-acquisition-intelligence.ts` |
| Registry | `tool-registry.ts` + `server.ts` + catalog surfaces (same commit) |
| Credits | `TOOL_CREDITS` provisional 8 |
| Journey docs | CLAUDE in-flight sequencing update |

**Ship gate:** unit tests for killer rule; three host packages; HOLD until PASS — same as #1537.

---

## 13. What this unlocks next

Once v0 host packages run on SOCOM cyber / VA IT / construction, the **empty `not_yet_measurable` + `potential_not_established` lines** tell us which pathway data is worth adding — instead of ingesting consortia/rapid/PAE because they sound useful.
