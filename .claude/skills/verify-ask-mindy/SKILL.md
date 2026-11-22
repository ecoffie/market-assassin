---
name: verify-ask-mindy
description: Customer-level verification of Ask Mindy answers. Drives the regression prompts through the real chat route on a preview deployment (or local dev) with a signed-in TEST account, grades every answer against its tool evidence, and compares before/after so a regression on any scenario blocks release. Use for every PR that changes Ask Mindy answers.
---

# verify-ask-mindy

Proves an Ask Mindy change against what a customer actually gets, not against unit tests. Modelled on pstack's
create-verification-skill (Launch → Doctor → Drive → Evidence → Cleanup). Reuses `scripts/ask-mindy-baseline.mts`
and `src/lib/chat/eval/grade.ts`; scenarios live in `tests/fixtures/ask-mindy-regression.json` (R1–R10).

**Release rule:** every PR that changes Ask Mindy answers attaches the before/after table from step 4. Any
scenario that gets worse (pass → partial/fail, partial → fail, or graded → missing) blocks release.

## Hard limits (never relax)

- **Test account only.** Never a real customer's account, Vault or session. Never enter a password or one-time
  code (CLAUDE.md rule 8): use an MI auth token from an already signed-in test session, supplied by the operator.
- **Preview or local, never production.** Trace events (the evidence the grader needs) are off in production by
  design (`ASK_MINDY_TRACE_EVENTS` is ignored when `VERCEL_ENV=production`).
- **Flags only through allowlist mode, for the test email only** (`ASK_MINDY_RULES_LAYER` / `ASK_MINDY_RECIPES` =
  `allowlist` + `*_ALLOWLIST=<test email>`), on the preview environment. Setting any flag is the release
  coordinator's action (Agent 4), not the harness's.
- **Evidence stays outside the repo** (answers can carry customer-adjacent data). Default output: the OS temp dir.
- Never commit, share or paste answers that contain a real company's data.

## 1. Launch

Pick one target and record which commit it serves.

- **Preview (preferred):** the Vercel preview URL for the PR's head commit (the Vercel bot comment on the PR).
  The preview must have `ASK_MINDY_TRACE_EVENTS=true` and `ASK_MINDY_TRACE_RESULT_CHARS=200000`.
- **Local dev:** `ASK_MINDY_TRACE_EVENTS=true ASK_MINDY_TRACE_RESULT_CHARS=200000 npm run dev` with a linked
  `.env.local` (`npm run env:link-worktree -- <worktree>`; never a hand-typed symlink).

## 2. Doctor (refuse to drive if any check fails)

1. **Build stamp.** The health endpoint publishes no commit by design, so map the preview to its commit through
   GitHub: `gh api "repos/ecoffie/market-assassin/deployments?sha=<head sha>" --jq '.[0].id'` then
   `gh api repos/ecoffie/market-assassin/deployments/<id>/statuses --jq '.[0].environment_url'` must equal the
   target URL. Local: `git rev-parse HEAD`.
2. **Signed-in test session.** `MI_AUTH_TOKEN` is set (from the operator) and belongs to the test email: a single
   `POST /api/app/chat` with `{ email, message: "ping" }` returns `200` and an SSE `session` event, not `401`.
3. **Trace on.** That same ping's stream contains `trace` events. No trace → the grader cannot see evidence: stop.
4. **Flag state matches the run's intent.** Record the expected flags for this run (off for a "before" run on
   main; allowlist-on for the PR's "after" run when the PR is flag-gated). Confirm from the turn trace notices of
   a FIND prompt (for example `fit_ranking_note` appears only when `ASK_MINDY_RECIPES` is on for the test email).

## 3. Drive

```bash
npx tsx scripts/ask-mindy-baseline.mts --host <target> --email <test email> --out /tmp/ask-mindy/<label>
# token from MI_AUTH_TOKEN (or --token). Subset: --only R1,R3
```

Each scenario's prompt is sent through the real `/api/app/chat` route with an empty history. The script saves
`<id>.json` (answer, tool evidence, notices, grade) and `summary.json` per run, and exits non-zero unless every
scenario passes (partials are never passes).

## 4. Evidence and before/after

- **Re-grade without model calls:** `npx tsx scripts/ask-mindy-baseline.mts --regrade /tmp/ask-mindy/<label>`.
- **Before/after table (attach to the PR):**
  `npx tsx scripts/ask-mindy-baseline.mts --compare /tmp/ask-mindy/before /tmp/ask-mindy/after --md /tmp/ask-mindy/table.md`
  (use `official` as the before side to compare with the recorded 2026-11-13 baseline). Exit 1 on any
  regression.
- **Baseline proof (one-time, per harness change):** a run against commit `f03700fd` (where the official
  baseline was recorded: 1 pass, 2 partial, 7 fail) must reproduce that per-scenario result, and
  `--compare official <run>` must exit 0 for it; a run of a deliberately worse build must exit 1.

## 5. Cleanup

- Delete the run directories when the PR is merged (`rm -rf /tmp/ask-mindy/<label>`); keep only `table.md`.
- Revert any preview allowlist the coordinator set for the run.
- Nothing is written to the repo, the database or any customer record by this harness.

## Features (per recipe)

- `features/where-to-start.md`
- `features/opportunity-deep-dive.md`
- `features/profile-setup.md`
