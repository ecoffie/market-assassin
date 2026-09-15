# Decision Makers — provenance + frozen importer audit (READ ONLY)

**Snapshot T0 = 2026-09-15T14:22:13Z · audit end 14:24:21Z.** Drain ran throughout. Nothing
mutated, merged, deduped or relabelled.

## 1. Snapshot

| measure | T0 |
|---|---|
| physical rows | **287,534** |
| live-source `held_population` | **205,517** |
| notices_scanned | **100,000 / 207,067 (48.3%)** |
| backfill cursor | `2026-06-20T01:01:07.963Z` · `last_error` NULL |
| distinct normalized emails | 22,929 |
| government-buyer rows | **205,517** |
| vendor rows | **82,017** |
| unknown rows | **0** |

## 2–3. The topology is NOT what the labels say

> **`source_table` is a GENERATION label, not a source identifier. Two of its three values are
> the same source.**

Attribution proven from `source_row_key` SHAPE, not from the column:

| family | rows | key shape | proven |
|---|---|---|---|
| `AllSamContacts` | 175,078 | `<notice uuid>::<slot>` | **175,078 / 175,078 (100%)** |
| `sam_opportunities_pointOfContact` | 30,439 | `<notice uuid>::<slot>` | **30,439 / 30,439 (100%)** |
| `sam_entities_pocs` | 82,017 | `<UEI>::<role>` | **82,011 / 82,017 (99.99%)**, 6 other |

**PROVEN_SOURCE: 287,528 · INFERRED_HIGH_CONFIDENCE: 6 · AMBIGUOUS: 0.**

### The finding that changes the model

`sam_opportunities_pointOfContact` **is not frozen.** Its `imported_at` is frozen (2026-05-28),
but its `updated_at` advances — latest 2026-09-15T10:00.

| family | re-adopted by the live drain | touched since the drain began |
|---|---|---|
| `AllSamContacts` | 136,406 (77.9%) | 66,127 |
| `sam_opportunities_pointOfContact` | **28,831 (94.7%)** | **28,831** |
| `sam_entities_pocs` | **0 (0.0%)** | **0** |

All 30,439 of its notice keys still exist in `sam_opportunities`. It shares the live producer's
exact key space, so the drain **updates those rows in place** — it never creates a duplicate, and
because the upsert payload omits `source_table`, the old generation label survives forever on
rows that are now maintained by the current producer. The remaining 1,608 are simply notices the
drain has not yet reached at 48.3%.

**So the real topology is ONE active canonical source spanning two labels (175,078 + 30,439 =
205,517, exactly `held_population`), plus ONE genuinely frozen, structurally distinct source
(82,017).**

## 4. Government vs vendor — the rule is proven, with perfect separation

| family | dept NULL | sol# NULL | UEI | email | sub_tier | office |
|---|---|---|---|---|---|---|
| `AllSamContacts` | **0** | 1,564 | 0 | 175,075 | 174,036 | 0 |
| `sam_opportunities_pointOfContact` | **0** | 331 | 0 | 30,439 | 28,831 | 0 |
| `sam_entities_pocs` | **82,017 (100%)** | **82,017 (100%)** | **82,017 (100%)** | **0** | 82,017 | 82,012 |

GOVERNMENT_BUYER_CONTACT **205,517** · VENDOR_ENTITY_POC **82,017** · UNKNOWN **0**.

Vendor rows surviving `department_ind_agency IS NOT NULL`: **0**.
Vendor rows surviving `solicitation_number IS NOT NULL`: **0**.

## 5. Overlap matrix

The vendor family carries **zero emails**, so it **cannot** overlap either government family on
email identity — the separation is structural, not heuristic.

| | identities |
|---|---|
| live (`AllSamContacts`) | 21,746 |
| older generation | 10,949 |
| **shared** | **9,766** (89.2% of the older generation) |
| only older generation | **1,183** |
| only live | 11,980 |
| any ∩ vendor | **0 — structurally impossible** |

Agency agreement across the two generations on the 9,766 shared identities: **9,764 agree, 2
disagree** — and both disagreements are the same pair already identified in the identity audit
(a real GSA person on a VA notice, and a commercial vendor support desk).

## 6. Unique useful coverage

**`sam_opportunities_pointOfContact` — 1,183 identities (1,535 rows) exist nowhere in the live
label.** They are NOT stale: **90% have been refreshed by the live drain**. Their newest notice is
2026-05-27 because those people have not appeared on a newer solicitation, which is real
historical coverage rather than decay. This family is **not superseded and not redundant** — it is
the same source's earlier generation, actively maintained.

