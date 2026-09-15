# PATHWAY FIT v0 — Design Contract

**Status:** DESIGN ONLY — no code, no PR, no ingestion.  
**Date:** 2026-09-15  
**Prerequisite:** Evidence gate complete — `docs/PRD-pathway-talent-gate.md`  
**Upstream:** CAI v0 **FROZEN** — `docs/PRD-current-acquisition-intelligence-v0.md`  
**Journey slot:** `FIND → UNDERSTAND → CURRENT INTELLIGENCE → PATHWAY FIT → later TALENT / POSITION / ACT`

---

## 0. What this is / is not

| This is | This is not |
|---------|-------------|
| Which acquisition **doors** have **two-sided** evidence worth pursuing | “Can this company **win**?” |
| Honest thin matcher over CAI doors + stranger-verifiable company record | Full Morehouse Talent |
| `SUPPORTED_FIT` / `POSSIBLE_FIT` / `NOT_ESTABLISHED` / `NOT_APPLICABLE` | Opaque AI win-probability |
| Customer language about doors + proof | Forcing customers to know IDV / CSO / OT / NAICS / set-aside jargon |

**Do not pretend** Mindy has enough evidence for full Talent. Expose gaps as `proof_missing`.

---

## 1. Recommended tool name

**`match_company_to_pathways`**

| Alternative | Why not preferred |
|-------------|-------------------|
| `pathway_fit` | Too product-y; less verb-clear for hosts |
| `get_pathway_fit` | Fine; less parallel with `match_*` intent |
| `qualify_for_doors` | Sounds like win/eligibility qualification — wrong frame |

**Credits (provisional, not locked):** 8 — same band as CAI (compose over existing reads; revisit after host packaging).

**Host-facing language (never expose tool name):**

> Want me to figure out which of these doors your company can actually walk through and what proof you should lead with?

Wire as CAI `_next.tool` once implemented (today CAI `_next` is confirmation-only).

---

## 2. Exact input schema

```ts
type MatchCompanyToPathwaysInput = {
  /** Preferred company key — 12-char UEI. */
  uei?: string;
  /** Fallback when UEI unknown; resolver must return a single UEI or honest miss. */
  company_name?: string;
  /** Optional CAGE if UEI missing (resolve → UEI or miss). */
  cage?: string;

  /**
   * Preferred: pass the CAI package (or a slim extract) so the user does not
   * re-enter doors. At minimum must carry pathways.observed + pathways.potential_not_established
   * + buyer/capability scope + citations.
   */
  cai?: CaiPackageSlim;

  /**
   * Alternative when host still holds CAI context by reference (future):
   * opaque package id — v0 may omit until storage exists.
   */
  cai_package_id?: string;

  /** Buyer / market scope if cai omitted (discouraged — prefer cai). */
  agency?: string;
  office?: string;
  capability?: string;
  keywords?: string[];
  naics?: string[];
  psc?: string[];

  /** Optional anchors from FIND / CAI. */
  notice_ids?: string[];
  contract_ids?: string[];
  piids?: string[];

  /**
   * Owner-asserted vault may be *displayed* separately when email/session known.
   * MUST NOT upgrade determination unless independently verified.
   * Default: ignore vault for determinations.
   */
  include_owner_asserted?: boolean; // default false
};

type CaiPackageSlim = {
  scope: {
    agency: string;
    office?: string | null;
    capability: string;
    naics?: string[];
    psc?: string[];
    keywords?: string[];
  };
  pathways: {
    observed: Array<{
      kind: PathwayDoorKind;
      established: true;
      statement: string;
      citations: EvidenceCitation[];
      evidence_count?: number;
    }>;
    potential_not_established: Array<{
      kind: PathwayDoorKind;
      reason?: string;
    }>;
  };
  /** Optional: notice/contract anchors already in CAI. */
  anchors?: {
    notice_ids?: string[];
    contract_ids?: string[];
    piids?: string[];
  };
};

type PathwayDoorKind =
  | 'conventional_solicitation'
  | 'idv_task_order'
  | 'cso'
  | 'other_transaction'
  | 'set_aside'
  | 'consortium'
  | 'rapid_acquisition_office'
  | 'pae_portfolio'
  | 'other_mechanism';
```

