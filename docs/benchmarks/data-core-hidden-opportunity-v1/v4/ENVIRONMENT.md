# Running the v4 benchmark harness on any machine

Credentials are never committed, copied into this directory, or hardcoded. All v4 scripts load them through `scripts/bench-env.mts`.

## How credentials are found

The first source that supplies every required key wins:

1. **Variables already exported** in the shell: `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (required), `OPENAI_API_KEY`
   (optional; needed only when a new query phrasing must be embedded).
2. **`MINDY_BENCH_ENV_FILE=/path/to/file`**: an env file outside Git.
3. **`<evaluation worktree>/.env.local`**: the checkout passed as the working directory.

The loader **fails closed**. It stops with a clear error when the file is missing, is an unreadable or self-referencing symlink, lacks a required key,
or is tracked by Git. It never prints values. (A silent loader that "continues with zero variables" is the failure CLAUDE.md warns about.)

The harness only reads: `sam_opportunities` via the service role, and the production FIND code in the evaluation worktree. It writes only to the
output directory you pass it.

## Setup on a new machine (e.g. the Mac Studio)

```bash
# 1. The main checkout needs its own regular .env.local, provisioned by Eric/infra.
#    Do not copy it from another repo or commit it.
cd /Users/ericcoffie/mindy-studio && vercel env pull .env.local     # read-only pull of existing settings

# 2. A throwaway evaluation worktree at the commit being evaluated (production SHA or Agent 3's candidate)
git worktree add .claude/worktrees/a4-eval <sha>
npm run env:link-worktree -- .claude/worktrees/a4-eval
(cd .claude/worktrees/a4-eval && npm ci && git apply <bench>/v4/scripts/observer.diff)   # one-line read-only observer, never committed

# 3. Run from inside the evaluation worktree; OUT holds queries_v4.json, a3_matched_sets.json and the outputs
cd .claude/worktrees/a4-eval && npx tsx <bench>/v4/scripts/harness_r4.mts <OUT>
```

Without step 1, use option 2 instead: `MINDY_BENCH_ENV_FILE=/secure/path/bench.env npx tsx …`.
`review/build_review_page.py` resolves the benchmark directory relative to its own location, or from `MINDY_BENCH_DIR`.

## Inputs that are not in Git

| File | Why | How to recreate |
|---|---|---|
| Open-corpus capture (≈ 120 MB, text + vectors) | Size | The harness re-captures it at the run's snapshot time |
| `vcache_v4.json` (query vectors) | A cache | Rebuilt on first run (14 embedding calls) |
| `a3_matched_sets.json` | Agent 3's input | Copy Agent 3's committed matched-sets file; the harness stops with a message if it is missing |

## Status on the Mac Studio (2026-11-14)

`/Users/ericcoffie/mindy-studio` has **no `.env.local`**, so step 1 is outstanding (Eric/infra). The harness no longer depends on any
MacBook path. Older v1–v3 scripts still carry MacBook paths. They are kept unchanged as the historical record of those runs and are not used for the holdout.