**`sam_entities_pocs` — 82,017 rows covering 37,582 distinct UEIs / 37,461 companies / 6 role
types.** Substantial and entirely unique, but it is **supplier-contact coverage, not decision
makers**: no email, no agency, no notice.

## 7. Temporal value

Both government generations carry `posted_date` on 100% of rows (real source evidence). The vendor
family carries **no** `posted_date` at all — its only timestamps are Mindy's own `imported_at` /
`updated_at`, which the importer semantics do not support as source-observation times. So vendor
rows have **no defensible temporal evidence**, and none should be claimed for them.

For the 9,766 overlapping government identities the two generations agree on agency 99.98% of the
time, so overlapping rows read as *same person / same role, observed twice* rather than a role
change.

## 8. Provenance debt — the main truth metric

| | rows |
|---|---|
| `source` = `'sam_opportunities_poc'` | **287,534 (100%)** |
| `role_category` = `'contracting'` | **287,534 (100%)** |

Both columns are DEFAULTs that no producer ever sets, so they are uniform across the entire table
and carry zero information.

| class | rows |
|---|---|
| correctly attributed by `source_table` (as a *generation* label) | 287,528 |
| **`source` factually WRONG** — vendor entity POCs labelled opportunity POCs | **82,017** |
| **`role_category` factually WRONG** — vendors labelled government "contracting" | **82,017** |
| defaulted-but-unknown (`source`/`role_category` on the 205,517 gov rows — accidentally right, still unevidenced) | 205,517 |
| original source no longer reconstructable | **0** |
| government rows mislabelled as vendor | **0** |

**Nothing is unrecoverable.** `source_row_key` shape + field profile reconstructs the truth for
99.998% of rows, which is why this debt is a labelling problem rather than a data-loss problem.

## 9. Should vendor POCs live in `decision_makers`?

**Option A — keep in the same physical table, but explicitly typed.** Evidence:

- Separation is already structural and total (0 vendor rows pass either guard), so co-location
  creates no product risk today.
- They are the ONLY vendor-contact corpus we hold (37,582 UEIs) and deleting or orphaning them
  would lose it.
- A physical migration buys nothing until a supplier-contact product exists to own them.

**Storage** and **product semantics** are already cleanly separate; only the *labels* lie.

## 10. Recommended source-instance model

| source_key | authority | mode | state | producer | schedule | held | currentness | provenance | disposition |
|---|---|---|---|---|---|---|---|---|---|
| `decision_makers_sam_contacts` *(exists)* | SAM notice POCs | automated | current | `buyer-contact-run.ts` | `0 */2 * * *` | **205,517** (both generations) | **measurable** | good | keep |
| `vendor_entity_pocs` *(proposed, NOT created)* | SAM entity registrations | manual | **frozen** | `scripts/import-sam-entity-pocs.js` | none | **82,017** | **UNMEASURED** — no source timestamp exists | wrong labels | register + freeze |

**Two instances, not three.** The existing instance's `held_population` already equals 205,517
exactly, which independently confirms the two-generation model. The 82,017 vendor rows are
currently covered by **no** control-plane instance at all.

## 11. Frozen importer code

Four writers exist; **none is scheduled**, and **none deletes or truncates**.

| path | writes | state | rerun risk |
|---|---|---|---|
| `src/lib/gov-contacts/buyer-contact-run.ts` | live canonical | **active, scheduled** | n/a |
| `scripts/populate-contracting-officers.js` | `sam_opportunities_pointOfContact` | manual only, no npm script | ⚠️ **DANGEROUS** |
| `scripts/import-sam-entity-pocs.js` | `sam_entities_pocs` | manual only | low — idempotent refresh of 82K rows |
| `scripts/backfill-federal-contacts-from-rawdata.ts` | UPDATE only, scoped to `sam_entities_pocs` | manual only | low |

⚠️ **`populate-contracting-officers.js` is dangerous if re-run.** It writes the SAME key space as
the live producer (`<notice_id>::<idx>`) and **explicitly sets
`source_table: 'sam_opportunities_pointOfContact'`**. Re-running it would silently RELABEL live
rows back to the old generation — destroying the only attribution signal this audit relies on. It
is not destructive in the delete sense, which is exactly why the risk is easy to miss.

(Note: the script *does* map `sub_tier`; those 30,439 rows are NULL because
`sam_opportunities.sub_tier` was itself empty at import time in May, not because the script
omitted it. The live drain has since filled 28,831 of them.)

## 12. Customer-surface safety — NO ACTIVE LEAK

