# Fix M-Win Profile Grounding

**Status:** OPEN — scoped, NOT started. Do NOT bundle with the auth-fix deploy (PR #894).
**Owner decision (Eric 2026-08-04):** the current M-Win is a *valid partial* score, not "wrong."
Do not market it as a full six-factor personalized win probability until the loader is fixed.
**Sequence:** auth fix → verify rendering → fix profile source → normalize adapter → verify all
six factors → release the full M-Win model.

---

## The problem (verified against live schema, 2026-08-04)

`calculateWinProbability(opportunity, profile)` (`src/lib/briefings/win-probability.ts`) scores SIX
factors: NAICS · set-aside · agency experience · **contract size** · **capability** · **vehicle**.
Its profile comes from `getBriefingProfile` → `getSmartProfile` → **`user_notification_settings`**
(`src/lib/smart-profile/service.ts`). But `mapDbToProfile` reads columns that DO NOT EXIST on that
table — verified: `user_notification_settings` has only `naics_codes`, `agencies`, `keywords`,
`set_aside_preferences`. The following silently map to empty/defaults:

| Factor the model scores | Column mapDbToProfile reads | Exists on user_notification_settings? |
|---|---|---|
| Contract size fit | `max_contract_size`, `company_size` | ❌ NO |
| Capability match | `capability_keywords` | ❌ NO |
| Set-aside / cert | `certifications`, `is_verified_8a/sdvosb/wosb/hubzone` | ❌ NO (only `set_aside_preferences` exists) |
| Vehicle | `contract_vehicles` | ❌ NO |
| Past-perf agencies | `past_performance_agencies` | ❌ NO |

So M-Win reliably grounds on only **NAICS + set-aside preferences + agency** — 3 of the 6 factors.
The displayed score is technically calculated but is NOT the full designed model.

## Step 1 — Source of truth (DONE — verified)

Do NOT add these fields to `user_notification_settings` (that's alert config, not the business
profile). The canonical profile is the **Vault → `user_identity_profile`**, which holds exactly the
missing factors (verified columns): `certifications`, `contract_vehicles`, `primary_naics`, `uei`,
`capability_embedding` (+ `capability_embed_source_hash`/`capability_embedded_at`). Capabilities are
stored as an EMBEDDING, not keywords — the capability factor needs adapting to that (or read the raw
capability text the embedding was built from). Company size / max contract size: NOT yet found on
`user_identity_profile` — engineering must confirm where (or whether) they live; UEI can unlock
SAM-verified size (`recipient_certifications` / SAM entity cache) as the grounded source.

Split of truth to merge:
- **Alert config** (`user_notification_settings`): naics_codes, agencies, set_aside_preferences, keywords.
- **Business profile** (`user_identity_profile`): certifications, contract_vehicles, uei, primary_naics, capability_embedding.

## Step 2 — One normalized adapter

Build ONE shared service, e.g. `getMindyScoringProfile(email)` in `src/lib/profile/` (new), that
MERGES `user_notification_settings` + `user_identity_profile` into a stable object:

```ts
{ naicsCodes, agencies, setAsides, certifications, capabilityKeywords /* or embedding */,
  companySize, maxContractSize, verifiedPastPerformance, contractVehicles, uei }
```

M-Win, the Brief, the listing pursue card, Decision Cards, MCP, and any future API must all consume
THIS adapter (one implementation — the "one M-Win service" Eric asked for earlier). Replace the
`getBriefingProfile` call in `/api/app/win-probability` with the adapter.

## Step 3 — Make missing data EXPLICIT (three states, not two)

The model must distinguish: **matched** · **did-not-match** · **unavailable (profile incomplete)**.
Unavailable must NOT behave like a failed match (that unfairly lowers the score). Surface it in the
explanation, e.g. "Scored on 3 of 6 profile factors. Complete your company profile for a fuller
assessment." (WinFactor already has points/maxPoints/isPositive — add an `available:boolean` or a
`coverage: {scored, total}` on WinProbabilityResult.)

## Step 4 — Version the score

Once the extra factors wire in, historical M-Win values change. Add a model version tag
(`mwin_v1` → `mwin_v2`) on the result + anywhere M-Win is persisted, so old vs new scores don't get
compared silently.

## What NOT to do
- Don't call today's score "wrong" — it's a valid partial score on available inputs.
- Don't market a full six-factor personalized win probability until the loader is fixed.
- Don't ship this in the same deploy as the auth fix.

## Verify (when built)
- `npm run verify:m-scale` still passes (the perfect-match total + monotonic guards).
- A profile with certs/vehicle/size set produces a HIGHER score than the same profile without —
  proving those factors now actually contribute (inject → assert → revert).
- `coverage.scored` reflects how many factors had data.
