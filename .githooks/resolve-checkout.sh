#!/usr/bin/env bash
#
# WHICH CHECKOUT IS BEING PUSHED?
#
# ⚠️ This exists because the pre-push gate spent weeks validating the WRONG
# TREE. It derived its root from the HOOK FILE's location:
#
#     ROOT="$(cd "$(dirname "$0")/.." && pwd)"     # ← the bug
#
# `npm run hooks:install` sets `core.hooksPath` to an ABSOLUTE path inside the
# primary checkout. Every linked worktree shares that config, so `$0` is always
# `<primary>/.githooks/pre-push` no matter where you push from — and the gate
# `cd`s into the PRIMARY checkout and typechecks and tests THAT.
#
# Measured 2026-09-22: pushing a docs-only branch from a worktree failed on
# `scripts/_trace-rc1.ts` (a scratch file belonging to another session working
# in the primary checkout) and on three `src/lib/usaspending` unit tests that
# passed in isolation and in the pushing worktree's own full suite. The branch
# under push was never examined. Same family as the documented
# "`vercel --prod` from a worktree uploads the parent tree" trap.
#
# THE INVARIANT: the gate validates the checkout that is being pushed.
#
# Resolution, in order:
#   1. Git invokes a pre-push hook with the cwd at the top of the working tree
#      that is being pushed. That cwd is the primary signal.
#   2. Inherited GIT_DIR / GIT_WORK_TREE / GIT_INDEX_FILE point at the pushing
#      worktree's admin files, but they also make a plain `git rev-parse` in a
#      subshell answer for whatever they name rather than for the cwd. Clear
#      them before asking, so the answer describes where we actually are.
#   3. FAIL CLOSED. If the toplevel cannot be established, or does not look
#      like this repository, print why and exit non-zero. A gate that cannot
#      tell which tree it is checking must not report on any tree.
#
# Prints the absolute path of the validated checkout on stdout. Diagnostics go
# to stderr so `$(resolve-checkout.sh)` stays clean.

set -uo pipefail

die() { echo "resolve-checkout: $*" >&2; exit 1; }

# (2) Ask about the cwd, not about inherited pointers.
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_OBJECT_DIRECTORY \
      GIT_ALTERNATE_OBJECT_DIRECTORIES GIT_COMMON_DIR GIT_PREFIX

toplevel="$(git rev-parse --show-toplevel 2>/dev/null)" \
  || die "git rev-parse --show-toplevel failed from $PWD"
[ -n "$toplevel" ] || die "empty toplevel from $PWD"
[ -d "$toplevel" ] || die "toplevel is not a directory: $toplevel"

# A linked worktree has `.git` as a FILE; the primary checkout has it as a
# directory. Both are valid — we only require that one of them exists, so a
# bare repo or a stray directory cannot be mistaken for a checkout.
[ -e "$toplevel/.git" ] || die "no .git entry at $toplevel"

# (3) Confirm it is THIS repository, not some other checkout that happens to
# be the cwd. package.json name is the cheapest durable marker.
expected_name="market-assassin"
[ -f "$toplevel/package.json" ] || die "no package.json at $toplevel"
actual_name="$(node -e 'try{process.stdout.write(require(process.argv[1]).name||"")}catch(e){}' \
  "$toplevel/package.json" 2>/dev/null)"
[ "$actual_name" = "$expected_name" ] \
  || die "package.json name is '${actual_name:-<unreadable>}', expected '$expected_name' at $toplevel"

printf '%s\n' "$toplevel"
