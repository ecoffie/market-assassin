# Generalization test — three untouched companies, blind (2026-08-25)

Run after CHAIN-3 merged, purely to see whether the architecture holds beyond the two
fixtures it was built on. **Nothing was tuned for these companies.**

## Result

| company | shape | awards | pursuits | universal checks |
|---|---|---:|---:|---|
| ATLANTIC DIVING SUPPLY | mid-size DLA supplier | 19 | 3 | **4/4 pass** |
| CENTRAL KENWORTH | GSA vehicle dealer | 161 | **0** | 4/4 pass |
| BOOZ ALLEN HAMILTON | prime | **0** | 0 | 4/4 pass |

**The safety properties held everywhere** — no mail code as a customer, every pursuit cited
evidence, no "adjacent" pursuit without demonstrated history, no certification claimed
without affirming evidence. **Atlantic Diving Supply worked end to end on the first try**,
with no tuning: real customers, real incumbents to compete against, evidence on every row.

Two GAPS surfaced. Neither produces a WRONG answer — both produce a THIN one, silently.

## GAP-A · non-DoDAAC vehicles are invisible to customer attribution

CENTRAL KENWORTH: 161 awards, $38.4M, every customer labelled **"Unattributed"**.

Its PIIDs are GSA schedule numbers — `47QMCA22F0CJK`. The prefix `47QMCA` fails the
DoDAAC pattern `/^[A-Z][A-Z0-9]{5}$/` because it starts with a digit, so NS-3 never
attempted attribution.

**The evidence was there the whole time:** `dodaac_directory` resolves `47QMCA` to
**GSA/FAS AUTOMOTIVE CENTER**, and the notices carry a Washington address. The identifier
shape check — not the data — is what blocked it.

Consequence: a company doing all its work through GSA vehicles gets "Unattributed"
customers and **zero pursuits**, because NS-2 anchoring also keys on the same prefix.

**Fix direction:** widen the identifier pattern to admit GSA/civilian vehicle prefixes
rather than assuming DoD DoDAAC shape. `dodaac_directory` already holds them.

## GAP-B · identity resolves to a UEI the award mirror does not use

BOOZ ALLEN HAMILTON: 0 awards found, though the mirror holds **398 rows** for it.

`sam_entities` returns `UAVDK5WWYDZ5` / `Z8TSAM5UZJ79` / `Z9M6EDQF86W8` (three registered
entities under that name). Every award row credits **`JCBMLGPE6Z71`** — a UEI that is not
any of them. The join is `incumbent_uei = entity.uei`, so it finds nothing.

This is a genuine identity problem, not a lookup bug: large firms register many entities,
and USASpending credits a parent recipient the SAM record does not match.

⚠️ **The failure is SILENT and reads as fact.** The chain reported "0 awards" and CHAIN-3
correctly refused to recommend — but the refusal says *"no award history was established"*
when the truth is *"we hold 398 awards and could not link them to this UEI."* Those are
different claims, and the second is the honest one.

**Fix direction:** when a UEI join returns zero, attempt a name-based reconciliation and
report the result as a distinct state — `unlinked_history` — rather than absence. Same
shape as CHAIN-2's existence invariant, one layer up.

## Assessment

The architecture generalizes. Both gaps are **reachability**, not correctness: no company
in this test received a fabricated or misattributed recommendation, and the refusal path
behaved as designed. Both are also the same class the sprint has been closing — evidence
that exists but never reaches the decision layer — which suggests the class is now
well-understood rather than newly discovered.

Neither is a regression. Both are filed, not fixed, per the decision to move into
regression hardening.
