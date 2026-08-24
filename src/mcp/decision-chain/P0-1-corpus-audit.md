# Internal corpus audit — real capability prose exists; usable LABELS do not.

Measured before building, per "measure before you build a data feature." Result: the
internal corpus supplies **excellent input text and no trustworthy ground truth.**
Three candidate tables, all rejected as the labelled primary set.

## 1. `contractor_capability_profiles` — 71,101 rows — REJECTED (circular)

`capability_summary` is **not founder prose**. It is a generated template string:

> `"Pharmaceuticals & biologics specialist — 98% of contract dollars · 2,349,399 awards ·
> $24.5B · mostly Department of Defense (99%) · has won set-aside work"`

Every element derives from the same spend data the resolver is being tested against, and
`capability_label` is derived from `top_naics`. Testing a NAICS resolver on a string
generated *from* that NAICS is circular — it would score well and mean nothing.

Volume was never the issue: 71,101 rows, all populated, avg 143 chars. **The provenance is.**

## 2. `user_business_profiles` — 122 usable — REJECTED (labels are click behaviour)

The prose is exactly right — real pasted capability statements, avg 269 chars, 163
distinct users, the true production register:

> "VEXFOLD LLC is a Service-Disabled Veteran-Owned Small Business specializing in the
> procurement, rapid deployment, and distribution of mission-critical energy stor…"

But `extracted_naics_codes` for that row is `562211` (hazardous waste), `493190`
(warehousing), `236220` (construction). It does not describe the prose.

Traced to `src/app/api/sample-opportunities/route.ts:50` —
`updates.extracted_naics_codes = data.extractedProfile.naicsCodes`, built from the
**opportunities the user CLICKED** during onboarding, not from their description.

Scoring against these would measure agreement with user click behaviour. **Unusable as
labels. Usable as unlabelled input text** — see recommendation.

## 3. `user_capabilities_library` — 44 usable — REJECTED as primary (too small, self-assigned, concentrated)

Genuinely the best-shaped source: founder-written `description` + user-assigned
`related_naics`.

> "Pro Finish Plus, LLC specializes in commercial facility maintenance and repair to
> include project management of HVAC systems repair/replace… porta potties, toilet
> trailers, handwash stations…" → `238220, 562991, 238330, 238320, 236118, 238390`

Those labels are plausible. But:

- **44 usable rows from only 14 distinct users** (236 rows / 33 users before filtering).
  Short of the 30 dev + 10–15 holdout target on its own.
- **Heavily concentrated** — 4 of 8 sampled rows were one company (CS Exclusive
  Enterprise), all carrying the identical `541611/541618/561210`. A naive draw is one firm
  repeated.
- **Labels are user self-assignments**, which you explicitly warned against treating as
  truth.
- **Labels are unvalidated free text.** One row's entire `related_naics` array is a single
  blob: `"423860 – Transportation Equipment and Supplies Merchant Wholesalers 336413 –
  Other Aircraft Parts… 423840 – Industrial Supplies…"` — three codes in one element.

## What this means

The blocker is **not** finding capability prose. We have plenty, and it is the right
register. The blocker is that **no internal table pairs that prose with a NAICS that was
derived from the prose itself.** Every internal label is derived from spend, from clicks,
or from unvalidated self-report.

This is worth noting as a product observation beyond P0-1: Mindy stores what users say and
what users click, but never reconciles the two. That gap is exactly the defect class P0-1
sits in.

## Recommendation

Build the primary set as **internal prose + independently constructed labels**:

1. **Text** from `user_capabilities_library` (44, founder-written) and
   `user_business_profiles` (122, pasted capability statements) — real, unedited, never
   authored by me.
2. **Labels built independently of the stored codes**, from the described activity plus
   verifiable company facts, as multi-valued acceptable / unacceptable sets. Stored codes
   become a *reference* column, never the label.
3. **De-duplicate by company** so no firm contributes more than ~2 cases.
4. **Contractor websites** fill category gaps — machining, stamping, ammunition, printing
   machinery, industrial equipment — which the internal corpus skews away from (it is
   heavily IT/cyber/construction-services).
5. Award-description cases stay exactly as they are, **scored on safety only**: no
   confidently absurd classification. Option 3 already passes that (0 unacceptable).

Point 2 is the part needing your explicit approval: labelling is judgement, and it is
the step where I could bias the benchmark toward the resolver. Proposal — label from the
prose *before* running the resolver, record the reasoning per case, and freeze it. Anything
I cannot label confidently is dropped, not guessed.

**Vintage:** every case records taxonomy vintage so retired codes (e.g. 333244 → 333248)
do not read as failures against a 2022 resolver.