| surface | vendor exclusion | verdict |
|---|---|---|
| `/api/app/federal-contacts` (directory) | `department_ind_agency IS NOT NULL` | ✅ |
| `/api/app/federal-contacts` (office-roster, DoD) | `solicitation_number IS NOT NULL` | ✅ |
| `/api/app/federal-contacts` (office-roster, civilian) | `ILIKE department_ind_agency` — NULL never matches ILIKE | ✅ |
| `/api/app/federal-contacts` (subagency facet) | same ILIKE | ✅ |
| `/api/app/contacts-map` (Maps) | `solicitation_number IS NOT NULL` | ✅ |
| `contact-roster.ts` (MCP + app + reports) | `department_ind_agency IS NOT NULL` | ✅ |
| `events/query.ts` (buyer edge) | `solicitation_number ILIKE '<DoDAAC>%'` | ✅ |
| `market-report.ts` | delegates to `contact-roster.ts` | ✅ |
| `relationships/route.ts` | reads `opengov_iq_contacts` (**0 rows**), not `federal_contacts` | ✅ not a path |

**Not a P0.** Every listing surface applies a predicate no vendor row can satisfy.

⚠️ **One LATENT gap, deliberately reported as not-a-leak:** `buyer-detail.ts` fetches by
`.eq('id', id)` with **no** department/solicitation predicate, and `isUsableContactCard` does
**not** exclude vendors — its `hasOrg` check passes on the company sitting in `sub_tier`. A vendor
row would therefore render if its id were supplied directly. It is **not reachable through the
product**: every surface that emits a `federal_contacts.id` is predicate-guarded, so no listing
can hand a user a vendor id. Hardening (add the dept predicate, or teach `isUsableContactCard`
about vendor shape) belongs in the provenance pass, not an emergency fix.

## 13. Smallest provenance model

Existing columns are **sufficient if corrected** — no lineage system is needed.

| change | why |
|---|---|
| `contact_kind` (`government_buyer` \| `vendor_entity_poc`) | the one fact no column states today; derivable now, so backfill is deterministic |
| repurpose `source` to the real source key, or drop it | it is a uniform default carrying zero information and is wrong on 82,017 rows |
| `role_category` — stop defaulting to `'contracting'` | same defect; it asserts a role for vendor POCs |
| *(optional)* `source_generation` | rename of what `source_table` actually means; only if the label keeps causing confusion |

**Not needed:** `source_native_record_id` (SAM publishes no contact ID — established in the
identity audit), `source_observed_at` (`posted_date` already is it for government rows, and
nothing can supply it for vendor rows), a provenance state machine.

## 14. Disposition

| family | disposition |
|---|---|
| `AllSamContacts` | **KEEP_AS_ACTIVE_UNIQUE_COVERAGE** — the live canonical generation |
| `sam_opportunities_pointOfContact` | **KEEP_AS_ACTIVE_UNIQUE_COVERAGE** — *not* frozen; 94.7% re-adopted, 1,183 unique identities, same source as above |
| `sam_entities_pocs` | **KEEP_AS_HISTORICAL_EVIDENCE** — genuinely frozen, structurally separate, 37,582 UEIs, no currentness oracle possible; **REQUIRES_REPAIR** on its `source` / `role_category` labels |

Nothing is `SAFE_TO_ARCHIVE_LATER`; nothing should be deleted.

## 15. Interaction with person identity

- **Should frozen rows participate in email identities?** **Yes for `sam_opportunities_pointOfContact`** — same source, same key space, 99.98% agency agreement, and it contributes 1,183 identities found nowhere else. **No for `sam_entities_pocs`**: zero emails make participation impossible, not merely unwise.
- **Should vendor rows be excluded entirely?** **Yes**, from the government person model. They need their own model keyed on UEI + role.
- **Should historical government roles attach as observations?** **Yes** — both generations carry `posted_date`, so they are observations of the same identity, not competing records.
- **Should placeholder-heavy frozen rows carry lower confidence?** **Yes.** The older generation still has the higher placeholder rate measured in the identity audit (4.97% vs 1.89%), so weight name evidence by generation — though note the placeholder-name repair has since suppressed the worst shapes at the display layer.

## 16. Must be fixed BEFORE person identity materialization

1. **Set `contact_kind`** so the identity model can exclude vendors by a stated fact rather than by inheriting a query predicate.
2. **Stop `populate-contracting-officers.js` being runnable** (archive it, or strip its `source_table` write) — a re-run would relabel live rows and invalidate generation-based attribution.
3. **Register the vendor source instance** so 82,017 rows are not invisible to the control plane.
4. **Correct or drop `source` / `role_category`** — 82,017 factually wrong rows.

None blocks the drain. All are additive.

**Drain at audit end: 100,000 / 207,067 notices (48.3%), cursor `2026-06-20T01:01:07.963Z`,
`last_error` NULL, untouched by this audit.**

---

**READ ONLY — STOPPED FOR REVIEW.**