### Input rules

1. **Require** (`uei` **or** resolvable `company_name`/`cage`) **and** (`cai` **or** enough scope to refuse with “pass CAI package”).
2. Prefer **`cai` required in v0** — if absent, return `_meta.grounded: false` + error `cai_context_required` (do not re-derive buyer doors by re-running CAI inside this tool unless explicitly allowed later).
3. Do **not** ask the user to re-list IDV/CSO/OT/set-aside labels CAI already established.
4. Name→UEI ambiguity → `NOT_ESTABLISHED` company side for all doors + `_next` ask for UEI (no best-guess).

---

## 3. Exact output schema

```ts
type MatchCompanyToPathwaysResult = {
  company: {
    uei: string | null;
    legal_name: string | null;
    cage: string | null;
    identity_source: 'sam_entity' | 'bq_recipient' | 'unresolved';
    /** SAM business types / certs with provenance — never alone a pathway. */
    certifications: CertFact[];
  };

  buyer_context: {
    agency: string;
    office: string | null;
    capability: string;
    cai_as_of: string | null;
    observed_door_kinds: PathwayDoorKind[];
    not_yet_measurable_kinds: PathwayDoorKind[];
  };

  doors: PathwayDoorFit[];

  summary: {
    /** Customer-safe. */
    headline: string;
    /**
     * Load-bearing: true when zero SUPPORTED_FIT and zero POSSIBLE_FIT.
     * Empty positive doors is SUCCESS, not failure.
     */
    no_proven_door: boolean;
    supported_count: number;
    possible_count: number;
    not_established_count: number;
    not_applicable_count: number;
  };

  /**
   * Owner-asserted vault snippets if include_owner_asserted — labeled, never
   * used to upgrade determination in v0.
   */
  owner_asserted_context?: {
    shown: boolean;
    items: OwnerAssertedItem[];
    disclaimer: string; // fixed copy
  };

  _meta: {
    grounded: boolean;
    degraded: boolean;
    journey: 'pathway_fit';
    epistemic_note: string; // e.g. "two_sided_evidence_required; talent_forbidden_v0"
    sources_queried: string[];
    sources_failed: string[];
    ranking_rule_version: 'pf_rank_v1';
    next_outputs_not_yet: string[]; // includes talent_fit, win_claim, vehicle_portfolio, ...
  };

  _next: Array<{
    prompt: string; // single best missing-proof question
    requires_confirmation: boolean;
    tool?: string; // omit until a follow-on tool exists
  }>;

  presentation: {
    host_rules: string[];
    sections: {
      doors: { display_title: string; provenance_label: string };
      proof: { display_title: string; provenance_label: string };
      missing: { display_title: string; provenance_label: string };
    };
  };
};

type PathwayDoorFit = {
  door: PathwayDoorKind;
  /** Host display label — plain language, not jargon-first. */
  door_label: string;

  determination:
    | 'SUPPORTED_FIT'
    | 'POSSIBLE_FIT'
    | 'NOT_ESTABLISHED'
    | 'NOT_APPLICABLE';

  buyer_evidence: EvidenceItem[];
  company_evidence: EvidenceItem[];

  /** Null when not positive. Never “you will win.” */
  why_this_fit: string | null;

  /** Only stranger-verifiable. */
  proof_to_lead_with: ProofLeadItem[];

  proof_missing: ProofMissingItem[];

  additional_advantages: AdditionalAdvantage[];

  /**
   * Safe next actions bounded by evidence — e.g. "investigate teaming",
   * "confirm vehicle membership", "ask for demo artifact". Never "submit a bid."
   */
  safe_next_actions: string[];

  /** Deterministic rank key components (for debug + tests). */
  rank: {
    score: number; // derived from rule — transparent
    components: RankComponents;
  };
};

type EvidenceItem = {
  evidence_class:
    | 'government_public'
    | 'mindy_derived'
    | 'owner_asserted'
    | 'playbook_strategy'; // allowed in interpretation notes only — never as establishing fact
  role: 'buyer_side' | 'company_side' | 'context';
  source_kind: string; // sam_opportunities | recompete_opportunities | recipient_certifications | usaspending_awards | sam_entity | ...
  source_id: string | null;
  locator: string;
  as_of: string | null;
  retrieved_at?: string | null;
  statement: string;
  /** e.g. sba | self | unknown — for certs */
  provenance_state?: string | null;
  authoritative?: boolean;
};

type ProofLeadItem = {
  kind: 'award' | 'certification' | 'entity' | 'notice' | 'other_public';
  label: string; // customer-safe
  piid?: string | null;
  customer?: string | null;
  work_description?: string | null;
  obligation?: number | null;
  period?: string | null;
  naics?: string | null;
  psc?: string | null;
  why_related: string;
  citations: EvidenceItem[];
};

type ProofMissingItem = {
  code: ProofMissingCode;
  statement: string; // customer-safe
  blocks_upgrade_to?: 'SUPPORTED_FIT' | 'POSSIBLE_FIT' | null;
};

type ProofMissingCode =
  | 'vehicle_access_unverified'
  | 'demonstrable_product_unestablished'
  | 'measurable_outcome_unavailable'
  | 'delivery_speed_unavailable'
  | 'cso_topic_fit_weak'
  | 'socioeconomic_restriction_absent'
  | 'cert_self_identified_not_authoritative'
  | 'past_performance_weak_or_distant'
  | 'ot_nontraditional_status_unestablished'
  | 'buyer_door_not_observed'
  | 'company_identity_unresolved'
  | 'capability_relation_unestablished'
  | 'cai_door_not_yet_measurable'
  | 'other';

type AdditionalAdvantage = {
  kind: 'certification' | 'geography' | 'other_public';
  statement: string;
  /** Explicit: not why this pathway was selected. */
  not_the_pathway_reason: true;
  citations: EvidenceItem[];
};

type CertFact = {
  code: string; // e.g. SDVOSB
  label: string;
  provenance_state: 'sba' | 'self' | 'vetcert' | 'unknown';
  citations: EvidenceItem[];
};

type RankComponents = {
  buyer_certainty: 0 | 1 | 2; // 0 none, 1 observed weak, 2 observed strong
  company_capability: 0 | 1 | 2;
  access_evidence: 0 | 1 | 2; // vehicle hold / OT status / etc.
  recency_relevance: 0 | 1 | 2;
  missing_penalty: number; // subtract
  set_aside_opener_penalty: 0 | 5; // applied when set_aside would otherwise sort first without being sole door
};
```

