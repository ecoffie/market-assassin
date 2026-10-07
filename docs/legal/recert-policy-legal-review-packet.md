# Recertification review policy: legal review packet

> **DRAFT FOR COUNSEL. NOT LEGALLY REVIEWED.**
> Policy status: `NOT_REVIEWED_BY_COUNSEL`. No rule in this packet has been reviewed or approved by qualified counsel.
> Each rule is an engineering transcription of primary text (eCFR / Federal Register / acquisition.gov, verified 2026-10-07).
> The engine outputs review flags. It does not output legal determinations.

- Policy version: `recert-policy/2026-10-07.1`
- Generated: 2026-10-07T09:04:57.797Z from `src/lib/diligence/recert/policy.ts` and a review of the Halvik regression fixture (UEI VMRTJLWMQRH7, as of 2026-01-21, all deal facts unknown). **Do not hand-edit**: change the policy and regenerate.
- Code: PR #1861 (held for this review; not merged; no production use).

**Primary sources:**
- 13 CFR 125.12: eCFR versions 2025-01-16 and 2025-06-04; no later version through 2026-10-01.
- 89 FR 102448 (Dec 17, 2024). DATES: "This rule is effective on January 16, 2025."
- 90 FR 23609 (Jun 4, 2025), Correction. Redesignated 125.12(g)(i),(ii) as (g)(1),(2). No other change to 125.12.
- 13 CFR 124.515: current text since the 2023-05-30 eCFR version.
- 13 CFR 124.105(i); 121.404(c)(4), (i); 126.619; 127.504; 128.401.
- FAR 52.219-28 (JAN 2025) and FAR 19.301-2 (FAC 2026-01). Supporting only.

## Part A — Questions for counsel (unresolved; the engine does not answer them)

### Q1. Does 13 CFR 125.12(e)(2)(iii)(B) make a concern ineligible to receive options on an ORDER already awarded under a multiple award contract that is set aside or reserved for small business, or does it reach only options on the multiple award contract itself?

- **Governing text:** 125.12(e)(2)(iii)(B): "For a multiple award contract that is set-aside or reserved for small business, a concern that submits a disqualifying recertification … following a merger, acquisition, or sale involving a business entity that does not itself qualify as small under the NAICS code assigned to the multiple award contract is ineligible to receive options." 125.12(a)(3): "Recertification does not change the terms and conditions of the award."
- **What the engine does now:** R7 has no branch. Every order under a set-aside MAC that has unexercised option value is reported NEEDS_REVIEW, DEPENDS_ON this question, with no outcome offered.
- **Halvik instruments that depend on it:** 25 (public obligated $164,590,543, public ceiling $290,384,701). PIIDs: 1333BJ24F00000001, 1333BJ24F00000002, 1333BJ24F00280002, 1333BJ24F00280005, 1333BJ24F00280017, 1333BJ24F00280020, 1333BJ24F00281005, 1333BJ24F00284004, 19AQMM22F3950, 6913G621F600036, 6913G625F60021N, 693JJ321F000085, 693JJ321F000103, 693JJ321F000226, 693JJ322F00429N, 693JJ323F00075N, 693JJ325F00115N, 693JJ424F00005N, 693JJ921F000035, 693JJ924F00015N, 693JK425F96004N, 693JK425F96015N, 693JK425F96031N, HS002124F0062, W9124D25F0044
- **Requested answer:** a written position, with authority, that can be encoded as a new branch of R7 in a new policy version.

### Q2. For a transaction that occurred before January 17, 2026, does 13 CFR 125.12(g)(1) ("remains eligible for orders issued under an underlying small business multiple award contract") reach set-aside orders under an UNRESTRICTED multiple award contract (including GSA Schedule), or only orders under a small business MAC?

- **Governing text:** 125.12(g)(1): "A firm that has a disqualifying size or status recertification due to a merger, acquisition or sale that occurs prior to January 17, 2026 remains eligible for orders issued under an underlying small business multiple award contract. However, the agency cannot count any new or pending orders … towards its small business and socioeconomic goals. This includes set-asides, partial set-asides, and reserves …"
- **What the engine does now:** R8's pre-threshold, other-than-small branch is NEEDS_REVIEW and DEPENDS_ON this question. The branch can never resolve, because an interpretation can only be added by a new policy version.
- **Halvik instruments that depend on it:** 2 (public obligated $108,486,956, public ceiling $132,063,717). PIIDs: H9240421F0077, N0016421F3025
- **Requested answer:** a written position, with authority, that can be encoded as a new branch of R8 in a new policy version.

## Part B — Engine choices for counsel to confirm or correct

These are not open interpretations in the engine. They are classification choices the engine makes from FPDS fields. Each one needs confirmation.

1. Vehicles whose FPDS ordering-period end date is before the as-of date are treated as closed. They are excluded from the future-order and option rules (R5, R6). Existing orders under them stay in scope.
2. "Restricted" vs "unrestricted" for a MAC is read from the FPDS set-aside field on the vehicle (IDV) record held by the target.
3. Multiple-award BPAs, GWACs and GSA Schedules are treated as "multiple award contracts" for 125.12(e). The GSA Schedule treatment relies on 121.404(c)(4)(i) and (i).
4. R1 applies to an award when the CO recorded SMALL BUSINESS on the latest action by the as-of date, or a set-aside code is on the award.
5. 124.515 (R13) is applied when an 8(a) set-aside code is on the award or its parent vehicle, whatever the holder's current 8(a) status. 124.105(i)(1) refers to a "Participant or former Participant that is performing one or more 8(a) contracts."
6. The acquirer-size question (T3) is posed against the NAICS code on the MAC's own FPDS record.
7. The 125.12(g)(2) protection for options is modeled as one fact covering two things: a disqualifying recertification before the end of year five of a long-term contract, and options exercised before 2026-01-17.
8. "Long-term" means the period of performance including options exceeds five years, measured from the FPDS start date to the potential end date.
9. FAR 52.219-28 and FAR 19.301-2 are supporting text only. The engine cites 125.12 for SBA eligibility and goaling, and notes the difference in goaling wording ("cannot count" vs "may no longer include").

## Part C — The 15 rules

### R1. Recertification trigger after a merger, acquisition or sale

_Legal review status: NOT_REVIEWED_BY_COUNSEL_

