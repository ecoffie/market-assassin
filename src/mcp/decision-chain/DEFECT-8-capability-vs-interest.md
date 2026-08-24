# DEFECT-8 — Mindy conflates "this company CAN do X" with "this company LOOKED AT X"

**Filed separately. Not part of P0-1.** Surfaced during the P0-1 corpus audit; it is a
data-model issue, not a classification-resolver issue.

## The observation

`user_business_profiles` holds 122 real business descriptions with populated
`extracted_naics_codes`. Those codes are **not derived from the description.** They are
written from the opportunities the user clicked during onboarding calibration:

```
src/app/api/sample-opportunities/route.ts:50
  updates.extracted_naics_codes = data.extractedProfile.naicsCodes;
```

## Reproduction

Row: **VEXFOLD LLC**

- `business_description` (user-pasted): *"Service-Disabled Veteran-Owned Small Business
  specializing in the procurement, rapid deployment, and distribution of mission-critical
  energy stor[age]…"* — power systems, tactical equipment.
- `extracted_naics_codes`: `562211` (Hazardous Waste Treatment), `493190` (Warehousing),
  `236220` (Commercial Building Construction), `562910` (Remediation), `237990`, `488999`.

The stored codes describe **what the user browsed**, not what the company does.

## Why it matters

The field name says `extracted` — which reads as "extracted from the description." Anything
downstream consuming it as capability evidence inherits browsing behaviour as if it were
company fact. These are different signals:

| Signal | Means | Legitimate use |
|---|---|---|
| Stated capability | "we can do X" | classification, matching |
| Observed pursuit | "they looked at X" | recommendations, ranking |
| Verified work history | "they were paid for X" | past performance, credibility |
| Registered classification | "they claim X to SAM" | eligibility, set-aside |

Observed interest is genuinely valuable — for recommendations. It should not silently
become evidence of capability. Today one column carries the second while being named like
the first.

## Not investigated

Which downstream consumers read `extracted_naics_codes`, and whether any treat it as
capability. **Not traced** — that would have expanded P0-1 again. Known consumers by
filename: `sample-opportunities`, `app/profile`, `admin/debug-profile`.

## Suggested direction (not a decision)

Keep the four signals in four fields and reconcile rather than collapse:

> stated capability ↔ verified work history ↔ registered classification ↔ observed pursuit

At minimum, rename so the provenance is legible (`clicked_opportunity_naics` vs
`described_capability_naics`). Reconciliation between them is arguably a product feature —
"you say you do X, you're registered for Y, you've been paid for Z, and you keep clicking
W" is a real BD insight Mindy is currently positioned to produce and does not.

## Relationship to P0-1

This is why the internal corpus could not supply benchmark labels. Recorded in
`P0-1-corpus-audit.md`. P0-1 is unblocked by labelling independently; **this defect stands
on its own regardless of how P0-1 resolves.**