### Determination meanings

| Determination | Meaning |
|---------------|---------|
| `SUPPORTED_FIT` | Two-sided evidence; access/status where required is **verified** for that door |
| `POSSIBLE_FIT` | Two-sided relevance exists; critical access/readiness **missing** — pursue with caveats |
| `NOT_ESTABLISHED` | Missing buyer side, company side, or CAI said not measurable — **do not infer** |
| `NOT_APPLICABLE` | Door not in play for this package (e.g. set-aside when no restriction observed — certs become advantages only) |

### Killer rule (unit-testable)

> A door may be `SUPPORTED_FIT` or `POSSIBLE_FIT` **only if** `buyer_evidence.length ≥ 1` **and** `company_evidence.length ≥ 1`, and every item in those arrays has `evidence_class` in `{government_public, mindy_derived}` with `mindy_derived` limited to **deterministic joins** (e.g. NAICS overlap flag) — never playbook or vault.

Removing either side → determination must fall to `NOT_ESTABLISHED` or `NOT_APPLICABLE`.

---

## 4. Door-specific decision matrix

| Door | Buyer prerequisite | Company prerequisite | Max if access/readiness missing | Forbidden claims |
|------|--------------------|----------------------|----------------------------------|------------------|
| `set_aside` | CAI observed socioeconomic **restriction on this scope** | SAM cert matching restriction + provenance | `SUPPORTED_FIT` only if provenance adequate for that program; else `POSSIBLE_FIT` with `cert_self_identified_not_authoritative` | Cert alone; set-aside as automatic opener |
| `idv_task_order` | CAI observed vehicle/TO/BPA pathway language | Related public award history (capability relation) | **`POSSIBLE_FIT`** if vehicle hold **unverified** (default v0) | “You can bid this vehicle”; “you hold SEWP/…” without citation |
| `cso` | CAI observed CSO | Related public work | **`POSSIBLE_FIT`** without demonstrable product/prototype | Prototype readiness invented |
| `other_transaction` | CAI observed OT | Related awards **plus** nontraditional (or other OT eligibility) if claimable | `POSSIBLE_FIT` max without nontraditional; else `NOT_ESTABLISHED` company side | Infer nontraditional from size |
| `conventional_solicitation` | CAI observed conventional path | Related federal performance | `SUPPORTED_FIT` possible on strong relation; still no win claim | “You will win the RFP” |
| `consortium` / `rapid_acquisition_office` / `pae_portfolio` / `other_mechanism` | CAI `potential_not_established` / NYM | — | **`NOT_ESTABLISHED` only** | Playbook fill; promote from general knowledge |

