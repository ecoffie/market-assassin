#!/usr/bin/env bash
#
# Hermetic regression for scripts/check-hooks-path.mjs — the core.hooksPath
# DRIFT DETECTOR (detection only; it must never write git config).
#
# What it pins:
#   1. relative `.githooks`                         → PASS (exit 0)
#   2. ABSOLUTE path (the 2026-09-23 drift, 3×)     → FAIL, message names the fix
#   3. unset                                        → FAIL (the gate would never run)
#   4. worktree-level value                          → reported; a bad one FAILS
#   5. one-shot `git -c core.hooksPath=<this checkout>/.githooks`  → PASS w/ warning
#      one-shot naming ANOTHER checkout's .githooks → FAIL
#   6. the check NEVER rewrites config (byte-identical before/after)
#   7. an inherited GIT_DIR (as git sets for hooks) does not redirect the check
#   8. pre-push runs it BEFORE the resolver (so the primary gets the clear message)
#
# Follows CLAUDE.md "⛔ Rules for any test that CREATES or MUTATES git
# repositories" exactly: env scrubbed before the first git command, validated
# mktemp anchor, every cd `|| die`, GIT_DIR only ever points at a sentinel
# repo under $TMP — never the real repository.
#
# Run: bash tests/check-hooks-path.test.sh

set -uo pipefail

# (1) Scrub every channel git uses to inject config / redirect repos — BEFORE
# any git command. A `git -c ...` used to push this very file exports
# GIT_CONFIG_PARAMETERS to us; left in place it would leak into every fixture.
unset GIT_CONFIG_PARAMETERS GIT_CONFIG_COUNT GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE \
      GIT_OBJECT_DIRECTORY GIT_ALTERNATE_OBJECT_DIRECTORIES GIT_COMMON_DIR \
      GIT_PREFIX GIT_NAMESPACE GIT_CEILING_DIRECTORIES
i=0; while [ $i -lt 64 ]; do unset "GIT_CONFIG_KEY_$i" "GIT_CONFIG_VALUE_$i"; i=$((i+1)); done
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null
export GIT_TERMINAL_PROMPT=0

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)" \
  || { echo "✗ cannot locate repo root" >&2; exit 2; }
CHECK="$REPO_ROOT/scripts/check-hooks-path.mjs"
PREPUSH="$REPO_ROOT/.githooks/pre-push"
[ -f "$CHECK" ] || { echo "✗ missing $CHECK" >&2; exit 2; }

# (2) THE ANCHOR — four guards, then (and only then) arm the cleanup trap.
TMP_RAW="$(mktemp -d "${TMPDIR:-/tmp}/hookspath-chk-XXXXXX")" \
  || { echo "  ✗ CONTAINMENT: mktemp -d failed under TMPDIR='${TMPDIR:-/tmp}'" >&2; exit 2; }
[ -n "$TMP_RAW" ] && [ -d "$TMP_RAW" ] \
  || { echo "  ✗ CONTAINMENT: mktemp -d produced no usable directory" >&2; exit 2; }
TMP="$(cd "$TMP_RAW" && pwd -P)" \
  || { echo "  ✗ CONTAINMENT: cannot enter $TMP_RAW" >&2; exit 2; }
case "$TMP" in
  */hookspath-chk-??????) : ;;
  *) echo "  ✗ CONTAINMENT: refusing \$TMP='$TMP' — not a hookspath-chk- temp dir" >&2; exit 2 ;;
esac
[ -z "$(ls -A "$TMP" 2>/dev/null)" ] \
  || { echo "  ✗ CONTAINMENT: refusing \$TMP='$TMP' — not empty" >&2; exit 2; }
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

