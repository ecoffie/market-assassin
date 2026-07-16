Is a backfill/drainer actually draining, or is it stalled? Job: $ARGUMENTS

The question is never "did it run" — it's **drained vs progressing vs stalled**. A job that runs every hour and moves 0 rows looks identical to a healthy one in the logs.

## 1. Is it even scheduled?

Crons are `cron_jobs` rows, **not** `vercel.json`. The dispatcher ticks roughly HOURLY, so a `*/10` expression really fires ~once an hour.

```bash
npm run db -- cron_jobs --select job_name,cron_expr,enabled,last_run --eq enabled=true
```

Columns are `job_name` / `enabled` / `cron_expr` — **not** `name` / `active`. No row, or `enabled=false`, is the answer: it never ran.

## 2. How much is left?

Find the drainer's "remaining" predicate (usually the same `.is(col, null)` / `.eq(status,'pending')` its route filters on) and count it:

```bash
npm run db -- <table> --count
npm run db -- <table> --eq <status_col>=pending --count
```

Run it **twice, a few minutes apart**. The delta is the only honest signal:

- count **falling** → progressing. Report the rate and the ETA.
- count **0** → drained. Done.
- count **flat but > 0** → **STALLED.** This is the real finding.

## 3. If stalled, why?

Most drainers here are batch + resumable and return `remaining` — hit the route and read it. Usual causes:

- the dispatcher window closed before the batch drained (needs more invocations, not a bigger batch)
- a soft-timeout budget ending each run early
- every remaining row erroring identically (check `tool_errors`)
- the batch size is smaller than the arrival rate — it can never catch up
- an upstream key/quota is failing silently (the row is skipped, not retried)

## 4. Report

`<job>: N remaining · was M five minutes ago · <progressing|stalled|drained>`. If stalled, name the cause and the fix. Never report "it's running" as if that were progress.