### Host labels (examples)

| Kind | `door_label` |
|------|----------------|
| `conventional_solicitation` | Open competition / posted solicitation path |
| `idv_task_order` | Existing contract vehicle / task-order path |
| `cso` | Commercial solutions / pitch-and-demo path |
| `other_transaction` | Other-transaction research path |
| `set_aside` | Socioeconomic-restricted path |

---

## 5. Evidence-strength model

Per door, compute transparent components (ints 0–2), then score (see §6).

### Buyer certainty (`buyer_certainty`)

| Level | Rule |
|-------|------|
| 0 | Door not in `pathways.observed` |
| 1 | Observed but thin (e.g. single weak keyword hit / low evidence_count) |
| 2 | Observed with ≥1 solid citation (notice id / field locator) and statement from CAI |

CAI already established the door — PATHWAY FIT **does not re-litigate** CSO phrase rules; it **consumes** CAI citations. If CAI listed the door as observed, floor = 1; bump to 2 when `evidence_count ≥ 2` or citation has concrete `source_id`.

### Company capability (`company_capability`)

| Level | Rule |
|-------|------|
| 0 | No awards/entity relation to capability/buyer NAICS-PSC-keyword scope |
| 1 | ≥1 public award with weak overlap (shared 3-digit NAICS / loose keyword) |
| 2 | ≥1 public award with strong overlap (6-digit NAICS or PSC match, or title/description token overlap with capability) **and** within recency window (default: action/end within **5 years**, configurable constant) |

**Obligation $ is never a quality score** — may appear in proof_to_lead_with as magnitude only.

### Access evidence (`access_evidence`)

| Door | 0 | 1 | 2 |
|------|---|---|---|
| idv_task_order | No vehicle hold proof | Ambiguous (appears on some IDV row without clear hold) | Verified public hold for **named** vehicle relevant to buyer evidence |
| set_aside | No matching cert | Self-identified match | SBA/VetCert (or documented authoritative) match |
| cso | No related work | Related awards only | *(v0: level 2 blocked — no demonstrable product store)* → max 1 |
| other_transaction | No OT-relevant status | Partial | Established nontraditional / OT eligibility from public source |
| conventional | N/A access — use 2 if capability ≥1 else 0 | — | Treat access as N/A → set `access_evidence = company_capability > 0 ? 2 : 0` for ranking only |

