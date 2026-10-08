# Release closeout: saved-search alert status (#1840, #1834, #1836, #1839), 2026-10-06

## Merges and deployment (all Git-triggered production deploys, Vercel status "success")
| PR | Reviewed/approved head | Merge commit |
|---|---|---|
| #1840 Marine Corps hierarchy filter + Forecast/Awarded disclosure | 31250678 | 6001c4c32792a8f296a9798ad3b4afd780437216 |
| #1834 malformed-search isolation + send-block classes | c816383b (approved; = 8a310e9f + one merge of main, route resolved as reviewed in #1839) | c742926603f1e5a201c14f0e168e726157afe88a |
| #1836 watchdog incidents + exhausted-retry exposure | 84d6fa4d | 885e2d35beed2875c5af6fda84137c1b15606dfb |
| #1839 search-first status, job-labelled status | a5a5c713 (approved; tree identical to reviewed 17fadd8c, fb4f2738) | 9bf4e42296de28edd4b8dffc6aabb8507d45da17 |

## Migration
`npm run migrate -- --go --only 20261005_ops_incidents.sql` from main @ 885e2d35. Ledger: `20261005_ops_incidents.sql | 4806ba030d52a4fb | baselined=false`. `public.ops_incidents`: RLS enabled + forced, one policy `ops_incidents_service` (service_role, ALL), no anon/authenticated/PUBLIC grants. Held Forecast migration `20260924_saved_search_forecast_watermark.sql` NOT in the ledger; `saved_searches.forecast_seen_through` absent.

## Deployment verification (production)
- `/opportunity-map` serves the #1840 Marine Corps check. Production Open API: `subAgency=Marine Corps` 13 open mapped notices (was 0 before #1840).
- Production MCP `list_market_schedules` (connected internal account) returns per-search `alert_status`: `delivered` with provider-accepted time and `inbox_delivery: not_observable`, `checked_no_alert_sent` with the recorded-only wording, and job status `partial_failure` labelled "saved-search alerts".
- Watchdog dry run before go-live: `storeAvailable: true`, response carries `abandoned` / `confirmFailed`; wrote nothing.

## Denise (denise@techprosllc.org): filter support vs account state, kept separate
- Filter support, production Open API (public filters, not her account): Marine Corps + 541611 + WOSB: 0 open, 1 across all statuses. DAI + 541611 + WOSB: 1 across all statuses (open count not queried via the API; DB read earlier: 0 open).
- Account status through the production saved-search API: NOT verified (requires her identity; not impersonated).
- Stored check state after the 2026-10-06 11:00 UTC run (DB, read-only): both searches evaluated (Marine Corps 11:00:31.391Z, DAI 11:00:30.786Z), `last_seen_notice_ids` = [] (0 open matches recorded as baseline), `total_alerts_sent` 0. The Marine Corps watch's first check ran on #1840's corrected filter (#1840 was live from ~09:0x UTC), so no old-filter baseline occurred. Catch-up implication: because the baseline is empty, any matching open notice seen on a later check is new to it.

## Scheduled checks (actual)
- 11:00 UTC (7 a.m. ET) saved-search-alerts run: `status=error`, `error=invalid_saved_naics=2,recipient_suppressed=3` (corrected #1834 classes; was `email_send_rejected=3` + `unexpected_schedule_error=1`). 128 daily searches due, 123 evaluated, 62 alerts provider-accepted to 33 recipients. The 5 not evaluated = 3 suppressed internal searches + 2 searches whose only NAICS (541510) is not a Census 2022 code.
- 12:00 UTC (8 a.m. ET) watchdog: incident `failing:saved-search-alerts` opened at 12:00:28 (processing `invalid_saved_naics: 2`, suppression `recipient_suppressed: 3`), `last_notified_event=opened`, pending cleared (Slack API accepted the post). Slack message text not read (no channel access from the session).
- 15:00 UTC (11 a.m. ET) watchdog: incident observed again (observations 2, last_seen 15:00:28), `last_notified_at` unchanged at 12:00:28: no repeat notification. No daily summary today (the only incident was notified this day).

## Remaining failures / held items
- `invalid_saved_naics=2`: two searches on the #1834 incident account store NAICS 541510 (not a real code). Correction is a customer decision (held; recovery preview exists in #1834).
- `recipient_suppressed=3`: three searches on one hard-bounced internal govconedu.com address. Held suppressed by decision.
- First daily summary: due on the first watchdog pass at or after 12:00 UTC 2026-10-07 if the incident is still open and unchanged. Pending.
- Recompete/Forecast cannot represent Marine Corps (disclosed, not broadened). 51 Navy notices with a truncated hierarchy path are not attributable.
- Forecast watermark migration still held.
