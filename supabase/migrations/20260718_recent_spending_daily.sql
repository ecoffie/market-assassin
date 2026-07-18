-- Bump build-recent-spending from weekly (Mon) to daily so the landing's
-- "Latest Big Contracts" panel actually changes often (feedback: the static NAICS
-- leaderboard was replaced by this fresher feed). Idempotent.
UPDATE cron_jobs
   SET cron_expr = '0 8 * * *',
       notes = COALESCE(notes, '') || ' [daily as of 2026-07-18 — feeds /mindy-landing Latest Big Contracts]'
 WHERE job_name = 'build-recent-spending'
   AND cron_expr <> '0 8 * * *';
