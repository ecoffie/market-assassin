# Release, worktrees and the pre-push gate

> Moved verbatim from the root `CLAUDE.md` on 2026-11-17 (instruction cleanup). Nothing was removed; wording changed only where marked **[Release control 2026-11-17]**. Root `CLAUDE.md` rule 15 overrides anything here.

## ⚠️ Sharing `.env.local` into a worktree — use the helper, never raw `ln -sfn`

```bash
npm run env:link-worktree -- .claude/worktrees/<name>
```

**Never run `ln -sfn "<MAIN>/.env.local" .env.local` by hand.** That command is
correct from a worktree and **destroys the file** from the main repo: source and
destination become the same path, `ln -sfn` replaces the real `.env.local` with a
link to itself, and every later read fails with ELOOP. dotenv does **not** throw on
an unreadable path — callers silently run with **zero variables**. It has happened
twice (2026-09-05, 2026-09-13), the second time mid-way through a five-stage
database migration's pre-flight.

**The destination must be an explicit argument.** Do not assume the shell cwd
persisted between tool calls — an agent's cwd can be reset back to the main repo
between commands, so a `cd <worktree> && ln -sfn …` whose `cd` did not stick runs
in the main repo. The helper takes the worktree path explicitly and never infers it
from `process.cwd()`.

**If the helper refuses, diagnose the topology — do not bypass it.** The contract,
enforced by BOTH the helper and `npm run verify:env`:

| where | valid | invalid |
|---|---|---|
| **main** worktree | a REGULAR file | any symlink |
| **linked** worktree | a regular file, or a symlink to THAT repo's main `.env.local` | self-link · another repo's env · an old backup · any other readable file |

**Readability is not sufficient.** A link to a DIFFERENT repository's `.env.local`
can be readable, populated and carry every required variable family while being
catastrophically wrong — runners load real-looking credentials for the wrong
project. Family validation cannot see that; only topology can. Repair a stale
worktree by deleting the bad link and running the helper — never by repointing it
by hand.

---

## ⛔ Never pop an unidentified shared stash

**The stash stack is shared by the main checkout and every worktree, and by every concurrent
session.** `git stash pop` / `git stash apply` with no argument takes `stash@{0}` — whoever pushed
it. On 2026-09-26 an agent in a linked worktree ran a bare `git stash` on an already-clean tree
(which stashed nothing), then `git stash pop` applied another session's
`auto: cursor sessionEnd 2026-09-20T15:24` entry from `main` into its tree. `package-lock.json`
conflicted; the tree was restored from HEAD and the foreign entry survived only because a
conflicted pop does not drop it.

- **Before any `pop`/`apply`/`drop`, identify the entry:** `git stash list --format='%H %gd %gs'`
  and `git stash show -p <sha>`. It is yours only if you pushed it this session under a tag you chose.
- **Never `pop`.** If you must stash: `git stash push -u -m "<unique-tag>"`, capture its SHA
  immediately, restore with `git stash apply <sha>`, then drop it by re-finding the tag.
- **Prefer no stash at all.** To test old code, use a WIP commit, or `git show origin/main:<file>`
  into place and `git checkout HEAD -- <file>` back.
- An entry you did not create is someone else's work. Leave it; report it.

---

## ⚠️ `vercel --prod` from a worktree — link `.vercel` in THAT worktree first

> **[Release control 2026-11-17]** `vercel --prod` is a covered action under root CLAUDE.md rule 15. This section is the release coordinator's technical reference for an authorized deploy. Builders never run it; they open a draft PR and stop.

