#!/usr/bin/env bash
#
# REAL-REPOSITORY regression for the pre-push gate's checkout selection.
#
# THE BUG THIS PINS: the gate derived its root from the HOOK FILE's location
# (`dirname "$0"/..`). The SUPPORTED config is RELATIVE — `core.hooksPath=.githooks`,
# what `npm run hooks:install` writes — and git resolves that per working tree,
# so each worktree runs its own hook and the old derivation was fine. This repo
# was found with an ABSOLUTE hooksPath into the primary checkout (not written by
# hooks:install), which every linked worktree shares: the primary's hook CODE
# runs with cwd in the pushed worktree, so the gate validated the PRIMARY tree. Measured
# 2026-09-22 on a docs-only branch: it failed on another session's scratch file
# and on three unit tests that passed in the pushing worktree's own full suite.
# The branch under push was never examined.
#
# No mocks: real `git init`, a real bare remote, a real linked worktree, and a
# real absolute shared core.hooksPath. The stub hook resolves the checkout the
# same way the gate does, then fails if that checkout contains a FAIL marker —
# so "which tree did the gate check?" becomes a pass/fail a push can express.
#
# Run: bash tests/pre-push-worktree-selection.test.sh

set -uo pipefail

# ⚠️ HERMETIC FIXTURES. `git -c key=value push` exports GIT_CONFIG_PARAMETERS to
# every child process, so a `-c core.hooksPath=...` used to publish THIS fix
# leaked into the fixture repos below and made them run the REAL 13-step gate
# instead of their stub hook. (Caught 2026-09-22: the fixture push failed with
# "could not establish which checkout is being pushed" — the real resolver
# correctly refusing a temp repo that is not market-assassin.) Clear every
# channel git uses to inject config, and pin global/system config to nothing,
# so these fixtures answer only to the config the test itself sets.
unset GIT_CONFIG_PARAMETERS GIT_CONFIG_COUNT GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE \
      GIT_OBJECT_DIRECTORY GIT_ALTERNATE_OBJECT_DIRECTORIES GIT_COMMON_DIR \
      GIT_PREFIX GIT_NAMESPACE GIT_CEILING_DIRECTORIES
i=0; while [ $i -lt 64 ]; do unset "GIT_CONFIG_KEY_$i" "GIT_CONFIG_VALUE_$i"; i=$((i+1)); done
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null
export GIT_TERMINAL_PROMPT=0

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RESOLVER="$REPO_ROOT/.githooks/resolve-checkout.sh"
# ⚠️⚠️ THE ANCHOR. Every containment guard below compares against $TMP, and the
# EXIT trap `rm -rf`s it — so if $TMP is wrong, the guards are tautologies and
# the trap is a demolition order. This was a REAL defect in this file:
#
#     TMP="$(cd "$(mktemp -d "${TMPDIR:-/tmp}/prepush-sel-XXXXXX")" && pwd -P)"
#
# A failed `mktemp -d` prints nothing to stdout, and bash's `cd ""` RETURNS 0
# WITHOUT MOVING — so $TMP silently became the current directory. As blocking
# gate step 1a the cwd is the checkout being pushed (the hook `cd`s there
# first), so a stale or unwritable TMPDIR would have deleted the user's working
# tree while this script printed 8/8 and exited 0. Demonstrated on a sentinel.
#
# Four guards, cheapest-to-strongest. The empty-directory check is the generic
# one: a real checkout is never empty.
TMP_RAW="$(mktemp -d "${TMPDIR:-/tmp}/prepush-sel-XXXXXX")" \
  || { echo "  ✗ CONTAINMENT: mktemp -d failed under TMPDIR='${TMPDIR:-/tmp}'" >&2; exit 2; }
[ -n "$TMP_RAW" ] && [ -d "$TMP_RAW" ] \
  || { echo "  ✗ CONTAINMENT: mktemp -d produced no usable directory" >&2; exit 2; }
# PHYSICAL path: on macOS /var is a symlink to /private/var, and
# `git rev-parse --show-toplevel` always answers resolved — comparing against
# an unresolved mktemp path would fail a CORRECT resolver.
TMP="$(cd "$TMP_RAW" && pwd -P)" \
  || { echo "  ✗ CONTAINMENT: cannot enter $TMP_RAW" >&2; exit 2; }
case "$TMP" in
  */prepush-sel-??????) : ;;
  *) echo "  ✗ CONTAINMENT: refusing \$TMP='$TMP' — not a prepush-sel- temp dir" >&2; exit 2 ;;
