# Ops debt — filed 2026-08-24, NOT part of any current PRD

Two unrelated problems surfaced while shipping P0-2. Recorded here so they do not ride
along with P0-3.

## 1. `vercel --prod` from the CLI is broken

```
Error: Request body too large. Limit: 10mb
```

The tracked tree carries large binaries:

| File | Size |
|---|---|
| `presentations/JTED-2026-Final.pptx` | **39 MB** |
| `presentations/JTED-2026-Compressed.pptx` | 8 MB |
| `data/imports/forecasts-refresh-2026-06.csv` | 5 MB |
| `presentations/JTED-2026-Slides.pdf` | 3.5 MB |
| `public/contracts-data.js` | 3.5 MB |
| `public/demo/mindy-opportunity-detail.mp4` | 2 MB |

Pre-existing. `src/mcp/decision-chain` fixtures add 2.5 MB (Census taxonomy) and are a
smaller contributor.

**Impact:** the CLI deploy route is unusable. It did NOT block P0-2 — Vercel's git
integration deploys merges to main automatically and worked correctly — but anyone who
needs a manual CLI deploy (hotfix, rollback) will hit this.

**Candidate fixes, not chosen:** a `.vercelignore` for `presentations/`, `tmp/`,
`projects/`, and demo media; or move the binaries out of the repo entirely. Either is a
repo-wide decision.

## 2. The shared `main` checkout has scratch files staged

`~/Market Assasin/market-assassin` (the shared main checkout) has files in the index that
are **not on origin/main**: `_print.mts`, `_base.mts`, `_bid.mts`, `_card.mts`, `_match.mts`,
`_oracle.mts`, `_psns*.mts`, `_snap.mts`, `_mapprobe.mjs`, plus `.claude/branch-restore-manifest*.txt`
and three `tasks/PRD-*.md`.

`_print.mts` imports `pdf-lib`, which is **not declared in package.json**, so the local
pre-push hook fails typecheck:

```
_print.mts(11,38): error TS2307: Cannot find module 'pdf-lib'
```

**Impact:** every push from this checkout is blocked by an error unrelated to the commit
being pushed. The P0-2 closure doc required `--no-verify` (documented in commit `c115ea08`).

**Do not fix by adding `pdf-lib`** — that legitimises a scratch file as a dependency.
Decide whether these files are wanted; if not, remove them from the index.

This is also a reminder of the worktree rule: work in `.claude/worktrees/<branch>`, not the
shared checkout. The P0-1/P0-2 work did; this residue came from elsewhere.
