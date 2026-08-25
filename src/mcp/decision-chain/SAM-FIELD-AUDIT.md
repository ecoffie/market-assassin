# SAM ingestion field audit — 140 of 157 fields discarded, and none recoverable

Separate track from the P0-3 deploy. Method: enumerate the raw SAM Entity API payload
(`includeSections=entityRegistration,coreData,assertions,repsAndCerts,pointsOfContact`),
diff against `sam_entities` and both parsers, classify what is dropped.

## The finding that reframes everything else

```sql
SELECT count(*), count(raw_data),
       count(*) FILTER (WHERE raw_data::text NOT IN ('{}','null')) FROM sam_entities;
→ 910,123 | 910,123 | 0
```

**`raw_data` exists on every row and is empty on every row.** The column that would make
dropped fields recoverable has never been populated for entities.

That converts Eric's rule from advice into the operative constraint here:

> *"You can always choose not to expose a field. You cannot recover it later without another
> full re-sync if ingestion threw it away."*

We have no fallback. Every field below requires a re-sync to obtain.

## Scale

| | Count |
|---|---|
| Raw leaf fields in the API payload | **157** |
| Mapped to a `sam_entities` column | **17** |
| **Dropped** | **140** |

| Section | Dropped |
|---|---|
| pointsOfContact | 66 |
| coreData | 35 |
| entityRegistration | 15 |
| assertions | 12 |
| repsAndCerts | 12 |

## Audit table — decision-useful fields Mindy discards

| SAM field | In raw feed | Persisted | Product value | Risk of losing it | Priority |
|---|---|---|---|---|---|
| `naicsList[].sbaSmallBusiness` | Yes | **No → fixed** | Rule of Two | False zero (P0-3) | **P0 — done** |
| `naicsList[].naicsException` | **Yes** | **No** | Size-standard accuracy; SBA exceptions change the applicable standard | Wrong size status for exception NAICS | **High** |
| `sbaBusinessTypeList[].certificationEntryDate` / `ExitDate` | **Yes** | **No** | Is the 8(a)/HUBZone cert CURRENT? | **MEASURED 2026-08-24: 507 firms (17.1% of certified) carry an EXPIRED cert; 467 of them have an ACTIVE SAM registration so nothing else flags them. 469 expired 8(a) + 44 expired HUBZone. Live mirror: KILIUDA CONSULTING stored `8(a)`, registration Active, cert expired 2023-01-11.** The expiry is IN the token the importer already prefix-matches (`A620210726`) — it keeps the label and drops the date | **P0 — measured, eligibility defect** |
| JV / entity structure (parent, hierarchy) | Partly (name/address only) | **No** | Are two "competitors" one organization? | **MEASURED 2026-08-24: only 33 of 30,480 NAICS+state pools (0.11%) flip Rule-of-Two after de-dup; ZERO whole-NAICS markets flip.** Real clusters exist (Ho-Chunk 12x in 541611; OS-DB-JV/-2/-3 same PR address) but the decision effect is narrow | **Low-Medium — measured, do NOT promote above cert dates** |
| `sbaBusinessTypeCode` vs `businessTypeList[]` | Yes | **Flattened into one `certifications[]`** | SBA program vs general business type are different questions | The exact conflation behind P0-3 | **High** |
| `entityRegistration.exclusionStatusFlag` | Yes | Yes (`exclusion_flag`) | Eligibility | — | ok |
| `entityRegistration.registrationDate` / `activationDate` / `lastUpdateDate` | **Yes** | **No** | Freshness, tenure, "newly registered" signals | Cannot distinguish a 20-year registrant from last week's | **High** |
| `entityRegistration.ueiStatus` / `ueiCreationDate` / `ueiExpirationDate` | **Yes** | **No** | Entity resolution and identity lineage | Given the `&amp;` round-trip defect (P1-1), identity metadata is directly relevant | **High** |
| `entityRegistration.purposeOfRegistrationCode/Desc` | **Yes** | **No** | All-awards vs grants-only registrants | Counting grant-only entities as contract competitors — inflates Rule-of-Two depth | **High** |
| `coreData.congressionalDistrict` | **Yes** | **No** | Local supplier discovery, political geography | Cannot answer "vendors in my district" | Medium |
| `coreData.generalInformation.entityStructure/entityType/profitStructure` | **Yes** | **No** | JV vs corporation vs nonprofit; ownership analysis | NMI Alaska/OS-DB-JV-2 are JVs — materially different competitors | **High** |
| `stateOfIncorporation` / `countryOfIncorporation` | **Yes** | **No** | Domestic-source, foreign-ownership screening | Missed FOCI/domestic-preference signals | Medium |
| `coreData.entityInformation.entityStartDate` | **Yes** | **No** | Company age — an emerging-vs-established discriminator | Rule-of-Two tiering has no tenure input | Medium |
| `financialInformation.creditCardUsage` / `debtSubjectToOffset` | **Yes** | **No** | Micro-purchase/GPC readiness; responsibility signal | Cannot answer "who takes a purchase card" | Medium |
| `assertions.disasterReliefData.*` (registry flag, bonding, geographic area served) | **Yes** | **No** | Disaster-response contracting, bonding capacity, service geography | Whole capability dimension invisible | Medium |
| `repsAndCerts.fARResponses[]` (24) / `dFARResponses[]` (9) | **Yes** | **No** | Eligibility, compliance, acquisition strategy | Missed qualification/disqualification | **Medium/High** |
| `repsAndCerts.pdfLinks.*` | **Yes** | **No** | Auditable source documents | No link to the authoritative rep | Low |
| `pointsOfContact.*` (66 leaves) | Yes | **Partially** — flattened to name/title/phone/email | Role-specific outreach | POC addresses and alternates lost | Low/Medium |
| `mailingAddress.*` | **Yes** | **No** | Correspondence vs place of performance | Minor | Low |
| `physicalAddress.addressLine1/2`, `zipCodePlus4` | **Yes** | **No** | Precise location, dedupe | Weaker entity resolution | Medium |

## The three I would raise first

1. **`purposeOfRegistrationCode`** — SAM distinguishes all-awards registrants from
   grants-only. Mindy currently counts both as contract competitors. **This directly inflates
   Rule-of-Two depth**, the metric P0-3 exists to get right, and it just became more material:
   the registry expansion added 416,886 entities whose purpose is unknown to us.
2. **`certificationEntryDate` / `certificationExitDate`** — a lapsed 8(a) certification is
   indistinguishable from a current one today. Recommending an expired set-aside firm is a
   real-money error for the user.
3. **`naicsException`** — SBA exceptions change the size standard for specific NAICS. We now
   store `sbaSmallBusiness` but not the exception qualifying it.

## Recommendation

**Persist the raw payload.** Populating `raw_data` on entities costs one column write and
removes the re-sync trap permanently — after that, any newly-needed field is a backfill from
local data rather than another 895K-row registry pull. That is the highest-leverage change in
this table, and it is independent of which fields we choose to expose.

Then promote the High-priority fields to typed columns as product need arises.

**Not proposing to ingest all 157 fields.** The audit's purpose is to identify decision-useful
information currently discarded, per Eric's framing.

## Caveat

This diff is from **one entity** (Didlake, UEI YMZ1PCB5LEM9). Fields null for this firm
(`dodaac`, `entityDivisionName`, `architectEngineerResponses`) may be populated elsewhere, and
the bulk extract's column set differs from the API's — the extract has ~150 pipe-delimited
fields not enumerated here. A complete audit should sample several entities across types
(JV, 8(a), foreign, grants-only) and diff the extract layout separately.
