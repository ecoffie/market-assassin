# Lindy routes read a `briefing_log` column that does not exist (product / data correctness)

**Found:** 2026-10-04, during R1 part B production acceptance. **Status: OPEN, not fixed.**
**Class:** product/data correctness. Not a security issue, and not part of the R1 closeout.

## Fact (production, read-only)

- `briefing_log` (65,233 rows) has these columns:
  `id, user_email, briefing_date, briefing_content, briefing_html, briefing_sms, email_sent_at, sms_sent_at, delivery_status, email_opened_at, email_clicked_at, click_count, items_count, tools_included, error_message, retry_count, created_at, is_retry, original_failure_id, briefing_type`.
- `select('briefing_data')` fails: **`column briefing_log.briefing_data does not exist`**. `generated_at` does not exist either.

## Effect

- `GET /api/lindy/intelligence` selects `briefing_date, tools_included, briefing_data, generated_at`. The query errors and is logged, so the **`briefing` section of the response is always empty** for every user. Recompetes, contractor activity, the profile summary and recommended actions are unaffected.
- `POST /api/lindy/match` reads `briefing_data` to get the opportunities it scores, so its opportunity matches are always empty. Agency and pain-point matches still work.

## Fix direction (not started)

1. Read the briefing from the column that holds it: `briefing_content` (and/or `briefing_html`), with the `briefing_type` filter.
2. Map that shape into the `briefing` / opportunities fields the routes return.
3. Never fabricate a briefing.
4. Add a test against the real column list. Verify live with a connection key on a real briefing day.
