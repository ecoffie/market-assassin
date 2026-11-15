# Rubric addendum: Eric's scope rulings (2026-11-14, final for this cycle)

These apply to every human and AI label from today, including the holdout, the calibration and any re-scoring. Read them before `INSTRUCTIONS_service.md` /
`INSTRUCTIONS_product.md`.

1. **Repair is not supply.** For a business that only sells parts or products, a notice to repair, overhaul or return items to Ready-For-Issue condition
   (DLA "IN REPAIR/MODIFICATION OF", "This is an EAF REPAIR requirement", "Articles … shall be repaired") is **not relevant**. It is relevant only when the business says it repairs that kind of item.
2. **Pharmaceuticals are their own line.** A generic medical, dental or laboratory supply business does not sell drugs, biologicals or FSC 6505 items. Those are relevant only
   when the business explicitly offers pharmaceutical products.
3. **Restrictions never change relevance.** Approved-source, QPL, brand-name, OEM-only and sole-source conditions are recorded separately.
4. **Human review choices** (holdout sheet): Direct match · Related opportunity (an explicit, real component or subcontract scope of a larger buy) · Not relevant ·
   Insufficient information, plus an optional explanation. Relevant = Direct + Related.

## Adjudications made under ruling 1 (AI labels kept; these override them in scoring)

| Item | Business | Notice | AI labels | Adjudicated | The notice's own text |
|---|---|---|---|---|---|
| r5-0206 | replacement parts | VALVE,SOLENOID `5bf74eea…` | FIT / FIT | **NO** | "This is an EAF REPAIR requirement for the items listed in this solicitation" |
| r5-0254 | replacement parts | MOTOR, HYDRAULIC `bd914bbb…` | FIT / FIT | **NO** | "This is an EAF REPAIR requirement for the items listed in this solicitation" |
| r6-0070 | aircraft components | FUEL CELL,AFT SPONS `df2e38fa…` | FIT / FIT | **NO** | "Articles to be furnished hereunder shall be repaired, tested and inspected" |

Raised by Agent 3's repair detector and confirmed by Agent 4 against the notice text. Machine-readable copy: `adjudications.json`. Effect on v5/v6: parts and aircraft
relevant counts drop by 1–2 rows; no conclusion changes.
