-- SECURITY — remove inline credentials from cron_jobs.route values.
--
-- ── WHAT WAS WRONG ─────────────────────────────────────────────────────────
-- `snapshot-multisite-nih` (and its darpa/nsf siblings) stored the live admin
-- password as a `?password=` query parameter inside `cron_jobs.route`. A
-- credential in a database column is readable by anything that can SELECT the
-- table, is echoed into dispatcher logs on every run, and appears in any routine
-- audit of the schedule.
--
-- ── WHY IT WAS THERE ───────────────────────────────────────────────────────
-- The route accepted only `x-vercel-cron-secret` or `?password=`. The dispatcher
-- sends `Authorization: Bearer $CRON_SECRET` — neither — so the scheduled job
-- could not authenticate without the inline password. The companion code change
-- makes the route accept the dispatcher's own mechanism, which removes the
-- reason the secret was ever inlined.
--
-- ── THIS MIGRATION NEVER HANDLES THE SECRET ────────────────────────────────
-- It does not contain, compare against, or log the credential. It strips ANY
-- `password=` parameter by pattern, so it is correct whatever the value is, and
-- safe to read in a diff or a log.
-- ⚠️ SCOPE: ONLY routes served by THIS application.
--
-- Eight cron_jobs rows carry an inline `?password=`. Five of them
-- (mindy-heads-up, mindy-live, mindy-morning, mindy-lifetime-extension,
-- mindy-lifetime-finalclose) point at https://govcongiants.com — a DIFFERENT
-- application whose auth lives in the govcon-funnels repo. The dispatcher's
-- Authorization: Bearer $CRON_SECRET would not be accepted there, so stripping
-- their password from here would simply break them. They are recorded as known
-- debt in tests/fixtures/cron-route-credential-baseline.json and must be fixed
-- in that repo.
--
-- This migration touches only the three `/api/cron/snapshot-multisite` rows,
-- whose auth this PR just fixed.
UPDATE public.cron_jobs
SET route = regexp_replace(route, '([?&])password=[^&]*(&|$)', '\1', 'g'),
    notes = coalesce(notes, '') ||
      ' | SECURITY 2026-09-21: inline ?password= stripped from route. The dispatcher'
      || ' authenticates with Authorization: Bearer $CRON_SECRET, which the route now'
      || ' accepts. ROTATE the previously-inlined admin credential — it was stored in'
      || ' this column and echoed in dispatcher logs.'
WHERE route ~ '[?&]password='
  AND route LIKE '/api/cron/snapshot-multisite%';

-- Leave no dangling separator behind ("...&" or "...?").
UPDATE public.cron_jobs
SET route = regexp_replace(route, '[?&]+$', '')
WHERE route ~ '[?&]+$'
  AND route LIKE '/api/cron/snapshot-multisite%';

-- A route ending '?' with no params left is equally tidy-able above; both forms
-- are handled. Nothing else about the schedule changes: job_name, cron_expr,
-- enabled, timeout_ms and the route PATH are untouched.
