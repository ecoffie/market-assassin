# RFP Format + Failure-Mode Analysis (empirical)

_Generated from 488 real RFP bodies. Validates docs/RFP-STRUCTURE-BASELINE.md._

## (A) Structure signals

Sampled **488** real RFP bodies (sam_opportunities + uploaded pursuit docs).

- `has_section_C_sow`: 336 (69%)
- `rfq_quote`: 141 (29%)
- `far_12_commercial`: 139 (28%)
- `is_idiq_macc`: 109 (22%)
- `rfp_proposal`: 104 (21%)
- `far_13_simplified`: 62 (13%)
- `far_15_negotiated`: 46 (9%)
- `uses_volumes`: 31 (6%)
- `has_section_L`: 10 (2%)
- `has_section_M`: 10 (2%)

**Headline:** explicit Section L **and** M (full UCF): 6 (1%) · commercial/FAR-12/RFQ signals: 173 (35%) · uses a volume scheme: 31 (6%)

## (B) Failure-mode gates (ranked by frequency)

The strict requirements that DQ a proposal when missed. The scanner (#11) checks a draft against these.

- **Explicit submission deadline**: appears in 217 (44%) of RFPs
- **Specific submission method/portal**: appears in 176 (36%) of RFPs
- **Set-aside eligibility gate**: appears in 129 (26%) of RFPs
- **Past performance required**: appears in 101 (21%) of RFPs
- **Reps & certs / SAM registration**: appears in 100 (20%) of RFPs
- **FAR 52.212-1 (commercial instructions)**: appears in 85 (17%) of RFPs
- **Safety / APP required**: appears in 77 (16%) of RFPs
- **Quality Control Plan required**: appears in 71 (15%) of RFPs
- **Bonding required**: appears in 60 (12%) of RFPs
- **Page limit imposed**: appears in 12 (2%) of RFPs
- **Amendment acknowledgment required**: appears in 7 (1%) of RFPs
- **Price must be a separate volume**: appears in 0 (0%) of RFPs

## Machine-readable summary

```json
{
  "total": 488,
  "structure": {
    "has_section_C_sow": 336,
    "rfq_quote": 141,
    "far_12_commercial": 139,
    "is_idiq_macc": 109,
    "rfp_proposal": 104,
    "far_13_simplified": 62,
    "far_15_negotiated": 46,
    "uses_volumes": 31,
    "has_section_L": 10,
    "has_section_M": 10
  },
  "gates": {
    "deadline": 217,
    "submission_method": 176,
    "set_aside": 129,
    "past_perf_req": 101,
    "reps_certs": 100,
    "far_52_212_1": 85,
    "required_safety": 77,
    "required_qcp": 71,
    "bonding": 60,
    "page_limit": 12,
    "amendment_ack": 7,
    "separate_price": 0
  },
  "classification": {
    "ucf_full_LM": 6,
    "commercial_or_rfq": 173,
    "uses_volumes": 31
  }
}
```
---

## ⚠️ Reliability note (honest caveat)

**Structure classification = trustworthy.** "Section L"/"Section M"/FAR-12/IDIQ are
unambiguous labels; the headline finding is solid:

> **Only ~1% of real RFPs are full UCF (explicit Section L AND M). ~35% show
> commercial/FAR-12/RFQ signals; only ~6% use a volume scheme.** Most "normal RFPs"
> are short commercial buys with a SOW (69%) and no formal L/M/volume structure.

**Gate frequencies = directional, not exact.** A spot-check showed the strict gate
regexes UNDERCOUNT:
- Page-limit language: strict regex 2% → broad check **~34%** (10% in the heavy
  uploaded solicitations, where page limits actually live — not in short synopses).
- Separate price/cost volume: strict regex 0% → broad price+volume context **~68%**.

So the gate *ranking* is roughly right (deadline / submission method / set-aside /
SAM dominate the short commercial buys), but the **scanner (#11) must NOT rely on
these rough regexes for the actual check** — it should reuse the compliance-
extraction engine (which already pulls page limits, deadlines, required plans as
structured requirements) and check the draft against THAT. This analysis sizes the
problem and proves the structure thesis; the scanner does the precise per-RFP work.

## Decision for the template (#10)

- **DEFAULT to the LIGHT commercial response**, not a multi-volume L/M proposal —
  the data says ~99% of RFPs aren't full UCF. A short response: cover/quote +
  brief technical approach to the SOW + past performance (if asked) + SAM/reps
  confirmation + the SOW-derived line items.
- **Escalate to the heavy UCF volume structure ONLY when L/M signals are present**
  (reuse buildProposalStructure #5 in that branch). Detect via the structure
  signals above.
- The IDIQ/MACC template already covers the ~22% IDIQ slice.