`vercel --prod` uploads the directory that owns the nearest `.vercel/project.json`,
not "the branch your shell is on." A fresh worktree under `.claude/worktrees/<slug>`
does **not** inherit the main checkout's `.vercel/`. Without a local link, the CLI
walks up to the parent checkout, builds **that** tree (often stale `main`), aliases
production, and reports READY while the feature branch never shipped. Measured
2026-09-14 on the Ralph confirm-path ship (PR #1514): two green prod deploys served
the old Confirm UI until `.vercel/` was copied into the worktree and redeployed.

**Worktree bootstrap (after `git worktree add`):**

```bash
npm run env:link-worktree -- .claude/worktrees/<slug>
cp -R .vercel .claude/worktrees/<slug>/.vercel   # from the main checkout
# or, from inside the worktree: vercel link --yes --project market-assassin
```

**Before every worktree deploy:** `test -f .vercel/project.json` in the worktree
cwd. A green READY is not proof — grep the live URL for a string that exists only
on the feature branch. Full rule: `.cursor/rules/ship-after-fix.mdc`.

---

## Pre-Deploy QA

**ALWAYS run before a change is released** (builders: before marking a PR ready; **[Release control 2026-11-17]** the deploy itself is a covered action under root CLAUDE.md rule 15, so `npm run deploy` is coordinator-only):

```bash
# Safe deploy (runs tests first, blocks on failure)
npm run deploy

# Or run tests manually
npm run test:pre-deploy
```

**What it checks:**
- TypeScript compilation
- SAM.gov date format (MM/dd/yyyy not YYYY-MM-DD)
- Critical API endpoints
- Daily Alerts pipeline
- Market Intelligence pipeline
- Access control rules
- Environment variables

**Test files:** `tests/test-pre-deploy.sh`, `tests/run-all-tests.sh`

---

## ⚠️ The gate validates the CHECKOUT BEING PUSHED — not the hook's location

**`.githooks/resolve-checkout.sh` decides which tree the pre-push gate examines, and it
FAILS CLOSED.** Regression: `tests/pre-push-worktree-selection.test.sh`, wired in as
blocking step **1a**. The gate now prints the validated checkout path and HEAD on every
run — a green gate that does not name your tree is not a green gate for your tree.

**Two invariants, both enforced, both failing closed:**

1. the gate validates the checkout **being pushed**, and
2. the hook **code** came from that same checkout.

**The supported configuration is `core.hooksPath = .githooks` — RELATIVE.** That is what
`npm run hooks:install` and the npm `prepare` script write, and git resolves a relative
hooksPath against the top of the working tree being operated on, so **each worktree runs
its own hook**. Under that config the old derivation happened to be correct.

**The bug it replaces.** The hook derived its root from the hook FILE:

```bash
ROOT="$(cd "$(dirname "$0")/.." && pwd)"     # ← wrong whenever hooksPath is absolute
```

This repository was found on 2026-09-22 with
`core.hooksPath = /Users/ericcoffie/Projects/market-assassin/.githooks` — an **absolute**
path into the primary checkout. ⚠️ That is **not** what `hooks:install` writes; something
else set it. Git honours it from every linked worktree, so the **primary's hook code** runs
with cwd in the **worktree being pushed**. The gate then `cd`ed to the primary and
typechecked and tested **that** while reporting a verdict on your branch. With ~30
worktrees live here, the primary is usually another session's in-flight tree.

⚠️ **Resolving the cwd is only half the fix.** Under an absolute primary hooksPath a
*stale* primary hook would validate the right tree with the **wrong gate implementation**.
So ownership is checked too, and we **do not silently compensate** — the push is refused
with instructions to restore `npm run hooks:install`. The one-command repair escape stays
valid because there the absolute path names the *current* checkout:
`git -c core.hooksPath="$PWD/.githooks" push`.

**Measured 2026-09-22.** A docs-only branch pushed from a worktree was blocked by
`scripts/_trace-rc1.ts` (another session's scratch file, absent from the pushing worktree
and from the primary minutes later) and by three `src/lib/usaspending` unit tests that
passed in isolation AND in the pushing worktree's own full suite (611 files / 6,844 tests,
exit 0). **The branch under push was never examined.** This is the same family as the
documented "`vercel --prod` from a worktree uploads the parent tree" trap — the tool's
notion of "here" is not your notion of "here".

⚠️ **Historical gate claims are corrected accordingly.** PR #1610's pre-push results are
only trustworthy for its FIRST push, which came from the primary checkout. Rounds 2–3 and
the removal were pushed from a worktree, so those "✓ pre-push gate passed" lines describe
the primary checkout, not that branch. That work remains separately evidenced — GitHub
Actions `verify` ran against the actual commits and passed, and the suite, the 13 live
oracles and the browser checks were run directly in the worktree — but the local gate did
not see it. Do not cite those gate lines as branch validation.

⚠️ **Canonicalize the hook SOURCE before its ownership means anything.** Two laundering
routes, both closed and both pinned:
- **symlinked hook DIRECTORY** (`worktree/.githooks -> primary/.githooks`): `cd "$dir/.."`
  resolves the LOGICAL parent and happily reports `worktree` as the owner while the code
  physically lives in the primary. Canonicalize the directory first (`cd -P`), then take
  ITS physical parent. Enforced in both the hook and, defensively, in the resolver.
- **symlinked hook FILE** (`worktree/.githooks/pre-push -> primary/.../pre-push`): the
  directory is genuinely local, so a directory-level check passes while git executes the
  primary's code. `[ -L "$0" ]` refuses it outright — the supported checkout has a real
  tracked hook file, so a symlink there is always wrong. `post-merge` detects the same and
  exits 0 silently, being report-only.

