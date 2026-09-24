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

## Run order (when approved; nothing run yet)
The code and the data must change in ONE window. Old code would re-insert starred ids; new code before the migration
would insert plain duplicates of group B, and those would carry new `created_at` values, i.e. false "new" rows.
1. Disable the `sync-forecasts` `cron_jobs` row. Verify it with `enabled`, then confirm no run starts.
2. Merge and deploy this PR, then verify the serving SHA.
3. `scripts/dhs-forecast-identity-migration.ts` dry run. Confirm 92 / 254 / 0 / 0.
4. `--go --sync-paused`. The backup file is written first. The post-check requires DHS rows = 1,738 and 0 starred ids.
5. Re-enable `sync-forecasts`. After the next 13:00 UTC run, confirm 0 new DHS rows with a `*` and 0 duplicate canonical ids.

**Rollback:**
- Code: revert the PR.
- Data: restore from the backup file. A rows are re-inserted and their content is restored; B rows are renamed back.
- The run order above keeps the two in step.
