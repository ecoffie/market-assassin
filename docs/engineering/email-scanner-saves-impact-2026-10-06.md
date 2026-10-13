# Impact report: pipeline rows created by email link scanners

**Date:** 2026-10-06. **Type:** read-only. Nothing was changed, deleted or rewritten.
**Fix:** the scanner-safe confirmation flow is a separate PR (`fix/email-save-confirmation`). This
report sizes the damage already done, so remediation can be proposed with the scope in view.
**Public repo:** aggregate counts only. Per-user detail stays in the database.

## What happened
The daily alert's "Track in Mindy" link was
`GET /api/actions/add-to-pipeline?...&token=…&source=daily_alert`, and that GET **inserted a
`user_pipeline` row**. Mail security scanners (Safe Links-style rewriting, gateway sandboxes, link
previews) fetch every link in a message on delivery, so a save happened whether or not anyone
clicked. The pattern is unmistakable:
- saves land within seconds of the alert being sent;
- several saves from one alert land milliseconds apart (median 53 ms, 94% within 1 s, for alerts
  with ≥ 2 fast saves);
- email events store no user agent, so the timing is the evidence.

## Classification (every `source='daily_alert'` row, 2026-07-17 .. 2026-10-06)
Seconds from save back to the most recent alert sent to that user that contained the notice
(`alert_log.opportunities_data[].noticeId`, within 2 days). "Burst" = another `daily_alert` save for
the same user within ±1 s.

| Tier | Rule | Rows | Users | Acted on* | Archived | Untouched |
|---|---|---|---|---|---|---|
| **T1 high-confidence automated** | < 120 s after send **and** burst | **3,198** | 132 | 0 | 3 | 3,195 |
| **T2 probable automated** | < 120 s after send, no burst | **2,080** | 160 | 4 | 2 | 2,076 |
| T3 indeterminate | 2 min – 1 h | 498 | 162 | 3 | 5 | 491 |
| T4 likely human | > 1 h | 695 | 304 | 4 | 8 | 684 |
| T5 unmatched | no alert with that notice in the prior 2 days | 8 | 7 | 0 | 2 | 6 |
| **Total** | | **6,479** | 465 | 11 | 20 | 6,452 |

\* Acted on = stage moved off `tracking`, notes, next action, bid decision, or any `pipeline_history`
entry. Archiving is counted separately. 4 rows are both acted on and archived, so the columns overlap.

**T1 + T2 = 5,278 suspected automated rows (81.5% of all email saves).** Only 4 of them were ever
acted on.

## Who is affected
- **161** users hold at least one suspected row.
- For **147** of them, suspected rows are the **majority of their active pipeline**, and for **45**
  they are the entire pipeline.
- Median 20 suspected rows per affected user; the largest single pipeline holds 106.

## Downstream effects already incurred
| Effect | Count | Note |
|---|---|---|
| Pursuit change alerts generated on suspected rows | **3,470** | the pursuit-changes monitor watches every non-archived pipeline row with a notice id |
| …of which **emailed** to the user | **3,408** | "your pursuit changed" emails about opportunities the user never chose |
| Document auto-fetch triggered | 5,278 | `fetchPursuitDocsAuto` ran for every suspected row (compute and storage) |
| Decision-time stamps (OBS-007) | not counted here | rows saved after stamping began (2026-08-03) were floored to the save time, which is the main cause of OBS-007's median of 0 (see the OBS audit) |

These effects **continue daily until the fix deploys**. The most recent suspected rows are from
2026-10-06.

## What this report does NOT establish
- **Intent per row.** T1 is near-certain automation. T2 includes a small number of people who really
  did click within 2 minutes. T3 and T4 may also contain scanner re-fetches (some gateways re-scan
  later), so T4 is "likely human", not "human".
- **Briefing emails** use the same link with other `source` values (`briefing`, about 111 rows). They
  were not joined to a send log here, so they are not classified.
- **Other side-effecting email GETs** (for example feedback thumbs links) are the same class of risk
  and were not measured here.

## Remediation options (proposals only; none applied, each needs approval)
1. **Stop the bleeding first:** ship the confirmation-flow fix. Until then, new suspected rows keep
   arriving.
2. **Suppress side effects without touching rows:** have the pursuit-changes monitor and the docs
   auto-fetch skip T1/T2 rows. This is reversible and stops the change-alert emails immediately.
3. **Mark, don't delete:** flag T1/T2 rows (for example `auto_added_from_email = true`), show them
   as "Added automatically from an email, keep or remove?", and let each user decide. This is the
   conservative customer-facing option.
4. **Archive T1 after notice:** archive untouched T1 rows (3,195), reversibly via `is_archived`,
   after telling affected users. Do not hard-delete.
5. **Leave T3/T4 alone** unless the user removes them.

Any bulk write in 2–4 follows the bulk-action rule: count, filter definition and a sample row first,
then a dry run, then explicit approval.

## Appendix: the classification query (read-only)
```sql
with p as (
  select id, user_email, notice_id, created_at, stage, notes, next_action, bid_decision, is_archived
  from user_pipeline where source = 'daily_alert'),
g as (
  select p.*,
    (select extract(epoch from (p.created_at - max(a.sent_at))) from alert_log a
      where a.user_email = p.user_email and a.sent_at <= p.created_at
        and a.sent_at > p.created_at - interval '2 days' and p.notice_id is not null
        and a.opportunities_data @> jsonb_build_array(jsonb_build_object('noticeId', p.notice_id))) as secs,
    exists (select 1 from user_pipeline q where q.source = 'daily_alert' and q.user_email = p.user_email
        and q.id <> p.id and q.created_at between p.created_at - interval '1 second'
                                          and p.created_at + interval '1 second') as burst,
    (p.stage <> 'tracking' or p.notes is not null or p.next_action is not null or p.bid_decision is not null
       or exists (select 1 from pipeline_history h where h.pipeline_id = p.id)) as acted_on
  from p)
select case
   when secs is null then 'T5 unmatched'
   when secs < 120 and burst then 'T1 high-confidence automated'
   when secs < 120 then 'T2 probable automated'
   when secs < 3600 then 'T3 indeterminate'
   else 'T4 likely human' end as tier,
 count(*) as rows, count(distinct user_email) as users,
 count(*) filter (where acted_on) as acted_on, count(*) filter (where is_archived) as archived
from g group by 1 order by 1;
```