**Two traps if you touch the resolver:**
- **Inherited `GIT_DIR` / `GIT_WORK_TREE`.** Git sets these for hooks; a plain
  `git rev-parse` in a subshell then answers for whatever they name instead of for the
  cwd. They are cleared before resolving. Pinned by a regression.
- **`/var` vs `/private/var`.** `git rev-parse --show-toplevel` always returns the
  PHYSICAL path, so a test comparing against an unresolved `mktemp -d` fails against a
  CORRECT resolver. Use `pwd -P`.

**Pushing from a worktree when the hook itself is being repaired:** use a one-command,
checkout-local override — `git -c core.hooksPath="$PWD/.githooks" push`. Never
`--no-verify`, and never rewrite the shared `core.hooksPath`; other sessions depend on it.

**Drift detector (2026-09-23):** `npm run verify:hooks` (`scripts/check-hooks-path.mjs`) and
pre-push **step 0** (before the resolver, so the primary checkout is caught too) FAIL on any
`core.hooksPath` other than the relative `.githooks` — naming the value, its origin and the fix.
It **only detects, never rewrites** config. **Never set an absolute `core.hooksPath`** (it was
found hand-set 3× on 2026-09-23); fix with `npm run hooks:install`, and use `git -c` one-shot only.
Regression: `tests/check-hooks-path.test.sh` (gate step 1d).

### ⛔ Rules for any test that CREATES or MUTATES git repositories

Written after this test re-initialised the real repository as **bare**
(`core.bare=true`), which broke `git status` in the primary checkout while another session
was working in it, and committed two fixture commits ("seed", "w") onto the branch under
test. Two mechanisms, both ordinary:

- **Inherited `GIT_DIR`.** Git sets it for hooks. `git init --bare <path>` honoured it
  over its own path argument and applied to the real repository.
- **A failed `cd` that did not abort.** `set -e` was not in use, so
  `( cd "$fixture"; git add -A; git commit )` carried on in the previous cwd — the source
  tree — when the fixture did not exist.

**Non-negotiable, in this order:**

1. **Scrub the git environment BEFORE the first git command** — `GIT_DIR`,
   `GIT_WORK_TREE`, `GIT_INDEX_FILE`, `GIT_OBJECT_DIRECTORY`,
   `GIT_ALTERNATE_OBJECT_DIRECTORIES`, `GIT_COMMON_DIR`, `GIT_PREFIX`,
   `GIT_CONFIG_PARAMETERS`, `GIT_CONFIG_COUNT`, `GIT_CONFIG_KEY_n`/`VALUE_n`; pin
   `GIT_CONFIG_GLOBAL` and `GIT_CONFIG_SYSTEM` to `/dev/null`. Not after setup — before.
2. **Operate exclusively inside a validated temporary directory.** Assert every path is
   under `$TMP` *before* git is pointed at it, and assert every repo git creates resolves
   back under `$TMP`. Use `pwd -P` (`git rev-parse --show-toplevel` always answers with the
   PHYSICAL path, so `/var` vs `/private/var` will fail a correct resolver).
   ⚠️ **VALIDATE THE ANCHOR ITSELF, or every other guard is a tautology.** Found in review
   of this very file: `TMP="$(cd "$(mktemp -d …)" && pwd -P)"` degrades to the CURRENT
   DIRECTORY when `mktemp` fails, because a failed `mktemp -d` prints nothing and **bash's
   `cd ""` returns 0 without moving**. Every `under_tmp` check then compared against the
   real tree and passed, and the `EXIT` trap's `rm -rf "$TMP"` deleted it — while the test
   printed 8/8 and exited 0. As gate step 1a the cwd is the checkout being pushed. Four
   guards: `mktemp` must succeed, the result must be a non-empty existing dir, the path
   must match the expected `*-XXXXXX` shape, and **the directory must be EMPTY** — that
   last one is the generic catch, because a real checkout never is. Arm the cleanup trap
   only after all four pass.
3. **Every `cd` gets `|| die`.** A test without `set -e` treats a failed `cd` as "carry on
   here", and "here" is the source tree.
4. ⛔ **Never point `GIT_DIR` at the real repository, even to prove a negative.** Use a
   **disposable sentinel repository** under `$TMP`. The env-var regression in
   `tests/pre-push-worktree-selection.test.sh` does exactly this — its `GIT_DIR` is a
   fixture path, never the working repo.

`git -c key=value <cmd>` exports `GIT_CONFIG_PARAMETERS` to every child, so a `-c`
override used to publish a fix leaks into any repository the test creates. Rule 1 closes
that too.

---
