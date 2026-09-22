#!/usr/bin/env bash
#
# WHICH CHECKOUT IS BEING PUSHED, AND DID THIS HOOK COME FROM IT?
#
# Usage:  resolve-checkout.sh [HOOK_DIR]
#   no arg   — print the physical toplevel of the checkout we are running in.
#   HOOK_DIR — additionally require that HOOK_DIR's PHYSICAL parent IS that
#              checkout, i.e. the hook CODE and the tree it validates are the
#              same checkout. Fails closed when they differ. HOOK_DIR is
#              canonicalized here too, so a symlinked hook directory cannot
#              launder its ownership through a lexical `..`.
#
# ── The supported configuration ───────────────────────────────────────────
#
#   core.hooksPath = .githooks        (RELATIVE — what `npm run hooks:install`
#                                      and the npm `prepare` script set)
#
# Git resolves a RELATIVE hooksPath against the top of the working tree being
# operated on, so a push from a linked worktree runs THAT WORKTREE'S hook.
# Under this supported config the old `dirname "$0"/..` derivation happened to
# be correct, because the hook really did live in the tree being pushed.
#
# ── The state that broke it ───────────────────────────────────────────────
#
# Measured in this repository on 2026-09-22:
#
#   core.hooksPath = /Users/ericcoffie/Projects/market-assassin/.githooks
#
# an ABSOLUTE path into the primary checkout. That is NOT what hooks:install
# writes — something else set it — but git honours it from every linked
# worktree, so:
#
#   • the PRIMARY checkout's hook CODE executes,
#   • with cwd in the linked WORKTREE being pushed.
#
# The old derivation then `cd`ed to the primary and typechecked and tested THAT
# while printing a verdict on your branch. A docs-only push was blocked by
# another session's scratch file (`scripts/_trace-rc1.ts`) and by three
# `src/lib/usaspending` unit tests that passed in the pushing worktree's own
# full suite. The branch under push was never examined.
#
# ── The invariant ─────────────────────────────────────────────────────────
#
#   THE HOOK CODE AND THE CHECKOUT IT VALIDATES MUST BE THE SAME CHECKOUT.
#
# Resolving cwd correctly is only half of it: under an absolute primary
# hooksPath a stale primary hook would validate the right tree with the WRONG
# GATE IMPLEMENTATION. We do NOT silently compensate for that — we fail closed
# and tell the operator to restore the supported relative config, because a
# gate whose code came from somewhere else is not this branch's gate.
#
# The one-command repair escape stays valid:
#     git -c core.hooksPath="$PWD/.githooks" push
# there the absolute path belongs to the CURRENT checkout, so HOOK_ROOT == ROOT.
#
# ── Resolution, in order ──────────────────────────────────────────────────
#   1. Git invokes the hook with cwd inside the working tree being operated on.
#   2. Inherited GIT_DIR / GIT_WORK_TREE / GIT_INDEX_FILE name that tree's admin
#      files and would make a plain `git rev-parse` answer for them rather than
#      for the cwd. Clear them first.
#   3. FAIL CLOSED — on an unresolvable toplevel, a foreign repository, or a
#      hook that belongs to a different checkout.
#
# Prints the absolute (physical) path of the validated checkout on stdout.
# Diagnostics go to stderr so `$(resolve-checkout.sh)` stays clean.

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

# ── Hook-code ownership ───────────────────────────────────────────────────
# Only when the caller names its own hook directory. The hook that is running
# must live in the checkout we just validated.
if [ $# -ge 1 ] && [ -n "${1:-}" ]; then
  hook_dir="$1"
  [ -d "$hook_dir" ] || die "hook dir does not exist: $hook_dir"
  # ⚠️ PHYSICAL, and never a lexical `..`. `cd "$dir/.." && pwd -P` resolves the
  # LOGICAL parent, so a symlinked hook directory
  #     worktree/.githooks -> primary/.githooks
  # reports `worktree` as the owner while the code physically lives in the
  # primary. Canonicalize the directory first, then take ITS physical parent.
  hook_dir_physical="$(cd -P "$hook_dir" && pwd -P)" \
    || die "cannot canonicalize hook dir: $hook_dir"
  hook_root="$(cd -P "$hook_dir_physical/.." && pwd -P)" \
    || die "cannot resolve the checkout owning $hook_dir_physical"
  if [ "$hook_root" != "$toplevel" ]; then
    die "$(printf '%s\n' \
      "hook code belongs to ANOTHER CHECKOUT — refusing to validate." \
      "  hook code : $hook_dir" \
      "              (physically $hook_dir_physical, owned by $hook_root)" \
      "  pushing   : $toplevel" \
      "core.hooksPath is an absolute path into a different checkout, so this" \
      "tree would be gated by another checkout's hook implementation." \
      "Restore the supported configuration:   npm run hooks:install" \
      "(that sets the RELATIVE  core.hooksPath=.githooks , which makes git run" \
      "each worktree's own hook). To publish a repair to the hook itself, use a" \
      "one-command override that names THIS checkout:" \
      "    git -c core.hooksPath=\"\$PWD/.githooks\" push")"
  fi
fi

printf '%s\n' "$toplevel"
