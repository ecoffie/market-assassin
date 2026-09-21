# SAT Backfill Audit Prompt

Use this as the repo-verified baseline for future Codex work on SAT backfill behavior.

## Verified Claims

| Prompt claim | Verified? |
|--------------|-----------|
| Pass 3 + `parseAwardAmount` in `find-agencies` | Yes - lines around 385, 462, 752 |
| GET backfill: cache -> profile NAICS -> live find-agencies -> persist | Yes - `enrichTargetsSat()` in `target-list/route.ts` |
| UI reads `sat_ratio` only | Yes - `MyTargetListPanel.tsx` |
| No `ENABLE_MINDY_INSIGHTS` for SAT | Correct - only used in `daily-alerts/route.ts` |
| Do not add Entry Accessibility table | Correct - user explicitly rejected that approach |
| Commits `1a5a77b`, `b1259f2` | Match session history |

## Gaps To Keep In Mind

1. First target-list load can be slow. Live `find-agencies` is one call per GET when cache misses; acceptable but worth noting in reports.
2. Profile must have NAICS. If `user_notification_settings.naics_codes` is empty, live backfill skips because `stillNeedLive` is false.
3. Office name matching is fuzzy. `normalizeOfficeName` plus substring matching may still miss odd `office_name` values.
4. `sat_backfill_persisted` is only in the API response. The UI does not surface it, so do not expect a UI change unless explicitly asked.

## Optional Tightening

Add `source_naics` and `source_psc` columns on `user_target_list` in migration `20260522_user_target_list.sql`, then connect provenance Slice 5b so cache lookup can prefer per-target keys before falling back to profile NAICS.