die_hard() { echo "  ✗ CONTAINMENT: $*" >&2; exit 2; }
pass=0; fail=0
ok()  { echo "  ✓ $1"; pass=$((pass+1)); }
bad() { echo "  ✗ FAIL: $1"; [ $# -gt 1 ] && printf '      %s\n' "$2"; fail=$((fail+1)); }

under_tmp() { case "$1" in "$TMP"/*) return 0 ;; *) return 1 ;; esac; }

# Create a fixture checkout at $1 (must be under $TMP) with a real .githooks dir.
mk_repo() {
  local dir="$1"
  under_tmp "$dir" || die_hard "refusing to create repo outside $TMP: $dir"
  git init -q "$dir" || die_hard "git init $dir"
  local top
  top="$(cd "$dir" && git rev-parse --show-toplevel)" || die_hard "no repo at $dir"
  under_tmp "$top/x" || die_hard "repo at $dir resolved to $top, outside $TMP"
  mkdir -p "$dir/.githooks" || die_hard "mkdir $dir/.githooks"
  (
    cd "$dir" || die_hard "cd $dir"
    git config user.email t@t.t && git config user.name t && git config commit.gpgsign false
    echo seed > seed.txt && git add -A && git commit -qm seed
  ) || die_hard "seed commit in $dir"
}

# Run the check against $1; capture exit + combined output.
run_check() {
  local dir="$1"; shift
  under_tmp "$dir" || die_hard "refusing to check a repo outside $TMP: $dir"
  OUT="$(node "$CHECK" --repo "$dir" "$@" 2>&1)"; RC=$?
}

# ── fixtures ───────────────────────────────────────────────────────────────
P="$TMP/primary"; OTHER="$TMP/other"; SENT="$TMP/sentinel"
mk_repo "$P"; mk_repo "$OTHER"; mk_repo "$SENT"
WT="$TMP/wt"
under_tmp "$WT" || die_hard "worktree path escapes $TMP"
( cd "$P" || die_hard "cd $P"; git worktree add -q -b feature "$WT" HEAD ) || die_hard "worktree add"
mkdir -p "$WT/.githooks" || die_hard "mkdir $WT/.githooks"
CFG="$P/.git/config"
P_PHYS="$(cd "$P" && pwd -P)" || die_hard "cd $P"

setlocal() { ( cd "$P" || die_hard "cd $P"; git config core.hooksPath "$1" ) || die_hard "set local"; }
unsetlocal() { ( cd "$P" || die_hard "cd $P"; git config --unset-all core.hooksPath ) ; true; }

# ── 1. relative .githooks → PASS ───────────────────────────────────────────
setlocal .githooks
run_check "$P"
if [ "$RC" = 0 ] && grep -q "core.hooksPath OK" <<<"$OUT"; then ok "relative .githooks passes"
else bad "relative .githooks should pass (rc=$RC)" "$OUT"; fi

# ── 2. absolute path → FAIL with the fix command ───────────────────────────
setlocal "$P_PHYS/.githooks"
run_check "$P"
if [ "$RC" = 1 ] && grep -q "ABSOLUTE" <<<"$OUT" && grep -q "npm run hooks:install" <<<"$OUT" \
   && grep -q 'git -c core.hooksPath="$PWD/.githooks" push' <<<"$OUT" && grep -q "local: file:" <<<"$OUT"; then
  ok "absolute path fails, names origin + fix + one-shot override"
else bad "absolute path should fail with actionable message (rc=$RC)" "$OUT"; fi
# … and the same shared value fails from the LINKED worktree too
run_check "$WT"
if [ "$RC" = 1 ] && grep -q "ABSOLUTE" <<<"$OUT"; then ok "absolute path fails from a linked worktree"
else bad "absolute path should fail from worktree (rc=$RC)" "$OUT"; fi

# ── 6. never writes config ────────────────────────────────────────────────
before="$(shasum "$CFG" | cut -d' ' -f1)"
run_check "$P"; run_check "$WT"
after="$(shasum "$CFG" | cut -d' ' -f1)"
if [ "$before" = "$after" ] && [ "$(cd "$P" && git config --get core.hooksPath)" = "$P_PHYS/.githooks" ]; then
  ok "check never rewrites git config"
else bad "config changed during check ($before → $after)"; fi

# ── 3. unset → FAIL ────────────────────────────────────────────────────────
unsetlocal
run_check "$P"
if [ "$RC" = 1 ] && grep -q "UNSET" <<<"$OUT" && grep -q "npm run hooks:install" <<<"$OUT"; then
  ok "unset fails with the fix command"
else bad "unset should fail (rc=$RC)" "$OUT"; fi

# ── 4. worktree-level value is reported ───────────────────────────────────
setlocal .githooks
( cd "$P" || die_hard "cd $P"; git config extensions.worktreeConfig true ) || die_hard "worktreeConfig"
( cd "$WT" || die_hard "cd $WT"; git config --worktree core.hooksPath .githooks ) || die_hard "wt set"
run_check "$WT"
if [ "$RC" = 0 ] && grep -q "worktree-level core.hooksPath is set" <<<"$OUT"; then
  ok "approved worktree-level value passes and is reported"
else bad "worktree-level .githooks should pass + be noted (rc=$RC)" "$OUT"; fi
( cd "$WT" || die_hard "cd $WT"; git config --worktree core.hooksPath "$P_PHYS/.githooks" ) || die_hard "wt set abs"
run_check "$WT"
if [ "$RC" = 1 ] && grep -q "\[worktree:" <<<"$OUT"; then ok "absolute worktree-level value fails, scope named"
else bad "absolute worktree-level value should fail naming worktree scope (rc=$RC)" "$OUT"; fi
# a relative worktree value must NOT hide an absolute SHARED (local) value
( cd "$WT" || die_hard "cd $WT"; git config --worktree core.hooksPath .githooks ) || die_hard "wt reset"
setlocal "$P_PHYS/.githooks"
run_check "$WT"
if [ "$RC" = 1 ] && grep -q "local-level core.hooksPath is not approved" <<<"$OUT"; then
  ok "worktree override does not mask drifted shared config"
else bad "shadowed absolute local value should still fail (rc=$RC)" "$OUT"; fi
( cd "$WT" || die_hard "cd $WT"; git config --worktree --unset-all core.hooksPath ); true

# ── 5. one-shot override (git -c) ─────────────────────────────────────────
# shared config still absolute (from above). Simulate `git -c` exactly as git
# exports it to hooks: GIT_CONFIG_PARAMETERS.
OUT="$(GIT_CONFIG_PARAMETERS="'core.hookspath'='$P_PHYS/.githooks'" node "$CHECK" --repo "$P" 2>&1)"; RC=$?
if [ "$RC" = 0 ] && grep -q "one-shot" <<<"$OUT" && grep -q "shared config is still drifted" <<<"$OUT"; then
  ok "one-shot override naming THIS checkout passes with a drift warning"
else bad "one-shot for this checkout should pass+warn (rc=$RC)" "$OUT"; fi
OTHER_PHYS="$(cd "$OTHER" && pwd -P)" || die_hard "cd $OTHER"
OUT="$(GIT_CONFIG_PARAMETERS="'core.hookspath'='$OTHER_PHYS/.githooks'" node "$CHECK" --repo "$P" 2>&1)"; RC=$?
if [ "$RC" = 1 ] && grep -q "command:" <<<"$OUT"; then ok "one-shot naming ANOTHER checkout fails"
else bad "one-shot for another checkout should fail (rc=$RC)" "$OUT"; fi

# ── 7. inherited GIT_DIR (sentinel repo, never the real one) ──────────────
( cd "$SENT" || die_hard "cd $SENT"; git config core.hooksPath "/somewhere/else/.githooks" ) || die_hard "sentinel cfg"
setlocal .githooks
under_tmp "$SENT/.git" || die_hard "sentinel outside $TMP"
OUT="$(GIT_DIR="$SENT/.git" node "$CHECK" --repo "$P" 2>&1)"; RC=$?
if [ "$RC" = 0 ] && grep -q "core.hooksPath OK: .githooks" <<<"$OUT"; then
  ok "inherited GIT_DIR does not redirect the check"
else bad "inherited GIT_DIR redirected the check (rc=$RC)" "$OUT"; fi

# ── 8. wiring: pre-push runs the check BEFORE the resolver ────────────────
chk_line="$(grep -n 'check-hooks-path.mjs' "$PREPUSH" | head -1 | cut -d: -f1)"
res_line="$(grep -n 'resolve-checkout.sh" "\$HOOK_DIR"' "$PREPUSH" | head -1 | cut -d: -f1)"
if [ -n "$chk_line" ] && [ -n "$res_line" ] && [ "$chk_line" -lt "$res_line" ]; then
  ok "pre-push runs check-hooks-path before resolve-checkout (line $chk_line < $res_line)"
else bad "pre-push must run check-hooks-path before the resolver (chk=$chk_line res=$res_line)"; fi

echo
echo "  $pass passed, $fail failed"
[ "$fail" = 0 ]
