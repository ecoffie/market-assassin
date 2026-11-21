# Nightly agent team: playbook

A scheduled cloud session runs this every night. It finds problems in Mindy, builds small fixes as **draft PRs**, has an independent agent verify each one, writes what it learned, and reports.

Root `CLAUDE.md` overrides everything here. In particular: the team is a **builder**. It never merges, never deploys, never runs `vercel --prod|promote|rollback|redeploy`, never runs `npm run migrate -- --go`, never changes production env vars or feature flags, and never contacts customers. Eric approves every merge.

## Roles

| Role | Agent | Model tier | Job |
|---|---|---|---|
| Orchestrator | the scheduled session | default | Reads memory, runs the phases, keeps the budget, writes the report |
| Scout | `team-scout` | sonnet | Finds candidate problems, read-only, returns a ranked list with evidence |
| Fixer | `team-fixer` | default | One problem each, in its own worktree, test first, then fix |
| Verifier | `team-verifier` | sonnet | Never sees the fixer's reasoning. Checks out the diff, re-runs tests and the reproduction, says pass or fail |

## Run order

1. **Read memory first.** Read the lessons and the last 3 runs from the team dashboard store (`data/team/lessons`, `data/team/runs`, `data/team/fixes`). Skip any candidate that already has an open fix.
2. **Scout** (one agent, read-only). Sources, in this order:
   - Production errors: Vercel runtime errors for project `market-assassin` (last 24h); `cron_job_runs` rows with `http_status` not 200 (last 24h) via `npm run db`.
   - Data integrity: `npm run verify:oracles`, `npm run verify:search`, `npm run verify:data` when the env allows; feeds whose newest row is older than their schedule.
   - GitHub issues: open issues in `ecoffie/market-assassin`, smallest and clearest first.
   - Product: walk getmindy.ai pages that need no login with Playwright, at desktop and phone width; note broken links, console errors, layout overflow, slow pages.
   Each candidate needs: a one-line symptom, the evidence (query, log line, screenshot path), the likely files, and a size guess (S/M/L).
3. **Pick up to 3** candidates. Skip L size. Skip anything in a FROZEN, PARKED or BLOCKED entry of `CLAUDE.md` "In-flight work". Mark `risk: review` on any fix that touches payments/Stripe, auth or access control, env vars or flags, or migrations; those can still get a draft PR but the report must say they need Agent 4 review.
4. **Fix** (one `team-fixer` per candidate, `isolation: worktree`, run in parallel). Rules: reproduce first; write a failing test; fix at the real layer (data before cache before render); mirror app fixes into the matching MCP tool/shared lib (`CLAUDE.md` rule 9); run `npx tsc --noEmit` and the related vitest files.
5. **Verify** (one `team-verifier` per fix). Give it only the branch/diff, the original symptom and evidence, and the test command. Not the fixer's explanation.
6. **Open draft PRs** only for fixes the verifier passed. Push through the pre-push gate (never `--no-verify`). PR body starts with an **"In plain English"** section: what a user saw before, what they see now, and what did not change, written for a non-engineer with no file names or jargon. Then the technical part: symptom, cause in one sentence, evidence before/after, tests run, verifier verdict, risk flag. If the session may push to only one branch, put each fix in its own commit on that branch and open one draft PR listing them.
7. **Learn.** For each failure or surprise, write a lesson only if it is a checked fact that would change what a future run does. Reword it as a general rule. No customer data, emails, secrets or private notes in lessons.
8. **Report.** Write the run, fix and lesson records to the dashboard store, then send a short push notification: found / built / passed / waiting on Eric.

## Budget and stop rules

- At most 3 fixes and 8 agents per night.
- A fixer that cannot reproduce stops and reports "not reproduced"; that is a valid result.
- Two verifier fails on the same fix: drop it and log a lesson.
- If the Scout finds nothing worth fixing, the run still writes a run record and says so.

## Dashboard records

Collection `data/team/runs`, doc id = run date `YYYY-MM-DD`:
`{date, found, prs, passed, failed, summary, next}`

Collection `data/team/fixes`, doc id = `YYYY-MM-DD-<slug>`:
`{id, date, title, plain, area: "prod-error"|"data"|"issue"|"improvement", verdict: "pass"|"fail"|"pending", state: "open"|"merged"|"closed"|"not built", pr_url, risk: "normal"|"review", notes}`

`plain` is 2–3 sentences in plain English (no file names or jargon) saying what was wrong and what changed for users. The dashboard shows it under the title.

Each night also refreshes `state` on older open fixes from GitHub (merged/closed).

Collection `data/team/lessons`, doc id = `YYYY-MM-DD-<n>`:
`{date, lesson, source}`