esac
[ -z "$(ls -A "$TMP" 2>/dev/null)" ] \
  || { echo "  ✗ CONTAINMENT: refusing \$TMP='$TMP' — not empty" >&2; exit 2; }

pass=0; fail=0

cleanup() { rm -rf "$TMP"; }
# Armed only AFTER $TMP is validated, so a refusal above cannot fire the trap.
trap cleanup EXIT

ok()   { echo "  ✓ $1"; pass=$((pass+1)); }
bad()  { echo "  ✗ FAIL: $1"; [ $# -gt 1 ] && echo "      $2"; fail=$((fail+1)); }

[ -x "$RESOLVER" ] || { echo "✗ missing/!executable: $RESOLVER"; exit 2; }

# ── fixture: bare remote + primary checkout + linked worktree ──────────────
# ⚠️ CONTAINMENT. This test creates repositories and MUST never touch a real
# one. It already did once (2026-09-22): running from inside the pre-push hook,
# it inherited GIT_DIR, so `git init --bare <path>` re-initialised the REAL
# repository as bare (core.bare=true, breaking the primary checkout), and a
# `cd` into a fixture that had not been created silently left the following
# git commands running in the source tree — which committed "seed"/"w" onto the
# branch under test and registered a stray worktree and `feature` branch.
#
# Three rules, all enforced below:
#   1. the env is scrubbed at the top of this file (GIT_DIR and friends),
#   2. every `cd` is `|| die`, because `set -e` is deliberately not in use here,
#   3. every path is asserted to live under $TMP BEFORE git is pointed at it,
#      and every repo git creates is asserted to have come out under $TMP.
die_hard() { echo "  ✗ CONTAINMENT: $*" >&2; exit 2; }

under_tmp() {
  case "$(cd "$(dirname "$1")" 2>/dev/null && pwd -P)/$(basename "$1")" in
    "$TMP"/*) return 0 ;;
    *) return 1 ;;
  esac
}

assert_fixture_repo() {
  local dir="$1"
  under_tmp "$dir" || die_hard "refusing to use $dir — outside $TMP"
  local top
  top="$(cd "$dir" && git rev-parse --show-toplevel 2>/dev/null)" \
    || die_hard "no repo at $dir"
  case "$top" in "$TMP"/*) : ;; *) die_hard "repo at $dir resolves to $top, outside $TMP" ;; esac
}

setup_fixture() {
  local base="$1"
  under_tmp "$base" || die_hard "fixture base $base is outside $TMP"
  mkdir -p "$base" || die_hard "mkdir $base"
  under_tmp "$base/remote.git" || die_hard "remote path escapes $TMP"
  git init --bare -q "$base/remote.git" || die_hard "git init --bare failed"
  [ -d "$base/remote.git" ] || die_hard "bare remote was not created at $base/remote.git"
  git init -q "$base/primary" || die_hard "git init primary failed"
  assert_fixture_repo "$base/primary"
  (
    cd "$base/primary" || die_hard "cd $base/primary"
    git config user.email t@t.t; git config user.name t
    git config commit.gpgsign false
    # Same marker the resolver checks for.
    printf '{"name":"market-assassin"}\n' > package.json
    echo seed > seed.txt
    git add -A && git commit -qm seed
    git remote add origin "$base/remote.git"
    git push -q origin HEAD:refs/heads/main
    git branch -q -f main HEAD 2>/dev/null || true
    git worktree add -q -b feature "$base/worktree" HEAD
  ) || die_hard "fixture setup subshell failed for $base"
  assert_fixture_repo "$base/worktree"
  # A linked worktree gets its own copy of the tracked files, including
  # package.json — confirm, because the resolver depends on it.
  [ -f "$base/worktree/package.json" ] || { echo "fixture broken: worktree has no package.json"; exit 2; }

  # Install a hook in BOTH checkouts, each stamped with WHICH ONE it is, so a
  # test can prove which hook CODE executed — not merely which tree was read.
  install_hook "$base/primary"  PRIMARY  "$base"
  install_hook "$base/worktree" WORKTREE "$base"

  # `hooks_mode` decides the condition under test:
  #   relative — the SUPPORTED config that `npm run hooks:install` writes.
  #              Git resolves it per working tree, so each runs its own hook.
  #   absolute — the misconfiguration found in this repo on 2026-09-22: an
  #              absolute path into the PRIMARY checkout, shared by every
  #              worktree, so the primary's hook code runs everywhere.
  case "${hooks_mode:-relative}" in
    relative) git -C "$base/primary" config core.hooksPath ".githooks" ;;
    absolute) git -C "$base/primary" config core.hooksPath "$base/primary/.githooks" ;;
    *) die_hard "unknown hooks_mode '${hooks_mode:-}'" ;;
  esac
}

# A stub gate that uses the REAL resolver, stamps which checkout's code ran,
# and fails when the validated checkout carries a FAIL marker.
install_hook() {
  local checkout="$1" label="$2" base="$3"
  under_tmp "$checkout" || die_hard "install_hook outside \$TMP: $checkout"
  mkdir -p "$checkout/.githooks" || die_hard "mkdir $checkout/.githooks"
  cp "$RESOLVER" "$checkout/.githooks/resolve-checkout.sh" || die_hard "cp resolver"
  chmod +x "$checkout/.githooks/resolve-checkout.sh"
  cat > "$checkout/.githooks/pre-push" <<HOOK
#!/usr/bin/env bash
set -uo pipefail
echo "GATE: hook code from $label"
echo "$label" >> "$base/which-hook-ran"
HOOK_DIR="\$(cd "\$(dirname "\$0")" && pwd)"
if ! ROOT="\$("\$HOOK_DIR/resolve-checkout.sh" "\$HOOK_DIR" 2>&1)"; then
  echo "GATE: blocked — \$ROOT" >&2; exit 1
fi
cd "\$ROOT" || exit 1
echo "GATE: validated checkout \$ROOT"
echo "GATE: HEAD \$(git rev-parse --short HEAD)"
if [ -f "\$ROOT/FAIL" ]; then
  echo "GATE: this checkout is marked failing" >&2; exit 1
fi
exit 0
HOOK
  chmod +x "$checkout/.githooks/pre-push"
}

# ── CASE A — the SUPPORTED relative config ────────────────────────────────
# core.hooksPath=.githooks  → git runs each working tree's OWN hook.
# A valid worktree must push even when the primary checkout is broken, the
# WORKTREE's hook code must be the one that ran, and the primary's must not.
A="$TMP/case-a"; hooks_mode=relative setup_fixture "$A"
touch "$A/primary/FAIL"                       # primary is broken
rm -f "$A/worktree/FAIL"                      # worktree is fine
(
  cd "$A/worktree" || die_hard "cd $A/worktree"
  echo change > w.txt && git add -A && git commit -qm w
) >/dev/null 2>&1
out_a="$(cd "$A/worktree" && git push origin feature 2>&1)"; rc_a=$?
ran_a="$(cat "$A/which-hook-ran" 2>/dev/null | tr '\n' ',')"

if [ $rc_a -eq 0 ]; then
  ok "A/relative: valid worktree + failing primary → push allowed"
else
  bad "A/relative: push was BLOCKED" "$(echo "$out_a" | tail -3)"
fi
if [ "$ran_a" = "WORKTREE," ]; then
  ok "A/relative: the WORKTREE's hook code ran, and only it"
else
  bad "A/relative: wrong hook code executed" "which-hook-ran=[$ran_a]"
fi
if grep -qF "GATE: validated checkout $A/worktree" <<<"$out_a"; then
  ok "A/relative: gate named the worktree as the validated checkout"
else
  bad "A/relative: gate did not name the worktree" "$(echo "$out_a" | grep GATE: | head -2)"
fi
if grep -q "GATE: HEAD " <<<"$out_a"; then
  ok "A/relative: gate printed the validated HEAD"
else
  bad "A/relative: gate did not print the validated HEAD"
fi

# ── CASE A2 — relative config, FAILING worktree, valid primary → BLOCK ─────
A2="$TMP/case-a2"; hooks_mode=relative setup_fixture "$A2"
rm -f "$A2/primary/FAIL"
touch "$A2/worktree/FAIL"
( cd "$A2/worktree" || die_hard "cd"; echo c > c.txt; git add -A; git commit -qm c ) >/dev/null 2>&1
out_a2="$(cd "$A2/worktree" && git push origin feature 2>&1)"; rc_a2=$?
if [ $rc_a2 -ne 0 ]; then
  ok "A/relative: failing worktree + valid primary → blocked (no free pass)"
else
  bad "A/relative: failing worktree was ALLOWED — the gate read the wrong tree"
fi

# ── CASE B — the MISCONFIGURED absolute-primary hooksPath ─────────────────
# The primary's hook code runs with cwd in the worktree. Resolving the cwd
# correctly is not enough: the gate implementation came from somewhere else, so
# it must FAIL CLOSED and say so — never report the worktree as validated.
B="$TMP/case-b"; hooks_mode=absolute setup_fixture "$B"
rm -f "$B/primary/FAIL" "$B/worktree/FAIL"    # BOTH trees are fine…
( cd "$B/worktree" || die_hard "cd"; echo b > b.txt; git add -A; git commit -qm b ) >/dev/null 2>&1
out_b="$(cd "$B/worktree" && git push origin feature 2>&1)"; rc_b=$?
ran_b="$(cat "$B/which-hook-ran" 2>/dev/null | tr '\n' ',')"

if [ "$ran_b" = "PRIMARY," ]; then
  ok "B/absolute: confirmed the PRIMARY's hook code is what git ran"
else
  bad "B/absolute: expected the primary's hook code to run" "which-hook-ran=[$ran_b]"
fi
# …and the push must still be refused, purely on hook-code ownership.
if [ $rc_b -ne 0 ]; then
  ok "B/absolute: push BLOCKED even though both trees are valid"
else
  bad "B/absolute: push was ALLOWED — a foreign hook gated this branch"
fi
if grep -q "hook code belongs to ANOTHER CHECKOUT" <<<"$out_b"; then
  ok "B/absolute: diagnostic says the hook belongs to another checkout"
else
  bad "B/absolute: diagnostic did not explain the ownership mismatch" "$(echo "$out_b" | tail -4)"
fi
if grep -q "npm run hooks:install" <<<"$out_b"; then
  ok "B/absolute: diagnostic tells the operator how to restore the supported config"
else
  bad "B/absolute: diagnostic gave no repair instruction"
fi
if grep -qF "GATE: validated checkout $B/worktree" <<<"$out_b"; then
  bad "B/absolute: reported the worktree as VALIDATED despite the foreign hook"
else
  ok "B/absolute: never reported the worktree as validated"
fi

# ── CASE B2 — an absolute path naming THIS checkout is still allowed ───────
# The documented repair escape: git -c core.hooksPath="$PWD/.githooks" push
B2="$TMP/case-b2"; hooks_mode=relative setup_fixture "$B2"
rm -f "$B2/primary/FAIL" "$B2/worktree/FAIL"
( cd "$B2/worktree" || die_hard "cd"; echo x > x.txt; git add -A; git commit -qm x ) >/dev/null 2>&1
out_b2="$(cd "$B2/worktree" && git -c core.hooksPath="$B2/worktree/.githooks" push origin feature 2>&1)"; rc_b2=$?
if [ $rc_b2 -eq 0 ] && grep -qF "GATE: validated checkout $B2/worktree" <<<"$out_b2"; then
  ok "B2: absolute override naming THIS checkout is allowed (repair escape works)"
else
  bad "B2: the one-command repair escape was refused" "$(echo "$out_b2" | tail -3)"
fi

# ── CONTROL — the ORIGINAL resolution must fail CASE A2 ───────────────────
# Proves these cases discriminate rather than passing for free.
C="$TMP/case-c"; hooks_mode=relative setup_fixture "$C"
cat > "$C/primary/.githooks/pre-push" <<'HOOK'
#!/usr/bin/env bash
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"   # the ORIGINAL bug
cd "$ROOT" || exit 1
echo "GATE(old): validated checkout $ROOT"
[ -f "$ROOT/FAIL" ] && { echo "GATE(old): failing" >&2; exit 1; }
exit 0
HOOK
chmod +x "$C/primary/.githooks/pre-push"
git -C "$C/primary" config core.hooksPath "$C/primary/.githooks"
rm -f "$C/primary/FAIL"; touch "$C/worktree/FAIL"
( cd "$C/worktree" || die_hard "cd $C/worktree"; echo c > c.txt; git add -A; git commit -qm c ) >/dev/null 2>&1
out_c="$(cd "$C/worktree" && git push origin feature 2>&1)"; rc_c=$?
if [ $rc_c -eq 0 ]; then
  ok "control: the ORIGINAL resolution lets a failing worktree through (bug reproduced)"
else
  bad "control: expected the original resolution to pass a failing worktree; it did not"
fi

# ── 4. fail closed when the checkout cannot be established ──────────────────
out_d="$(cd "$TMP" && bash "$RESOLVER" 2>&1)"; rc_d=$?
if [ $rc_d -ne 0 ]; then
  ok "fails closed outside any repository"
else
  bad "resolver succeeded outside a repository" "$out_d"
fi
notrepo="$TMP/notours"; mkdir -p "$notrepo"
( cd "$notrepo" || die_hard "cd $notrepo"; git init -q && git config user.email t@t.t && git config user.name t \
  && printf '{"name":"some-other-project"}\n' > package.json ) >/dev/null 2>&1
out_e="$(cd "$notrepo" && bash "$RESOLVER" 2>&1)"; rc_e=$?
if [ $rc_e -ne 0 ]; then
  ok "fails closed in a DIFFERENT repository (wrong package.json name)"
else
  bad "resolver accepted a different repository" "$out_e"
fi

# ── 5. inherited GIT_DIR / GIT_WORK_TREE must not redirect the answer ───────
out_f="$(cd "$A/worktree" && GIT_DIR="$A/primary/.git" GIT_WORK_TREE="$A/primary" \
  bash "$RESOLVER" 2>&1)"; rc_f=$?
if [ $rc_f -eq 0 ] && [ "$out_f" = "$A/worktree" ]; then
  ok "ignores inherited GIT_DIR/GIT_WORK_TREE pointing at the primary"
else
  bad "inherited GIT_DIR/GIT_WORK_TREE changed the answer" "got: $out_f"
fi

# ── THE ANCHOR ITSELF must fail closed, for the RIGHT REASON ──────────────
# Regression for the defect found in review: a failed `mktemp -d` silently made
# $TMP the CURRENT DIRECTORY (bash's `cd ""` returns 0 without moving), every
# guard below then compared against the real tree, and the EXIT trap deleted
# it — while this script printed 8/8 and exited 0. Under gate step 1a the cwd
# is the checkout being pushed.
#
# ⚠️ FALSIFIABILITY. An earlier version copied this script somewhere else and
# asked only for a non-zero exit. That passes for the WRONG REASON: the copy
# had no .githooks/resolve-checkout.sh beside its inferred repo root, so it
# would exit non-zero even if the anchor guard never fired. Two changes:
#   • run the REAL script, by absolute path, so the resolver is present;
#   • make TMPDIR deterministically unusable — a REGULAR FILE inside the
#     already-validated outer $TMP, so `mktemp -d "$TMPDIR/…"` fails ENOTDIR
#     regardless of global filesystem state;
#   • require the SPECIFIC containment refusal, not merely a non-zero exit.
if [ "${PREPUSH_SEL_SELFTEST:-}" != "1" ]; then
  sentinel="$TMP/anchor-sentinel"
  mkdir -p "$sentinel/src" || die_hard "mkdir sentinel"
  printf '{"name":"market-assassin"}\n' > "$sentinel/package.json"
  echo precious > "$sentinel/src/precious.ts"
  notdir="$TMP/not-a-directory"
  : > "$notdir" || die_hard "could not create $notdir"
  [ -f "$notdir" ] && [ ! -d "$notdir" ] || die_hard "$notdir is not a regular file"

  out_anchor="$(
    cd "$sentinel" || exit 97
    PREPUSH_SEL_SELFTEST=1 TMPDIR="$notdir" \
      bash "$REPO_ROOT/tests/pre-push-worktree-selection.test.sh" 2>&1
  )"; rc_anchor=$?

  anchor_ok=1; anchor_why=""
  add_why() { anchor_ok=0; anchor_why="${anchor_why:+$anchor_why; }$1"; }
  [ $rc_anchor -ne 0 ] || add_why "exited 0"
  [ -f "$sentinel/src/precious.ts" ] || add_why "SENTINEL WAS DELETED"
  grep -q "CONTAINMENT: mktemp -d failed" <<<"$out_anchor" \
    || add_why "no specific anchor refusal in output"
  if [ $anchor_ok -eq 1 ]; then
    ok "anchor fails closed on an unusable TMPDIR, for the right reason, cwd intact"
  else
    bad "anchor regression: $anchor_why" "exit=$rc_anchor out=$(echo "$out_anchor" | tail -2)"
  fi
fi

echo
if [ $fail -eq 0 ]; then
  echo "✓ pre-push checkout selection: $pass checks passed"
  exit 0
fi
echo "✗ pre-push checkout selection: $fail failed, $pass passed"
exit 1
