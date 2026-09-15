# PATHWAY / TALENT — Product Gate (post-CAI)

**Status:** NEXT architecture window — **inventory first, no giant new tool.**
**Date:** 2026-09-15 (Eric)
**Prerequisite:** CAI v0 **FROZEN** (`docs/PRD-current-acquisition-intelligence-v0.md`). Do not polish CAI.

---

## Product question (the only one this gate answers)

> **Can Mindy already match a company's actual proof to the acquisition doors CAI has established, without falling back to “what set-aside are you?”**

If the answer is no after inventory — name the missing evidence class. Do **not** invent a door.

---

## Journey position

```
FIND → UNDERSTAND → CURRENT INTELLIGENCE → PATHWAY / TALENT → POSITION / ACT
```

CAI’s `_next` already points here: *which of these doors can my company actually walk through, and what proof should I lead with?*

**Morehouse order (locked):** **Pathways first** (*where the work can land*) → **Talent** (*what makes you the pick*). Talent is **evidence**, not marketing claims.

---

## Architecture posture

- **Not** another giant intelligence compose.
- **First:** inventory what Mindy **already knows** about (a) the company and (b) the **observed doors** CAI returned.
- **Then:** grounded match, or honest miss.

---

## Door match shapes (examples — must be earned)

| Door | Grounded match (example) | Failure mode to refuse |
|------|--------------------------|------------------------|
| **Vehicle / task-order** | Company does **not** hold the vehicle, but **verified** past performance fits the work → **teaming** route | Claiming “you’re on the vehicle” without hold evidence |
| **CSO** | CSO **verified on records** + company has **demonstrable** capability → **pitch / demo** route | Treating historical CSO language as future-buy certainty (CAI already forbids that) |
| **Set-aside** | **This** opportunity is actually restricted **and** verified status qualifies → socioeconomic route | Asking set-aside first; manufacturing eligibility |
| **No proven door** | Mindy has **not** established a viable path for this company | Manufacturing a pathway |

---

## Talent = evidence (deck principle)

Winning proof is specific and stranger-verifiable:

1. What did you do?
2. For whom?
3. What broke / what problem existed?
4. What measurable result did you produce?
5. How quickly?
6. Can a stranger verify it?

Do **not** accept capability slogans, NAICS lists, or set-aside labels as Talent.

---

## Inventory checklist (architecture pass — before any build)

For a real company + a CAI package with `pathways.observed`:

1. **Doors in hand** — which `pathways.observed` kinds are established (CSO, OT, conventional, IDV/task-order, set-aside, …)?
2. **Company proof already in Mindy** — vault / past performance / awards by UEI / certifications / capabilities library / proposal corpus — what is LIVE and verifiable?
3. **Matchability** — can any observed door be paired to that proof with citations?
4. **Gaps** — what evidence class is missing (vehicle hold, CSO capability demo, socioeconomic verification, stranger-verifiable result)?
5. **Set-aside discipline** — confirm the design never opens with “what set-aside are you?”

**Exit of inventory:** one of:

- **Build a thin matcher** (compose over existing company + CAI doors), or
- **STOP** and name the minimum evidence still required — no PATHWAY tool until that gap is closed.

---

## Inventory verdict (2026-09-15) — answer to the product question

> **Can Mindy already match a company's actual proof to the acquisition doors CAI has established, without falling back to “what set-aside are you?”**

### Short answer

**Partially — enough for a thin, honest matcher on some doors; not enough to claim full Morehouse Talent.**  
There is **no company→door compose today**. CAI establishes **buyer-scope doors only**. Company evidence exists in a **public vs vault split**. A PATHWAY surface that over-claims Talent (what broke / measurable result / speed / stranger-verifiable narrative) would fabricate.

### Doors Mindy can establish (CAI `pathways.observed`)

