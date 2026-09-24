# DHS forecast identity — the republish `*` (2026-09-24) — FOR REVIEW, NOT RUN

**Status:** code + a dry-run migration script. **No production row was changed.** Blocks enabling the canonical Saved
Search Forecast engine (watermark model, PR stacked on #1674): under a `created_at` newness rule, every DHS republish
would be alerted as a "new" Forecast.

## Root cause
DHS prefixes `*` to the APFS number of a **republished** record. Measured on the live feed
(`apfs-cloud.dhs.gov/api/forecast`, 944 rows, 2026-09-24):

| | starred (185) | plain (759) |
|---|---|---|
| carries `previous_publish_date` | **185** | **0** |
| APFS digits == DHS numeric `id` | 185 | 759 |
| a starred and plain form of one number live at the same time | **0** | |

So the `*` is a publication-state flag. `cron/sync-forecasts` (and the dhs-apfs scraper) used the raw `apfs_number` as
`external_id`, so a republish inserted a **new** row with a **new `created_at`**, and the old plain row went stale.

In `agency_forecasts` today: DHS 1,830 rows · 346 starred · **92 plain/starred twins**. In all 92, the plain row is stale
and the starred row is newer and live. The FY and quarter always match, and the title matches in 80.
**Same source forecast, authoritative identity = the APFS number without `*` (== F<FY><id>).**

## Cross-publisher scan (35,939 rows, normalized id = upper, strip leading `*`, drop separators)
- **DHS: 92** (the `*` variants above).
- **NAVY: 2.** A contract number with and without hyphens (`N68936-20-D-0010` vs `N6893620D0010`). Both come from the
  2026-08-01 static import and neither is synced, so they cannot churn or alert under the watermark. It's a data-quality
  follow-up, not a cutover blocker.
- 12 numeric ids repeat across NASA/DOI. These are different publishers and distinct records, and the key is
  `(source_agency, external_id)`, so they are not collisions.

## References
Scanned `user_pipeline`, `pursuit_monitor_state`, `pursuit_change_log`, `pursuit_documents`, `anonymous_shortlist`,
`user_saved_opportunities` for the starred rows (uuid, `fc-<uuid>`, external_id):
- **0 references to starred twin rows.**
- 1 pursuit (+ its monitor row) references the **plain** twin `F2025072137` by uuid. That is why the merge keeps the plain
  row's uuid.
- Legacy `saved_searches.last_seen_notice_ids`: 9 searches hold 222 starred/plain ids. They are irrelevant under the
  watermark engine, which keeps no Forecast ids.

## Change (branch `fix/dhs-forecast-identity`)
- `src/lib/forecasts/dhs-identity.ts`: `canonicalDhsApfsNumber` / `canonicalDhsExternalId` / `isDhsRepublished`.
- `cron/sync-forecasts` and `scrapers/dhs-apfs.ts` use it. `scripts/import-forecasts-live.js` is RETIRED ("DO NOT RUN,
  DO NOT FIX") and already unparseable on main, so it is deliberately untouched.
- `scripts/dhs-forecast-identity-migration.ts`: dry run by default. The dry run against production gives:
  - **A: 92 twin merges.** Keep the plain uuid and `created_at`, take the starred row's current content, re-point
    references, delete the starred row.
  - **B: 254 in-place renames.** The uuid and `created_at` are unchanged.
  - 0 collisions and 0 references to re-point.
  - Expected result: 1,738 DHS rows, 0 starred ids.
- Tests: `dhs-identity.unit.test.ts`.

## Migration assertions (added 2026-09-24 after review)
`scripts/dhs-forecast-identity-migration.ts`:

| mode | refuses / asserts |
|---|---|
| dry run | prints twins, renames, canonical collisions after twin handling, the reference census, and the `sync-forecasts` pause state |
| `--go` | **refuses unless** the `sync-forecasts` cron_jobs row is `enabled=false`, `--expect-twins`/`--expect-renames` equal the live counts (reviewed or refreshed), and there are 0 collisions. Writes a backup first. **After** writing it asserts: rows = before − twins; 0 starred ids; reference count unchanged; no reference points to a deleted row; kept rows keep their uuid and `created_at`; no write errors |
| `--check-resume --fix-sha <sha>` | gate before re-enabling the sync: 0 starred ids AND the serving production build (the `maps-account-build` stamp) contains the ingest fix |
| `--verify-after-sync --since <iso>` | after the first resumed sync: 0 new starred rows, 0 duplicate canonical ids |

**Measured on production 2026-09-24 (read only):**
- 1,830 DHS rows, 346 starred. **92 twins, 254 renames, 0 collisions.**
- Reference census: **14** references to DHS rows, **0** of them to a starred twin.
- `sync-forecasts` is enabled, so a real `--go` attempt **refused before writing anything**.

**Republish after migration:** `scripts/proofs/dhs-republish.pglite.ts` executes the sync's exact upsert shape
(`ON CONFLICT (source_agency, external_id) DO UPDATE`, payload without `created_at`) in PGlite. A republished
`*F2026073903` updates the canonical `F2026073903` row: 1 row, the same uuid, the same `created_at`, the new content.
The negative control shows that the raw starred id would have created a second row. The two facts it relies on (the
conflict key, and no `created_at` in the DHS payload) are pinned statically by `dhs-identity.unit.test.ts`.

## Run order (when approved; nothing run yet)
The code and the data must change in ONE window. Old code would re-insert starred ids; new code before the migration
would insert plain duplicates of group B, and those would carry new `created_at` values, i.e. false "new" rows.
1. Disable the `sync-forecasts` `cron_jobs` row, then confirm no run starts.
2. Merge and deploy this PR.
3. Dry run. Confirm the counts (92 / 254 / 0 collisions) or review the refreshed ones.
4. `--go --expect-twins <N> --expect-renames <M>`. It refuses if the sync is running or the counts moved.
5. `--check-resume --fix-sha <merge sha>`. It must print "safe to resume".
6. Re-enable `sync-forecasts`. After its next run, `--verify-after-sync --since <resume time>`.

**Rollback:**
- Code: revert the PR.
- Data: restore from the backup file. A rows are re-inserted and their content is restored; B rows are renamed back.
- The run order above keeps the two in step.