### Recency / relevance (`recency_relevance`)

| Level | Rule |
|-------|------|
| 0 | No dated awards or all older than window |
| 1 | Some awards in window, weak topical match |
| 2 | Strong topical match and in window |

### Missing penalty

Sum weights for active `proof_missing` codes that block upgrade (see §8): e.g. `vehicle_access_unverified` = 2, `demonstrable_product_unestablished` = 2, `past_performance_weak_or_distant` = 3, etc. (table in implementation constants — deterministic).

---

## 6. Deterministic ranking

**Rule version:** `pf_rank_v1`

```
score =
  10 * buyer_certainty
+ 10 * company_capability
+  8 * access_evidence
+  5 * recency_relevance
-  missing_penalty
-  set_aside_opener_penalty
```

**Sort:** `score` desc, then door kind priority for ties:

1. `idv_task_order`
2. `cso`
3. `conventional_solicitation`
4. `other_transaction`
5. `set_aside`  ← **never** automatic opener
6. NYM kinds (always `NOT_ESTABLISHED`, sorted last)

**`set_aside_opener_penalty` = 5** when:

- `set_aside` would sort above any `SUPPORTED_FIT`/`POSSIBLE_FIT` non-set-aside door, **or**
- multiple positive doors exist and set-aside is not the only positive door  

Purpose: certifications cannot crowd out vehicle/CSO/conventional when those are also positive.

Only doors with `SUPPORTED_FIT` or `POSSIBLE_FIT` appear in the “doors I can support” host list; `NOT_ESTABLISHED` / `NOT_APPLICABLE` follow under “not established yet.”

**No opaque LLM score.**

---

## 7. `proof_to_lead_with` rules

Include **only** stranger-verifiable items (`government_public` / verified SAM). Prefer:

1. Specific award: PIID / generated id, customer, title/description snippet, period, NAICS/PSC  
2. Why related: one sentence tying award → buyer capability/door  
3. Cert **only** when set-aside door is positive **or** as `additional_advantages` (not as pathway proof for vehicle/CSO)

**Forbidden in proof_to_lead_with:**

- Vault outcomes / CPARS / “we saved $X”  
- Playbook claims  
- Obligation amount as “performance quality”  
- “Ready to demo” without public artifact  

Max **3** lead items per door (deterministic: strongest capability + most recent + best customer match).

---

## 8. `proof_missing` rules

Every door returns ≥0 missing items; positive doors **must** list what blocks upgrade when not `SUPPORTED_FIT`.

| Situation | Code |
|-----------|------|
| Vehicle path + awards, no hold | `vehicle_access_unverified` |
| CSO + awards, no demo/product proof | `demonstrable_product_unestablished` |
| Talent questions unanswered | `measurable_outcome_unavailable`, `delivery_speed_unavailable` |
| Weak topical link | `cso_topic_fit_weak` / `capability_relation_unestablished` / `past_performance_weak_or_distant` |
| Cert without buyer restriction | door = `NOT_APPLICABLE`; missing on set-aside = `socioeconomic_restriction_absent` |
| Self cert on restricted buy | `cert_self_identified_not_authoritative` |
| OT without nontraditional | `ot_nontraditional_status_unestablished` |
| CAI NYM door | `cai_door_not_yet_measurable` |
| No CAI observed door for kind | `buyer_door_not_observed` |
| Name unresolved | `company_identity_unresolved` |

`proof_missing` **drives** `_next` (see §10).

---

## 9. `additional_advantages` rules

- Emit when company has SAM certs / other public advantages **that are not** the reason a non-set-aside door was selected.  
- Always set `not_the_pathway_reason: true`.  
- Example copy:

> Your SAM record shows SDVOSB status (provenance: …). That matters if this acquisition is restricted or the buyer chooses that route; it is not why the teaming pathway is listed.

- If the **only** positive door is set-aside, certs live in `company_evidence` / `proof_to_lead_with`, not as “additional.”  
- Never invent advantages from playbook.