| Element | Content |
|---|---|
| Authority | [13 CFR 125.12(a)](https://www.ecfr.gov/current/title-13/section-125.12); [13 CFR 125.12(a)(1)](https://www.ecfr.gov/current/title-13/section-125.12); [FAR 52.219-28(b)(1)-(2) (JAN 2025)](https://www.acquisition.gov/far/52.219-28) |
| Effective period | from 2025-01-16 (no end). Basis: 89 FR 102448 DATES: effective January 16, 2025; eCFR shows no later substantive version through 2026-10-01 |
| Mechanic | Recertification of size and small business program status is required within 30 calendar days of a merger, acquisition, or sale of or by a concern or an affiliate of the concern, which results in a change in controlling interest. |
| Applicable instruments | All instrument types. Only when: award received as a small business or program participant (CO size = SMALL BUSINESS, or a set-aside code on the award) |
| Trigger facts | `T1_change_of_controlling_interest` — Did the transaction result in a change in controlling interest of the awardee (or an affiliate)? |
| Required facts | `T1_change_of_controlling_interest` — Did the transaction result in a change in controlling interest of the awardee (or an affiliate)? |
| Permitted wording | "Recertification within 30 calendar days is required by 125.12(a)." |
| Prohibited wording | "must recertify (stated as a finding without T1 established)"<br>plus every global prohibition in Part D |

**Possible outcomes**

| When | Status | Review flag (exact wording) | Citation |
|---|---|---|---|
| T1_change_of_controlling_interest = yes | FLAG | Recertification within 30 calendar days is required by 125.12(a). | 13 CFR 125.12(a) |
| T1_change_of_controlling_interest = no | NO_FLAG | No change in controlling interest established; 125.12(a) trigger not met. | 13 CFR 125.12(a) |

**Halvik impact** (as of 2026-01-21, all deal facts unknown; public federal values; overlaps other rules)

- NEEDS_REVIEW: 38 instruments (29 awards, 9 vehicles); awards: public obligated $488,038,886, public ceiling $662,723,838, ceiling not yet obligated $174,684,952

**Halvik example: `80TECH22FA001`** (Order already awarded under a set-aside multiple-award contract)

- FEDERAL FACT: set-aside on award 8A COMPETED; parent 47QRAD20D8115 (set-aside 8A COMPETED); MAC NAICS 541330; CO size SMALL BUSINESS; public obligated $114,250,000, public ceiling $148,756,175
- REGULATORY FACT: 13 CFR 125.12(a); 13 CFR 125.12(a)(1); FAR 52.219-28(b)(1)-(2) (JAN 2025)
- REVIEW FLAG: **NEEDS_REVIEW** · DEPENDS_ON `T1_change_of_controlling_interest`
  - possible: T1_change_of_controlling_interest=yes → FLAG: "Recertification within 30 calendar days is required by 125.12(a)."
  - possible: T1_change_of_controlling_interest=no → NO_FLAG: "No change in controlling interest established; 125.12(a) trigger not met."

### R2. Existing award terms after recertification

_Legal review status: NOT_REVIEWED_BY_COUNSEL_

| Element | Content |
|---|---|
| Authority | [13 CFR 125.12(a)(3)](https://www.ecfr.gov/current/title-13/section-125.12) |
| Effective period | from 2025-01-16 (no end). Basis: 89 FR 102448 DATES: effective January 16, 2025; eCFR shows no later substantive version through 2026-10-01 |
| Mechanic | Recertification does not change the terms and conditions of the award. Limitations on subcontracting, non-manufacturer and subcontracting plan requirements in effect at award remain in effect. |
| Applicable instruments | All instrument types |
| Trigger facts | — |
| Required facts | — |
| Permitted wording | "Existing award terms are unchanged by recertification (125.12(a)(3))." |
| Prohibited wording | "the award ends"<br>"the award is cancelled"<br>plus every global prohibition in Part D |

**Possible outcomes:** informational only. No flag is produced.

**Halvik impact** (as of 2026-01-21, all deal facts unknown; public federal values; overlaps other rules)

- INFORMATIONAL: 46 instruments (46 awards, 0 vehicles); awards: public obligated $547,168,054, public ceiling $795,503,576, ceiling not yet obligated $248,335,523

**Halvik example: `80TECH22FA001`** (Order already awarded under a set-aside multiple-award contract)

- FEDERAL FACT: set-aside on award 8A COMPETED; parent 47QRAD20D8115 (set-aside 8A COMPETED); MAC NAICS 541330; CO size SMALL BUSINESS; public obligated $114,250,000, public ceiling $148,756,175
- REGULATORY FACT: 13 CFR 125.12(a)(3)
- REVIEW FLAG: **INFORMATIONAL** · "Existing award terms are unchanged by recertification (125.12(a)(3))."

### R3. Single-award small business set-aside or reserve (and orders under it)

_Legal review status: NOT_REVIEWED_BY_COUNSEL_

| Element | Content |
|---|---|
| Authority | [13 CFR 125.12(e)(2)(ii)(B)(1)](https://www.ecfr.gov/current/title-13/section-125.12); [13 CFR 125.12(e)(2)(iii)(A)](https://www.ecfr.gov/current/title-13/section-125.12) |
| Effective period | from 2025-01-16 (no end). Basis: 89 FR 102448 DATES: effective January 16, 2025; eCFR shows no later substantive version through 2026-10-01 |
| Mechanic | After a disqualifying recertification the concern remains eligible for orders issued under a single award small business contract and remains eligible to receive options; the agency cannot count the order or option period toward small business goals. |
| Applicable instruments | Standalone contract set aside for small business; Order under a single-award small business set-aside contract; Vehicle held: single-award contract set aside for small business |
| Trigger facts | `T1_change_of_controlling_interest` — Did the transaction result in a change in controlling interest of the awardee (or an affiliate)? |
| Required facts | `T1_change_of_controlling_interest` — Did the transaction result in a change in controlling interest of the awardee (or an affiliate)?<br>`T4_recertification_outcome` — Was the recertification for this award qualifying or disqualifying? |
| Permitted wording | "Eligibility for orders and options is retained under the rule; the agency cannot count them toward small business goals." |
| Prohibited wording | "value at risk"<br>"lost"<br>plus every global prohibition in Part D |

**Possible outcomes**

| When | Status | Review flag (exact wording) | Citation |
|---|---|---|---|
| T1_change_of_controlling_interest = no | NO_FLAG | No recertification trigger established. | 13 CFR 125.12(a) |
| T1_change_of_controlling_interest = yes<br>T4_recertification_outcome = qualifying | NO_FLAG | Qualifying recertification: eligibility continues (125.12(e)(1)). | 13 CFR 125.12(e)(1) |
| T1_change_of_controlling_interest = yes<br>T4_recertification_outcome = disqualifying | FLAG | Eligibility for orders and options is retained under the rule; the agency cannot count them toward small business goals. | 13 CFR 125.12(e)(2)(ii)(B)(1); (e)(2)(iii)(A) |

**Halvik impact** (as of 2026-01-21, all deal facts unknown; public federal values; overlaps other rules)

- NEEDS_REVIEW: 1 instruments (1 awards, 0 vehicles); awards: public obligated $2,979,363, public ceiling $3,896,110, ceiling not yet obligated $916,747

**Halvik example: `1333BJ23C00281002`** (Standalone contract set aside for small business)

- FEDERAL FACT: set-aside on award 8(A) SOLE SOURCE; parent none; MAC NAICS n/a; CO size SMALL BUSINESS; public obligated $2,979,363, public ceiling $3,896,110
- REGULATORY FACT: 13 CFR 125.12(e)(2)(ii)(B)(1); 13 CFR 125.12(e)(2)(iii)(A)
- REVIEW FLAG: **NEEDS_REVIEW** · DEPENDS_ON `T1_change_of_controlling_interest`, `T4_recertification_outcome`
  - possible: T1_change_of_controlling_interest=no → NO_FLAG: "No recertification trigger established."
  - possible: T1_change_of_controlling_interest=yes, T4_recertification_outcome=qualifying → NO_FLAG: "Qualifying recertification: eligibility continues (125.12(e)(1))."
  - possible: T1_change_of_controlling_interest=yes, T4_recertification_outcome=disqualifying → FLAG: "Eligibility for orders and options is retained under the rule; the agency cannot count them toward small business goals."

### R4. Unrestricted awards and orders

_Legal review status: NOT_REVIEWED_BY_COUNSEL_

| Element | Content |
|---|---|
| Authority | [13 CFR 125.12(e)(2)(ii)(B)(1)](https://www.ecfr.gov/current/title-13/section-125.12); [13 CFR 125.12(e)(2)(iii)(A)](https://www.ecfr.gov/current/title-13/section-125.12) |
| Effective period | from 2025-01-16 (no end). Basis: 89 FR 102448 DATES: effective January 16, 2025; eCFR shows no later substantive version through 2026-10-01 |
| Mechanic | The concern remains eligible for unrestricted awards under a multiple award contract; for any unrestricted award a concern with a disqualifying recertification remains eligible to receive options. |
| Applicable instruments | Vehicle held: unrestricted multiple-award contract (incl. GSA Schedule); Vehicle held: unrestricted single-award contract; Standalone unrestricted contract; Order under an unrestricted single-award contract; Unrestricted order under an unrestricted multiple-award contract |
| Trigger facts | — |
| Required facts | — |
| Permitted wording | "No eligibility flag under 125.12 for unrestricted awards." |
| Prohibited wording | plus every global prohibition in Part D |

**Possible outcomes:** informational only. No flag is produced.

**Halvik impact** (as of 2026-01-21, all deal facts unknown; public federal values; overlaps other rules)

- INFORMATIONAL: 10 instruments (4 awards, 6 vehicles); awards: public obligated $29,072,571, public ceiling $91,710,099, ceiling not yet obligated $62,637,528

**Halvik example: `W519TC24F0308`** (Unrestricted order under an unrestricted multiple-award contract)

- FEDERAL FACT: set-aside on award none reported; parent W52P1J18DA078 (set-aside NO SET ASIDE USED.); MAC NAICS 541519; CO size OTHER THAN SMALL BUSINESS; public obligated $17,250,310, public ceiling $78,165,384
- REGULATORY FACT: 13 CFR 125.12(e)(2)(ii)(B)(1); 13 CFR 125.12(e)(2)(iii)(A)
- REVIEW FLAG: **INFORMATIONAL** · "No eligibility flag under 125.12 for unrestricted awards."

### R5. Set-aside or reserved MAC — future set-aside or reserved orders

_Legal review status: NOT_REVIEWED_BY_COUNSEL_

| Element | Content |
|---|---|
| Authority | [13 CFR 125.12(e)(2)(ii)(B)(1)](https://www.ecfr.gov/current/title-13/section-125.12); [13 CFR 125.12(e)(2)(ii)(B)(2)](https://www.ecfr.gov/current/title-13/section-125.12); [13 CFR 125.12(g)(1)](https://www.ecfr.gov/current/title-13/section-125.12) |
| Effective period | from 2025-01-16 (no end). Basis: 89 FR 102448 DATES: effective January 16, 2025; eCFR shows no later substantive version through 2026-10-01 |
| Mechanic | Other-than-small acquiring entity under the MAC NAICS: ineligible to submit an offer for a set aside or reserved award after the triggering event. Small acquiring concern: remains eligible for set-aside or reserved orders, not counted toward goals. Transaction before January 17, 2026: remains eligible for orders under the underlying small business MAC, not counted toward goals. |
| Applicable instruments | Vehicle held: multiple-award contract set aside or reserved for small business |
| Trigger facts | `T1_change_of_controlling_interest` — Did the transaction result in a change in controlling interest of the awardee (or an affiliate)? |
| Required facts | `T1_change_of_controlling_interest` — Did the transaction result in a change in controlling interest of the awardee (or an affiliate)?<br>`T2_transaction_date` — Date the merger, acquisition or sale occurred, relative to 2026-01-17<br>`T3_acquirer_size_under_naics` — Is the acquiring entity small under the NAICS code assigned to the MAC?<br>`T4_recertification_outcome` — Was the recertification for this award qualifying or disqualifying? |
| Permitted wording | "Ineligible to submit an offer for a set aside or reserved award under this MAC after the triggering event." |
| Prohibited wording | "future orders are lost"<br>"dollar value of future orders"<br>plus every global prohibition in Part D |

**Possible outcomes**

| When | Status | Review flag (exact wording) | Citation |
|---|---|---|---|
| T1_change_of_controlling_interest = no | NO_FLAG | No recertification trigger established. | 13 CFR 125.12(a) |
| T1_change_of_controlling_interest = yes<br>T4_recertification_outcome = qualifying | NO_FLAG | Qualifying recertification: eligibility continues. | 13 CFR 125.12(e)(1) |
| T1_change_of_controlling_interest = yes<br>T4_recertification_outcome = disqualifying<br>T2_transaction_date = before_threshold | FLAG | Transaction before January 17, 2026: remains eligible for orders under this MAC; new or pending orders cannot be counted toward goals. | 13 CFR 125.12(g)(1) |
| T1_change_of_controlling_interest = yes<br>T4_recertification_outcome = disqualifying<br>T2_transaction_date = on_or_after_threshold<br>T3_acquirer_size_under_naics = other_than_small | FLAG | Ineligible to submit an offer for a set aside or reserved award under this MAC after the triggering event. | 13 CFR 125.12(e)(2)(ii)(B)(1) |
| T1_change_of_controlling_interest = yes<br>T4_recertification_outcome = disqualifying<br>T2_transaction_date = on_or_after_threshold<br>T3_acquirer_size_under_naics = small | FLAG | Remains eligible for set-aside or reserved orders under this MAC; the agency cannot count them toward goals. | 13 CFR 125.12(e)(2)(ii)(B)(2) |

**Halvik impact** (as of 2026-01-21, all deal facts unknown; public federal values; overlaps other rules)

- NEEDS_REVIEW: 6 instruments (0 awards, 6 vehicles); vehicles only: vehicle ceilings are program-wide, so no value is attributed

**Halvik example: `1331L523D13OS0030`** (Vehicle held: multiple-award contract set aside or reserved for small business)

- FEDERAL FACT: set-aside on award SMALL BUSINESS SET ASIDE - TOTAL; parent none; MAC NAICS 541519; CO size SMALL BUSINESS; vehicle (ceiling program-wide, not attributed)
- REGULATORY FACT: 13 CFR 125.12(e)(2)(ii)(B)(1); 13 CFR 125.12(e)(2)(ii)(B)(2); 13 CFR 125.12(g)(1)
- REVIEW FLAG: **NEEDS_REVIEW** · DEPENDS_ON `T1_change_of_controlling_interest`, `T4_recertification_outcome`, `T2_transaction_date`, `T3_acquirer_size_under_naics`
  - possible: T1_change_of_controlling_interest=no → NO_FLAG: "No recertification trigger established."
  - possible: T1_change_of_controlling_interest=yes, T4_recertification_outcome=qualifying → NO_FLAG: "Qualifying recertification: eligibility continues."
  - possible: T1_change_of_controlling_interest=yes, T4_recertification_outcome=disqualifying, T2_transaction_date=before_threshold → FLAG: "Transaction before January 17, 2026: remains eligible for orders under this MAC; new or pending orders cannot be counted toward goals."
  - possible: T1_change_of_controlling_interest=yes, T4_recertification_outcome=disqualifying, T2_transaction_date=on_or_after_threshold, T3_acquirer_size_under_naics=other_than_small → FLAG: "Ineligible to submit an offer for a set aside or reserved award under this MAC after the triggering event."
  - possible: T1_change_of_controlling_interest=yes, T4_recertification_outcome=disqualifying, T2_transaction_date=on_or_after_threshold, T3_acquirer_size_under_naics=small → FLAG: "Remains eligible for set-aside or reserved orders under this MAC; the agency cannot count them toward goals."

### R6. Set-aside or reserved MAC — options on the MAC

_Legal review status: NOT_REVIEWED_BY_COUNSEL_

| Element | Content |
|---|---|
| Authority | [13 CFR 125.12(e)(2)(iii)(B)](https://www.ecfr.gov/current/title-13/section-125.12); [13 CFR 125.12(e)(2)(iii)(C)](https://www.ecfr.gov/current/title-13/section-125.12); [13 CFR 125.12(g)(2)](https://www.ecfr.gov/current/title-13/section-125.12) |
| Effective period | from 2025-01-16 (no end). Basis: 89 FR 102448 DATES: effective January 16, 2025; eCFR shows no later substantive version through 2026-10-01 |
| Mechanic | Other-than-small acquiring entity: ineligible to receive options on the set-aside MAC. Small acquiring concern: remains eligible to receive options, not counted toward goals. A firm with a disqualifying recertification prior to the end of the fifth year of a long-term contract remains eligible for options exercised prior to January 17, 2026, not counted toward goals. |
| Applicable instruments | Vehicle held: multiple-award contract set aside or reserved for small business |
| Trigger facts | `T1_change_of_controlling_interest` — Did the transaction result in a change in controlling interest of the awardee (or an affiliate)? |
| Required facts | `T1_change_of_controlling_interest` — Did the transaction result in a change in controlling interest of the awardee (or an affiliate)?<br>`T3_acquirer_size_under_naics` — Is the acquiring entity small under the NAICS code assigned to the MAC?<br>`T4_recertification_outcome` — Was the recertification for this award qualifying or disqualifying?<br>`F_g2_option_conditions` — Are the 125.12(g)(2) conditions met (disqualifying recertification before end of year five; options exercised before 2026-01-17)? |
| Permitted wording | "Ineligible to receive options on this set-aside MAC." |
| Prohibited wording | "option value lost"<br>plus every global prohibition in Part D |

**Possible outcomes**

| When | Status | Review flag (exact wording) | Citation |
|---|---|---|---|
| T1_change_of_controlling_interest = no | NO_FLAG | No recertification trigger established. | 13 CFR 125.12(a) |
| T1_change_of_controlling_interest = yes<br>T4_recertification_outcome = qualifying | NO_FLAG | Qualifying recertification: option eligibility continues. | 13 CFR 125.12(e)(1) |
| T1_change_of_controlling_interest = yes<br>T4_recertification_outcome = disqualifying<br>F_g2_option_conditions = met | FLAG | Remains eligible for MAC options exercised prior to January 17, 2026; those options cannot be counted toward goals. | 13 CFR 125.12(g)(2) |
| T1_change_of_controlling_interest = yes<br>T4_recertification_outcome = disqualifying<br>F_g2_option_conditions = not_met<br>T3_acquirer_size_under_naics = other_than_small | FLAG | Ineligible to receive options on this set-aside MAC. | 13 CFR 125.12(e)(2)(iii)(B) |
| T1_change_of_controlling_interest = yes<br>T4_recertification_outcome = disqualifying<br>F_g2_option_conditions = not_met<br>T3_acquirer_size_under_naics = small | FLAG | Remains eligible to receive options on this MAC; the option periods cannot be counted toward goals. | 13 CFR 125.12(e)(2)(iii)(C) |

**Halvik impact** (as of 2026-01-21, all deal facts unknown; public federal values; overlaps other rules)

- NEEDS_REVIEW: 6 instruments (0 awards, 6 vehicles); vehicles only: vehicle ceilings are program-wide, so no value is attributed

**Halvik example: `1331L523D13OS0030`** (Vehicle held: multiple-award contract set aside or reserved for small business)

- FEDERAL FACT: set-aside on award SMALL BUSINESS SET ASIDE - TOTAL; parent none; MAC NAICS 541519; CO size SMALL BUSINESS; vehicle (ceiling program-wide, not attributed)
- REGULATORY FACT: 13 CFR 125.12(e)(2)(iii)(B); 13 CFR 125.12(e)(2)(iii)(C); 13 CFR 125.12(g)(2)
- REVIEW FLAG: **NEEDS_REVIEW** · DEPENDS_ON `T1_change_of_controlling_interest`, `T4_recertification_outcome`, `F_g2_option_conditions`, `T3_acquirer_size_under_naics`
  - possible: T1_change_of_controlling_interest=no → NO_FLAG: "No recertification trigger established."
  - possible: T1_change_of_controlling_interest=yes, T4_recertification_outcome=qualifying → NO_FLAG: "Qualifying recertification: option eligibility continues."
  - possible: T1_change_of_controlling_interest=yes, T4_recertification_outcome=disqualifying, F_g2_option_conditions=met → FLAG: "Remains eligible for MAC options exercised prior to January 17, 2026; those options cannot be counted toward goals."
  - possible: T1_change_of_controlling_interest=yes, T4_recertification_outcome=disqualifying, F_g2_option_conditions=not_met, T3_acquirer_size_under_naics=other_than_small → FLAG: "Ineligible to receive options on this set-aside MAC."
  - possible: T1_change_of_controlling_interest=yes, T4_recertification_outcome=disqualifying, F_g2_option_conditions=not_met, T3_acquirer_size_under_naics=small → FLAG: "Remains eligible to receive options on this MAC; the option periods cannot be counted toward goals."

### R7. Options on orders already awarded under a set-aside MAC

_Legal review status: NOT_REVIEWED_BY_COUNSEL_

| Element | Content |
|---|---|
| Authority | [13 CFR 125.12(a)(3)](https://www.ecfr.gov/current/title-13/section-125.12); [13 CFR 125.12(e)(2)(iii)(B)](https://www.ecfr.gov/current/title-13/section-125.12) |
| Effective period | from 2025-01-16 (no end). Basis: 89 FR 102448 DATES: effective January 16, 2025; eCFR shows no later substantive version through 2026-10-01 |
| Mechanic | Existing award terms are unchanged by recertification (125.12(a)(3)). The text of 125.12(e)(2)(iii)(B) addresses options on a multiple award contract that is set-aside; it does not expressly state its treatment of options on an order already awarded under such a contract. |
| Applicable instruments | Order already awarded under a set-aside multiple-award contract. Only when: the order carries option value not yet exercised (base+all options > base+exercised options) |
| Trigger facts | — |
| Required facts | `I_options_on_existing_orders` — INTERPRETATION — does 125.12(e)(2)(iii)(B) reach options on orders already awarded under a set-aside MAC? |
| Permitted wording | "Option treatment of this existing order is not established by the rule text; requires determination." |
| Prohibited wording | "options on this order are lost"<br>"options on this order are retained"<br>plus every global prohibition in Part D |

**Possible outcomes:** none. The governing text does not establish the treatment; the engine returns NEEDS_REVIEW.

**Halvik impact** (as of 2026-01-21, all deal facts unknown; public federal values; overlaps other rules)

- NEEDS_REVIEW: 25 instruments (25 awards, 0 vehicles); awards: public obligated $164,590,543, public ceiling $290,384,701, ceiling not yet obligated $125,794,157

**Halvik example: `1333BJ24F00280005`** (Order already awarded under a set-aside multiple-award contract)

- FEDERAL FACT: set-aside on award none reported; parent 1333BJ21D00280002 (set-aside SMALL BUSINESS SET ASIDE - PARTIAL); MAC NAICS 541512; CO size SMALL BUSINESS; public obligated $20,665,737, public ceiling $22,165,737
- REGULATORY FACT: 13 CFR 125.12(a)(3); 13 CFR 125.12(e)(2)(iii)(B)
- REVIEW FLAG: **NEEDS_REVIEW** · DEPENDS_ON `I_options_on_existing_orders` · The governing text does not establish the treatment; no outcome is offered.

### R8. Set-aside order under an unrestricted MAC (including GSA Schedule)

_Legal review status: NOT_REVIEWED_BY_COUNSEL_

| Element | Content |
|---|---|
| Authority | [13 CFR 125.12(e)(2)(ii)(B)(1)](https://www.ecfr.gov/current/title-13/section-125.12); [13 CFR 125.12(e)(2)(ii)(B)(2)](https://www.ecfr.gov/current/title-13/section-125.12); [13 CFR 125.12(a)(3)](https://www.ecfr.gov/current/title-13/section-125.12); [13 CFR 121.404(c)(4)(i); 121.404(i)](https://www.ecfr.gov/current/title-13/section-121.404); [FAR 52.219-28(c)(4) (JAN 2025)](https://www.acquisition.gov/far/52.219-28) |
| Effective period | from 2025-01-16 (no end). Basis: 89 FR 102448 DATES: effective January 16, 2025; eCFR shows no later substantive version through 2026-10-01 |
| Mechanic | Future: an other-than-small acquiring entity makes the concern ineligible to submit an offer for a set aside award after the triggering event; a small acquiring concern remains eligible for set-aside orders under a MAC, not counted toward goals. The FSS MAS is a multiple award schedule (121.404(c)(4)(i)); the (c)(4) exceptions do not affect 125.12 (121.404(i)). 125.12(g)(1) addresses an "underlying small business multiple award contract"; its application to set-aside orders under an unrestricted MAC is not stated. The existing order is unchanged (125.12(a)(3)). |
| Applicable instruments | Set-aside order under an unrestricted multiple-award contract |
| Trigger facts | `T1_change_of_controlling_interest` — Did the transaction result in a change in controlling interest of the awardee (or an affiliate)? |
| Required facts | `T1_change_of_controlling_interest` — Did the transaction result in a change in controlling interest of the awardee (or an affiliate)?<br>`T2_transaction_date` — Date the merger, acquisition or sale occurred, relative to 2026-01-17<br>`T3_acquirer_size_under_naics` — Is the acquiring entity small under the NAICS code assigned to the MAC?<br>`T4_recertification_outcome` — Was the recertification for this award qualifying or disqualifying?<br>`I_g1_scope_unrestricted_mac` — INTERPRETATION — does 125.12(g)(1) reach set-aside orders under an unrestricted MAC? |
| Permitted wording | "Ineligible to submit an offer for further set-aside orders on this vehicle after the triggering event; the existing order is unchanged." |
| Prohibited wording | "no grandfathering on Schedules"<br>plus every global prohibition in Part D |

**Possible outcomes**

| When | Status | Review flag (exact wording) | Citation |
|---|---|---|---|
| T1_change_of_controlling_interest = no | NO_FLAG | No recertification trigger established. | 13 CFR 125.12(a) |
| T1_change_of_controlling_interest = yes<br>T4_recertification_outcome = qualifying | NO_FLAG | Qualifying recertification: eligibility continues. | 13 CFR 125.12(e)(1) |
| T1_change_of_controlling_interest = yes<br>T4_recertification_outcome = disqualifying<br>T2_transaction_date = on_or_after_threshold<br>T3_acquirer_size_under_naics = other_than_small | FLAG | Ineligible to submit an offer for further set-aside orders on this vehicle after the triggering event; the existing order is unchanged. | 13 CFR 125.12(e)(2)(ii)(B)(1); (a)(3) |
| T1_change_of_controlling_interest = yes<br>T4_recertification_outcome = disqualifying<br>T3_acquirer_size_under_naics = small | FLAG | Remains eligible for set-aside orders under this MAC; the agency cannot count them toward goals. | 13 CFR 125.12(e)(2)(ii)(B)(2) |
| T1_change_of_controlling_interest = yes<br>T4_recertification_outcome = disqualifying<br>T2_transaction_date = before_threshold<br>T3_acquirer_size_under_naics = other_than_small<br>I_g1_scope_unrestricted_mac = resolved | NEEDS_REVIEW | Transaction before January 17, 2026 on an unrestricted MAC: whether 125.12(g)(1) reaches this vehicle is not stated in the rule text; requires determination. | 13 CFR 125.12(g)(1) |

**Halvik impact** (as of 2026-01-21, all deal facts unknown; public federal values; overlaps other rules)

- NEEDS_REVIEW: 2 instruments (2 awards, 0 vehicles); awards: public obligated $108,486,956, public ceiling $132,063,717, ceiling not yet obligated $23,576,762

**Halvik example: `H9240421F0077`** (Set-aside order under an unrestricted multiple-award contract)

- FEDERAL FACT: set-aside on award WOMEN OWNED SMALL BUSINESS; parent W52P1J18DA078 (set-aside NO SET ASIDE USED.); MAC NAICS 541519; CO size OTHER THAN SMALL BUSINESS; public obligated $76,345,975, public ceiling $93,015,603
- REGULATORY FACT: 13 CFR 125.12(e)(2)(ii)(B)(1); 13 CFR 125.12(e)(2)(ii)(B)(2); 13 CFR 125.12(a)(3); 13 CFR 121.404(c)(4)(i); 121.404(i); FAR 52.219-28(c)(4) (JAN 2025)
- REVIEW FLAG: **NEEDS_REVIEW** · DEPENDS_ON `T1_change_of_controlling_interest`, `T4_recertification_outcome`, `T2_transaction_date`, `T3_acquirer_size_under_naics`, `I_g1_scope_unrestricted_mac`
  - possible: T1_change_of_controlling_interest=no → NO_FLAG: "No recertification trigger established."
  - possible: T1_change_of_controlling_interest=yes, T4_recertification_outcome=qualifying → NO_FLAG: "Qualifying recertification: eligibility continues."
  - possible: T1_change_of_controlling_interest=yes, T4_recertification_outcome=disqualifying, T2_transaction_date=on_or_after_threshold, T3_acquirer_size_under_naics=other_than_small → FLAG: "Ineligible to submit an offer for further set-aside orders on this vehicle after the triggering event; the existing order is unchanged."
  - possible: T1_change_of_controlling_interest=yes, T4_recertification_outcome=disqualifying, T3_acquirer_size_under_naics=small → FLAG: "Remains eligible for set-aside orders under this MAC; the agency cannot count them toward goals."
  - possible: T1_change_of_controlling_interest=yes, T4_recertification_outcome=disqualifying, T2_transaction_date=before_threshold, T3_acquirer_size_under_naics=other_than_small, I_g1_scope_unrestricted_mac=resolved → NEEDS_REVIEW: "Transaction before January 17, 2026 on an unrestricted MAC: whether 125.12(g)(1) reaches this vehicle is not stated in the rule text; requires determination."

### R9. Partial set-aside or reserved MAC — which portion the holder is on

_Legal review status: NOT_REVIEWED_BY_COUNSEL_

| Element | Content |
|---|---|
| Authority | [13 CFR 125.12(g)(1)](https://www.ecfr.gov/current/title-13/section-125.12); [13 CFR 125.12(e)(2)(ii)(B)](https://www.ecfr.gov/current/title-13/section-125.12) |
| Effective period | from 2025-01-16 (no end). Basis: 89 FR 102448 DATES: effective January 16, 2025; eCFR shows no later substantive version through 2026-10-01 |
| Mechanic | 125.12(g)(1) expressly includes "set-asides, partial set-asides, and reserves". FPDS does not record which portion of a partial set-aside the holder occupies. |
| Applicable instruments | Vehicle held: multiple-award contract set aside or reserved for small business. Only when: the vehicle set-aside code is a PARTIAL set-aside |
| Trigger facts | `F_partial_set_aside_portion` — Which portion (reserved or unrestricted) of a partial set-aside MAC does the holder occupy? |
| Required facts | `F_partial_set_aside_portion` — Which portion (reserved or unrestricted) of a partial set-aside MAC does the holder occupy? |
| Permitted wording | "Which portion of the partial set-aside the holder occupies must be established." |
| Prohibited wording | plus every global prohibition in Part D |

**Possible outcomes**

| When | Status | Review flag (exact wording) | Citation |
|---|---|---|---|
| F_partial_set_aside_portion = reserved_portion | FLAG | Holder is on the reserved portion: R5 and R6 apply as to a set-aside MAC. | 13 CFR 125.12(e)(2)(ii)(B); (g)(1) |
| F_partial_set_aside_portion = unrestricted_portion | NO_FLAG | Holder is on the unrestricted portion: treat as unrestricted (R4). | 13 CFR 125.12(e)(2)(ii)(B)(1) |

**Halvik impact** (as of 2026-01-21, all deal facts unknown; public federal values; overlaps other rules)

- NEEDS_REVIEW: 1 instruments (0 awards, 1 vehicles); vehicles only: vehicle ceilings are program-wide, so no value is attributed

**Halvik example: `1333BJ21D00280002`** (Vehicle held: multiple-award contract set aside or reserved for small business)

- FEDERAL FACT: set-aside on award SMALL BUSINESS SET ASIDE - PARTIAL; parent none; MAC NAICS 541512; CO size SMALL BUSINESS; vehicle (ceiling program-wide, not attributed)
- REGULATORY FACT: 13 CFR 125.12(g)(1); 13 CFR 125.12(e)(2)(ii)(B)
- REVIEW FLAG: **NEEDS_REVIEW** · DEPENDS_ON `F_partial_set_aside_portion`
  - possible: F_partial_set_aside_portion=reserved_portion → FLAG: "Holder is on the reserved portion: R5 and R6 apply as to a set-aside MAC."
  - possible: F_partial_set_aside_portion=unrestricted_portion → NO_FLAG: "Holder is on the unrestricted portion: treat as unrestricted (R4)."

### R10. Pending offers at the triggering event

_Legal review status: NOT_REVIEWED_BY_COUNSEL_

| Element | Content |
|---|---|
| Authority | [13 CFR 125.12(e)(2)(i)](https://www.ecfr.gov/current/title-13/section-125.12) |
| Effective period | from 2025-01-16 (no end). Basis: 89 FR 102448 DATES: effective January 16, 2025; eCFR shows no later substantive version through 2026-10-01 |
| Mechanic | Triggering events within 180 days after an offer but before award: ineligible for the pending small business set-aside or reserved award. More than 180 days: eligible for a pending single award or reserve, but ineligible where the underlying award is a multiple award small business set-aside or reserve. |
| Applicable instruments | Deal level (not per instrument) |
| Trigger facts | `F_pending_offers` — Were offers pending at the triggering event? |
| Required facts | `F_pending_offers` — Were offers pending at the triggering event? |
| Permitted wording | "Pending offers cannot be assessed from public award data." |
| Prohibited wording | plus every global prohibition in Part D |

**Possible outcomes**

| When | Status | Review flag (exact wording) | Citation |
|---|---|---|---|
| F_pending_offers = none | NO_FLAG | No pending offers established at the triggering event. | 13 CFR 125.12(e)(2)(i) |
| F_pending_offers = present | NEEDS_REVIEW | Pending offers exist: each must be tested against the 180-day rule with its offer date and set-aside type. | 13 CFR 125.12(e)(2)(i) |

**Halvik impact** (as of 2026-01-21, all deal facts unknown; public federal values; overlaps other rules)

- Deal level: NEEDS_REVIEW, DEPENDS_ON F_pending_offers

**Halvik example: deal level**

- REGULATORY FACT: 13 CFR 125.12(e)(2)(i)
- REVIEW FLAG: **NEEDS_REVIEW** · DEPENDS_ON `F_pending_offers`
  - possible: F_pending_offers=none → NO_FLAG: "No pending offers established at the triggering event."
  - possible: F_pending_offers=present → NEEDS_REVIEW: "Pending offers exist: each must be tested against the 180-day rule with its offer date and set-aside type."

### R11. Long-term contract recertification point

_Legal review status: NOT_REVIEWED_BY_COUNSEL_

| Element | Content |
|---|---|
| Authority | [13 CFR 125.12(b)](https://www.ecfr.gov/current/title-13/section-125.12); [FAR 52.219-28(b)(3) (JAN 2025)](https://www.acquisition.gov/far/52.219-28) |
| Effective period | from 2025-01-16 (no end). Basis: 89 FR 102448 DATES: effective January 16, 2025; eCFR shows no later substantive version through 2026-10-01 |
| Mechanic | For contracts and orders longer than five years including options, recertify no more than 120 days before the end of the fifth year and before each later option. FAR 52.219-28(b)(3) states a 60-to-120-day window. |
| Applicable instruments | All instrument types. Only when: period of performance including options exceeds five years (POP start to potential end) |
| Trigger facts | — |
| Required facts | — |
| Permitted wording | "A 125.12(b) long-term recertification point applies to this instrument, independent of the transaction." |
| Prohibited wording | plus every global prohibition in Part D |

**Possible outcomes**

| When | Status | Review flag (exact wording) | Citation |
|---|---|---|---|
| always | FLAG | A 125.12(b) long-term recertification point applies to this instrument, independent of the transaction. | 13 CFR 125.12(b) |

**Halvik impact** (as of 2026-01-21, all deal facts unknown; public federal values; overlaps other rules)

- FLAG: 11 instruments (11 awards, 0 vehicles); awards: public obligated $205,184,703, public ceiling $227,201,502, ceiling not yet obligated $22,016,799

**Halvik example: `H9240421F0077`** (Set-aside order under an unrestricted multiple-award contract)

- FEDERAL FACT: set-aside on award WOMEN OWNED SMALL BUSINESS; parent W52P1J18DA078 (set-aside NO SET ASIDE USED.); MAC NAICS 541519; CO size OTHER THAN SMALL BUSINESS; public obligated $76,345,975, public ceiling $93,015,603
- REGULATORY FACT: 13 CFR 125.12(b); FAR 52.219-28(b)(3) (JAN 2025)
- REVIEW FLAG: **FLAG** · "A 125.12(b) long-term recertification point applies to this instrument, independent of the transaction."

### R12. Contracting-officer-requested recertification for a specific order

_Legal review status: NOT_REVIEWED_BY_COUNSEL_

| Element | Content |
|---|---|
| Authority | [13 CFR 125.12(c)](https://www.ecfr.gov/current/title-13/section-125.12); [13 CFR 125.12(e)(2)(ii)(A)](https://www.ecfr.gov/current/title-13/section-125.12) |
| Effective period | from 2025-01-16 (no end). Basis: 89 FR 102448 DATES: effective January 16, 2025; eCFR shows no later substantive version through 2026-10-01 |
| Mechanic | A disqualifying recertification requested for a specific order or agreement makes the concern ineligible for that order only; it remains eligible for other set-aside, reserved and unrestricted awards. |
| Applicable instruments | Deal level (not per instrument) |
| Trigger facts | — |
| Required facts | — |
| Permitted wording | — |
| Prohibited wording | plus every global prohibition in Part D |

**Possible outcomes:** informational only. No flag is produced.

**Halvik impact** (as of 2026-01-21, all deal facts unknown; public federal values; overlaps other rules)

- Deal level: INFORMATIONAL

**Halvik example: deal level**

- REGULATORY FACT: 13 CFR 125.12(c); 13 CFR 125.12(e)(2)(ii)(A)
- REVIEW FLAG: **INFORMATIONAL**

### R13. 8(a) contract or order: performance after change of ownership or control

_Legal review status: NOT_REVIEWED_BY_COUNSEL_

| Element | Content |
|---|---|
| Authority | [13 CFR 124.515(a), (a)(1)](https://www.ecfr.gov/current/title-13/section-124.515); [13 CFR 124.515(b), (c), (g)](https://www.ecfr.gov/current/title-13/section-124.515); [13 CFR 124.105(i)(1)](https://www.ecfr.gov/current/title-13/section-124.105) |
| Effective period | from 2023-05-30 (no end). Basis: eCFR version date of the current 124.515 text (last amended 88 FR 26208) |
| Mechanic | An 8(a) contract or order must be performed by the Participant that initially received it unless a waiver is granted. It must be terminated for the convenience of the Government if the individuals upon whom eligibility was based relinquish ownership or control such that the concern would no longer be at least 51% owned or controlled by disadvantaged individuals. Waiver grounds are listed in 124.515(b); the request must be made in writing prior to the change (124.515(c)). 124.105(i)(1) addresses a Participant or former Participant performing 8(a) contracts. |
| Applicable instruments | All instrument types. Only when: an 8(a) set-aside code (8(A) SOLE SOURCE or 8A COMPETED) on the award or its parent vehicle |
| Trigger facts | `T5a_8a_ownership_or_control_relinquished` — Did the individuals on whom 8(a) eligibility was based relinquish ownership or control? |
| Required facts | `T5a_8a_ownership_or_control_relinquished` — Did the individuals on whom 8(a) eligibility was based relinquish ownership or control?<br>`T5b_8a_waiver_status` — Status of any 124.515 waiver (granted / denied / pending / not requested) |
| Permitted wording | "The 124.515(a)(1) termination-for-convenience requirement applies to this 8(a) award (no waiver requested)." |
| Prohibited wording | "will be terminated"<br>"a waiver exists"<br>"no waiver exists (without the fact)"<br>plus every global prohibition in Part D |

**Possible outcomes**

| When | Status | Review flag (exact wording) | Citation |
|---|---|---|---|
| T5a_8a_ownership_or_control_relinquished = no | NO_FLAG | No relinquishment of ownership or control established; 124.515(a)(1) not triggered. | 13 CFR 124.515(a)(1) |
| T5a_8a_ownership_or_control_relinquished = yes<br>T5b_8a_waiver_status = granted | NO_FLAG | Waiver granted under 124.515(b). | 13 CFR 124.515(b) |
| T5a_8a_ownership_or_control_relinquished = yes<br>T5b_8a_waiver_status = pending | NEEDS_REVIEW | Waiver request pending; outcome not established. | 13 CFR 124.515(c)(4) |
| T5a_8a_ownership_or_control_relinquished = yes<br>T5b_8a_waiver_status = denied | FLAG | The 124.515(a)(1) termination-for-convenience requirement applies to this 8(a) award (waiver denied; appeal right under 124.515(i)). | 13 CFR 124.515(a)(1); (i) |
| T5a_8a_ownership_or_control_relinquished = yes<br>T5b_8a_waiver_status = not_requested | FLAG | The 124.515(a)(1) termination-for-convenience requirement applies to this 8(a) award (no waiver requested). | 13 CFR 124.515(a)(1); (c) |

**Halvik impact** (as of 2026-01-21, all deal facts unknown; public federal values; overlaps other rules)

- NEEDS_REVIEW: 10 instruments (8 awards, 2 vehicles); awards: public obligated $173,715,900, public ceiling $223,735,519, ceiling not yet obligated $50,019,619

**Halvik example: `80TECH22FA001`** (Order already awarded under a set-aside multiple-award contract)

- FEDERAL FACT: set-aside on award 8A COMPETED; parent 47QRAD20D8115 (set-aside 8A COMPETED); MAC NAICS 541330; CO size SMALL BUSINESS; public obligated $114,250,000, public ceiling $148,756,175
- REGULATORY FACT: 13 CFR 124.515(a), (a)(1); 13 CFR 124.515(b), (c), (g); 13 CFR 124.105(i)(1)
- REVIEW FLAG: **NEEDS_REVIEW** · DEPENDS_ON `T5a_8a_ownership_or_control_relinquished`, `T5b_8a_waiver_status`
  - possible: T5a_8a_ownership_or_control_relinquished=no → NO_FLAG: "No relinquishment of ownership or control established; 124.515(a)(1) not triggered."
  - possible: T5a_8a_ownership_or_control_relinquished=yes, T5b_8a_waiver_status=granted → NO_FLAG: "Waiver granted under 124.515(b)."
  - possible: T5a_8a_ownership_or_control_relinquished=yes, T5b_8a_waiver_status=pending → NEEDS_REVIEW: "Waiver request pending; outcome not established."
  - possible: T5a_8a_ownership_or_control_relinquished=yes, T5b_8a_waiver_status=denied → FLAG: "The 124.515(a)(1) termination-for-convenience requirement applies to this 8(a) award (waiver denied; appeal right under 124.515(i))."
  - possible: T5a_8a_ownership_or_control_relinquished=yes, T5b_8a_waiver_status=not_requested → FLAG: "The 124.515(a)(1) termination-for-convenience requirement applies to this 8(a) award (no waiver requested)."

### R14. Goaling wording differs between SBA rule and FAR

_Legal review status: NOT_REVIEWED_BY_COUNSEL_

| Element | Content |
|---|---|
| Authority | [13 CFR 125.12(e)](https://www.ecfr.gov/current/title-13/section-125.12); [FAR 19.301-2(d)(1) (FAC 2026-01)](https://www.acquisition.gov/far/19.301-2) |
| Effective period | from 2025-01-16 (no end). Basis: 89 FR 102448 DATES: effective January 16, 2025; eCFR shows no later substantive version through 2026-10-01 |
| Mechanic | 125.12(e) and (g) say the agency "cannot count" the specified orders or options; FAR 19.301-2(d)(1) says the agency "may no longer include" them. The engine cites 125.12 for SBA goaling and notes the difference. |
| Applicable instruments | Deal level (not per instrument) |
| Trigger facts | — |
| Required facts | — |
| Permitted wording | — |
| Prohibited wording | plus every global prohibition in Part D |

**Possible outcomes:** informational only. No flag is produced.

**Halvik impact** (as of 2026-01-21, all deal facts unknown; public federal values; overlaps other rules)

- Deal level: INFORMATIONAL

**Halvik example: deal level**

- REGULATORY FACT: 13 CFR 125.12(e); FAR 19.301-2(d)(1) (FAC 2026-01)
- REVIEW FLAG: **INFORMATIONAL**

### R15. Socioeconomic program status recertification

_Legal review status: NOT_REVIEWED_BY_COUNSEL_

| Element | Content |
|---|---|
| Authority | [13 CFR 125.12(a)](https://www.ecfr.gov/current/title-13/section-125.12); [13 CFR 126.619 (HUBZone); 127.504 (WOSB/EDWOSB); 128.401 (SDVOSB)](https://www.ecfr.gov/current/title-13/section-127.504) |
| Effective period | from 2025-01-16 (no end). Basis: 89 FR 102448 DATES: effective January 16, 2025; eCFR shows no later substantive version through 2026-10-01 |
| Mechanic | Status recertification (8(a), HUBZone, WOSB/EDWOSB, SDVOSB) is governed by 125.12(a), cross-referenced in 126.619, 127.504 and 128.401. R1–R8 apply to status as they apply to size. |
| Applicable instruments | All instrument types. Only when: a program set-aside code (8(a), WOSB/EDWOSB, HUBZone, SDVOSB) on the award or its parent vehicle |
| Trigger facts | — |
| Required facts | — |
| Permitted wording | — |
| Prohibited wording | plus every global prohibition in Part D |

**Possible outcomes:** informational only. No flag is produced.

**Halvik impact** (as of 2026-01-21, all deal facts unknown; public federal values; overlaps other rules)

- INFORMATIONAL: 11 instruments (9 awards, 2 vehicles); awards: public obligated $250,061,875, public ceiling $316,751,122, ceiling not yet obligated $66,689,247

**Halvik example: `80TECH22FA001`** (Order already awarded under a set-aside multiple-award contract)

- FEDERAL FACT: set-aside on award 8A COMPETED; parent 47QRAD20D8115 (set-aside 8A COMPETED); MAC NAICS 541330; CO size SMALL BUSINESS; public obligated $114,250,000, public ceiling $148,756,175
- REGULATORY FACT: 13 CFR 125.12(a); 13 CFR 126.619 (HUBZone); 127.504 (WOSB/EDWOSB); 128.401 (SDVOSB)
- REVIEW FLAG: **INFORMATIONAL**

## Part D — Global prohibited wording (enforced on every output)

| Pattern | Why |
|---|---|
| `\bbacklog\b` | ceiling and obligations are not backlog |
| `\brevenue\b` | public award values are not revenue |
| `\b(lost\|loses\|loss\|losing)\b` | no economic loss is computed |
| `\bdies?\b\|\bdead\b` | rule text says ineligible, not dies |
| `will be terminated` | 124.515 states a requirement; it does not report an event |
| `purchase[- ]price\|valuation\|discount\|haircut` | no price or valuation output |
| `\bclosed on\b\|\bclosing date (is\|was)\b` | closing date is never inferred |
| `legally approved\|approved by counsel\|counsel[- ]approved\|legally (sound\|correct\|compliant)` | no rule has been reviewed by counsel |

---
_Generated from code. Status NOT_REVIEWED_BY_COUNSEL. Ceiling (base + all options) is a contract ceiling; nothing in this packet is a forecast of work, an economic figure or a price effect._
