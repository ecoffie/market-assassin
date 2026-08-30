# Morehouse Ascend regression fixture — provenance

## Sources

| Artifact | Location | Status |
|----------|----------|--------|
| **participants.json** | `Participants List_MIEC Ascend National 26-27 for Facilitators.xlsx` (Google Drive) | **32 companies, SHA256 pinned** |
| **Expected outcomes** | Eric's 32-company `capability_market_match` bug report (2026-08-30) | **Authoritative — no room-profile.md** |
| **room-profile.md §D/§F** | — | **Not used; not searched further** |

## Expectation levels (all 32 companies covered)

| Level | Count | Meaning |
|-------|-------|---------|
| **exact_expected** | 8 | Preserve documented capability anchor (no exact NAICS asserted) |
| **behavioral_expected** | 24 | Reject documented bad anchors; SAM/award corroboration or low/unverified confidence |
| **pending_exact_label** | 0 | Reserved for future exact market labels when evidence exists but NAICS not yet adjudicated |

`pending_exact_label` does **not** mean untested — every case enforces forbidden anchors, grounding semantics, and metadata visibility.

## Baseline (pre-fix, production `0f3708c3`)

**23 wrong**, **2 no market**, **7 correct** — wrong cases often returned `grounded:true`.

## Policy

- **Do not invent NAICS or market verdicts.**
- Behavioral cases must either corroborate via SAM/award evidence or return `anchor_confidence: low|unverified` with `_meta.grounded: false`.
- Competitors must never use company-name substring matching (tested at tool source level).
- **All identity/SAM/award rows in `evidence-fixtures.json` are SYNTHETIC.** Unique UEIs follow `SYNTH0 + 3-letter token + 3-digit sequence` and match `isWellFormedUei` (`/^[A-Za-z0-9]{12}$/`). They are not SAM registrations. A malformed or wrong-length identifier cannot elevate confidence.
- The BMA regression scenario may be marked `corrected` under that synthetic evidence. That is **not** a claim that the live Business Management Associates, Inc. identity or NAICS were verified.