---

## 10. `_next` policy

Exactly **one** primary `_next` prompt (array length 1 in v0).

| Priority (first match wins) | Ask for |
|----------------------------|---------|
| `company_identity_unresolved` | UEI |
| Any `POSSIBLE_FIT` with `vehicle_access_unverified` as top missing | Vehicle membership (name families from buyer evidence if known — still user-confirm) |
| Any `POSSIBLE_FIT` with `demonstrable_product_unestablished` | Working product / demo |
| `ot_nontraditional_status_unestablished` | Nontraditional / OT eligibility fact |
| `measurable_outcome_unavailable` on strongest door | Measurable outcome on a cited award |
| `no_proven_door` | Single highest-leverage proof given observed doors (usually vehicle **or** demo **or** UEI) |

**Never** a generic company questionnaire.  
**Never** “What’s your set-aside?” as opener when other doors exist.  
`requires_confirmation: true` until a follow-on tool exists.

Example prompts:

- “I can verify similar federal work, but I can’t verify vehicle access. Are you currently on a relevant vehicle for this buyer (for example SEWP, MAS, or another IDV named in the opportunity)?”  
- “Your federal record supports the capability, but I can’t establish that you have a working product you can demonstrate. Do you?”  
- “I can see the award, but not the result. What measurable outcome did your team produce on [PIID/customer]?”

---

## 11. Red-team test plan

Hermetic unit tests (fixtures; no live network required for logic):

| # | Fixture | Assert |
|---|---------|--------|
| 1 | Company SDVOSB (SBA); CAI observed doors **without** set-aside | set-aside = `NOT_APPLICABLE` or `NOT_ESTABLISHED`; **no** positive set-aside fit; cert may appear under `additional_advantages` only |
| 2 | CAI `idv_task_order` observed; company awards related; **no** vehicle hold | `POSSIBLE_FIT`; `proof_missing` includes `vehicle_access_unverified`; why_this_fit mentions teaming; **not** SUPPORTED |
| 3 | CAI `cso` observed; related awards; no demo artifact | `POSSIBLE_FIT`; `demonstrable_product_unestablished` |
| 4 | CAI lists `pae_portfolio` only under potential/NYM | door = `NOT_ESTABLISHED`; `cai_door_not_yet_measurable`; no promotion |
| 5 | Strong company awards; `pathways.observed = []` | all positive forbidden; `no_proven_door: true` |
| 6 | CAI multiple observed doors; company no relevant awards | `no_proven_door: true`; doors NOT_ESTABLISHED on company side |
| 7 | Vault outcome “saved $2M”; public awards thin | determination **unchanged** when `include_owner_asserted: true`; vault only in `owner_asserted_context` |
| 8 | Start from SUPPORTED/POSSIBLE fixture; strip `buyer_evidence` **or** `company_evidence` | determination becomes NOT_ESTABLISHED/NOT_APPLICABLE (killer rule) |

Additional:

| # | Assert |
|---|--------|
| 9 | Ranking: conventional POSSIBLE + set-aside POSSIBLE → conventional sorts above set-aside (`set_aside_opener_penalty`) |
| 10 | Playbook text never appears as `evidence_class: government_public` |
| 11 | Output must not contain banned phrases: “you will win”, “qualified to win”, “they will pick you”, “you can bid this vehicle” (without verified hold) |

---

## 12. Three blind acceptance probes

Host packages (after implementation) — natural language; no tool-name hints.

| Probe | Setup | Expected character |
|-------|--------|-------------------|
| **A** | SOCOM + cybersecurity CAI package + **real UEI** with cyber/IT federal award history | May yield `POSSIBLE_FIT` on CSO and/or idv/conventional if CAI observed those; teaming language if vehicle unverified; **not** full Talent; `_next` asks for vehicle or demo as appropriate |
| **B** | VA + IT CAI package + company with relevant history **and** certification | Set-aside positive **only if** CAI observed restriction; else cert as additional advantage; IT conventional/vehicle possible fits |
| **C** | Construction buyer CAI + company with related construction awards | Prefer conventional / idv fits; **at least one of A/B/C** (design intent: **C or a weak-A variant**) must legitimately return **`no_proven_door: true`** or zero `SUPPORTED_FIT` — e.g. use a UEI with **unrelated** NAICS against SOCOM cyber to force empty positive doors |