| Door | Establishable now? | Evidence |
|------|--------------------|----------|
| Conventional solicitation | Yes | SAM notice_type / solicitation labels |
| IDV / task-order / BPA language | Yes (text-weak) | Phrase match on SAM/recompete — **not** IDV API / vehicle family query |
| CSO | Yes | CSO language on scoped notices |
| Other transaction | Yes | OT/OTA language with guards |
| Set-aside | Yes | Explicit set-aside labels on scoped notices/awards |
| Consortium / rapid office / PAE / other | **No** | Always `potential_not_established` — do not invent |

### Company proof Mindy already has

| Talent question | Best existing source | Stranger-verifiable? |
|-----------------|----------------------|----------------------|
| What did you do? | BQ/USASpending award titles (+ thin descriptions); vault `scope_description` | Public titles **yes**; vault narrative **no** |
| For whom? | Award agencies / vault agency fields | Public **yes** |
| What broke? | **Nothing modeled** | — |
| Measurable result? | Vault `outcomes` / `cpars_rating` (rare, self-asserted) | **No** |
| How quickly? | Award/period dates only | **Weak** |
| Can a stranger verify? | UEI → `history-by-uei` / awards; SAM `recipient_certifications` (SBA vs self provenance) | **Yes** for obligations + certs |
| On a vehicle? | Appear as IDV recipient in search / parent IDV on an award; vault `contract_vehicles[]` | Portfolio-by-UEI **missing**; vault **unverified** |

Tools already adjacent (not a matcher): `get_contractor_award_history`, `lookup_sam_entity`, `search_idv_contracts`, `capability_market_match` (caller text, not vault auto-load), vault APIs.

### Matchability by door shape (without set-aside-first)

| Shape | Earnable with current evidence? | Honest route |
|-------|---------------------------------|--------------|
| **Set-aside door** | **Yes** when CAI observes restriction on *this* scope **and** SAM-backed certs qualify (honor self vs SBA provenance) | Socioeconomic route — **never** the opener |
| **Vehicle / task-order door** | **Partial** — can support “past awards fit this work → teaming” from public awards; **cannot** reliably assert “you hold vehicle X” | Teaming / fit route; refuse vehicle-hold claims without UEI-on-vehicle proof |
| **CSO door** | **Partial** — CSO on records + related public award/capability profile → “demonstrable related work”; **no** stored demo/pitch artifact | Pitch/demo *candidate*; not “you win CSOs” |
| **Full Talent (Morehouse 6 questions)** | **No** | Missing: what broke, verified outcomes, speed, stranger-verifiable narrative |
| **No proven door** | Always available | Required default when unmatched |

### Exit decision

1. **Do not ship** a PATHWAY tool that claims full Talent or vehicle membership portfolios.
2. **Thin matcher is justified** if and only if it:
   - Inputs: CAI `pathways.observed` + company UEI (public proof primary; vault optional and labeled owner-asserted).
   - Outputs: per-door **fit / teaming / socioeconomic / no proven door** with citations.
   - Talent block: **only** stranger-verifiable award + SAM cert facts — empty when thin.
   - Never opens with set-aside; set-aside only when that door is observed on the opportunity/scope.
3. **Minimum evidence still required** before claiming full PATHWAY/TALENT: (a) UEI→vehicles-held index or equivalent, (b) stranger-verifiable outcome/“what broke”/speed fields or an explicit “Talent incomplete” class that blocks over-claim.

**Status after inventory:** gate answered — **thin matcher allowed; full Morehouse Talent blocked until evidence classes exist.**

---

## Explicit non-goals (this gate)

- No CAI polishing or new CAI sources.
- No new consortium / rapid / PAE ingestion “because PATHWAY needs it.”
- No set-aside-first qualification flow.
- No LLM-invented doors or unverifiable talent claims.

---

## Acceptance (when a PATHWAY surface eventually ships)

Host package must:

1. Start from CAI `pathways.observed` (or honest empty).
2. Lead with pathway fit, then talent evidence.
3. Emit **no proven door** when unmatched — never manufacture.
4. Never close with set-aside-first when doors are non-socioeconomic.
