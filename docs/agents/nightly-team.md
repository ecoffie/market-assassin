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
2. **Scout** (one agent, read-only). **Focus: conversions and marketing** (set 2026-11-21). Two lanes:

   **Conversion and marketing lane (2 slots a night).** Sources:
   - **Signup and checkout flow:** walk landing → signup → plan choice → Stripe checkout page (stop before paying) with Playwright at desktop and phone width. Note errors, dead ends, slow steps, confusing or missing calls to action, broken redirects. Funnel numbers from `signup_attribution` / `purchases_canonical` / `user_engagement` when DB access exists, else "not checked". Never complete a purchase, never create real accounts beyond what a test needs, never enter passwords or codes.
   - **Landing and pricing pages:** clarity of headline and call to action, page speed, mobile layout, broken links, Vercel Web Analytics (top pages, bounce, referrers) via the Vercel MCP.
   - **SEO:** titles, meta descriptions, canonical tags, `noindex` mistakes, sitemap and robots, soft 404s, broken internal links, structured data, Core Web Vitals.
   - **Onboarding and emails:** first-use screens after signup, empty states, welcome and onboarding email templates. Email work is template code only, always via `sendEmail()`; never send an email or contact a customer.

   **General bug lane (1 slot a night).** Production errors (Vercel runtime errors, `cron_job_runs` not 200), data-integrity checks, and open GitHub issues, as before.

   Marketing rules: no changes to prices, plans, credits or plan terms (`src/lib/mcp/packages.ts` is the pricing authority, and `CLAUDE.md` freezes public pricing copy until Eric approves it). Every claim or number in copy must be true and sourced (`docs/agents/data-integrity.md`): no invented stats, testimonials or superlatives. Copy changes are proposals for Eric: the PR shows before/after text and why.
   Each candidate needs: a one-line symptom, the lane, the evidence (query, log line, analytics figure, screenshot path), the likely files, and a size guess (S/M/L).
3. **Pick up to 3** candidates: the best 2 from the conversion lane and the best 1 from the bug lane. If one lane has nothing worth fixing, the other may use the slot. Skip L size. Skip anything in a FROZEN, PARKED or BLOCKED entry of `CLAUDE.md` "In-flight work". Mark `risk: review` on any fix that touches payments/Stripe, auth or access control, env vars or flags, or migrations; those can still get a draft PR but the report must say they need Agent 4 review.
4. **Fix** (one `team-fixer` per candidate, `isolation: worktree`, run in parallel). Rules: reproduce first; write a failing test (for copy, SEO or layout work: a test that asserts the new title, meta tag, link or text, plus before/after screenshots at desktop and phone width); fix at the real layer (data before cache before render); mirror app fixes into the matching MCP tool/shared lib (`CLAUDE.md` rule 9); run `npx tsc --noEmit` and the related vitest files.
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
`{id, date, title, plain, lane: "conversion"|"bug", area: "signup-checkout"|"landing-pricing"|"seo"|"onboarding-email"|"prod-error"|"data"|"issue", verdict: "pass"|"fail"|"pending", state: "open"|"merged"|"closed"|"not built", pr_url, risk: "normal"|"review", notes}`

`plain` is 2–3 sentences in plain English (no file names or jargon) saying what was wrong and what changed for users. The dashboard shows it under the title.

Each night also refreshes `state` on older open fixes from GitHub (merged/closed).

Collection `data/team/lessons`, doc id = `YYYY-MM-DD-<n>`:
`{date, lesson, source}`