**Auto-fail:** invents PAE/consortium; set-aside-first closer; upgrades vault; claims vehicle bid rights; claims “why they’ll pick you.”

---

## 13. What remains blocked for full Morehouse Talent

Do **not** ship as established in PATHWAY FIT v0:

| Talent element | Status |
|----------------|--------|
| What broke / problem before arrival | No model |
| Measurable outcome / result | Vault only, unverified |
| Delivery speed | Dates ≠ speed |
| Cost savings caused by company | Forbidden |
| Outcome repeatability | Forbidden |
| Complete vehicles-held portfolio | Missing index |
| Demonstrable prototype / commercial readiness | No artifact store |
| Customer references / vouches | Forbidden |
| “Why they will pick you” / “qualified to win” | Forbidden |

These appear only as `proof_missing` and `_meta.next_outputs_not_yet` (e.g. `talent_fit`, `win_claim`, `vehicle_portfolio`, `demo_readiness`).

---

## 14. Smallest implementation sequence

**No ingestion. Reuse existing libs.**

1. **Contract + fixtures** — this doc; red-team fixture JSON for tests 1–8.  
2. **Pure matcher lib** — `matchCompanyToPathways(input) → result`  
   - Consume `cai.pathways`  
   - Resolve UEI (`sam` / recipients)  
   - Load public awards (`history-by-uei` / awards-by-uei) + certs (`recipient_certifications` / entity)  
   - Optional: parent IDV on awards only as **hold signal** when clearly tied — never invent portfolio  
   - Apply door matrix + killer rule + rank v1  
3. **Unit tests** — red-team table (§11) hermetic.  
4. **MCP wrapper** — `match_company_to_pathways` + registry/server/schemas/catalog (same commit pattern as CAI).  
5. **Wire CAI `_next.tool`** → this tool (confirmation prompt unchanged).  
6. **Host probe** — blind A/B/C; freeze language with `presentation.host_rules`.  
7. **STOP** — no Talent engine; no consortium ingest; no vault upgrade path.

### Host rules (ship on result.presentation)

```
- Every positive fit needs buyer_evidence AND company_evidence — never one-sided.
- Empty / no_proven_door is success — do not invent a door.
- Never claim win, pick, or vehicle bid rights without verified access evidence.
- Set-aside is never the automatic opener when other doors exist.
- Do not promote CAI NOT_YET_MEASURABLE doors (consortium, rapid, PAE).
- proof_to_lead_with = stranger-verifiable only; vault is labeled owner-asserted and does not upgrade.
- Ask one _next question from proof_missing — not a questionnaire, not set-aside-first.
- Customer need not know IDV/CSO/OT/NAICS jargon — use door_label language.
```

---

## Provenance lanes (reminder)

| Lane | May establish fit facts? |
|------|---------------------------|
| Government / public evidence | **Yes** |
| Mindy derived (deterministic join/flag) | **Yes**, narrowly; cite inputs |
| Owner-asserted company data | **Display only** in v0 |
| GovCon Giants playbook / strategy | **Interpretation only** — never a cited establishing fact |

---

## Explicit non-goals (v0)

- Full Morehouse Talent  
- New scrapers / consortium / rapid / PAE tables  
- Win probability / “bid this” authority  
- Replacing CAI or re-deriving buyer doors from playbook  
- Set-aside-first qualification UX  
- LLM narration of facts (optional phrasing later; determinations stay deterministic)

---

**STOP.** Design contract complete. No code until explicitly authorized.
