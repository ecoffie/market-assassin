#!/usr/bin/env bash
#
# REAL-REPOSITORY regression for the pre-push gate's checkout selection.
#
# THE BUG THIS PINS: the gate derived its root from the HOOK FILE's location
# (`dirname "$0"/..`). `npm run hooks:install` sets `core.hooksPath` to an
# ABSOLUTE path inside the primary checkout, and every linked worktree shares
# that config — so a push from a worktree validated the PRIMARY tree. Measured
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

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RESOLVER="$REPO_ROOT/.githooks/resolve-checkout.sh"
# ⚠️ PHYSICAL path. On macOS /var is a symlink to /private/var, and
# `git rev-parse --show-toplevel` always answers with the resolved path — so
# comparing against an unresolved mktemp path fails on a correct resolver.
TMP="$(cd "$(mktemp -d "${TMPDIR:-/tmp}/prepush-sel-XXXXXX")" && pwd -P)"
pass=0; fail=0

cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

ok()   { echo "  ✓ $1"; pass=$((pass+1)); }
bad()  { echo "  ✗ FAIL: $1"; [ $# -gt 1 ] && echo "      $2"; fail=$((fail+1)); }

[ -x "$RESOLVER" ] || { echo "✗ missing/!executable: $RESOLVER"; exit 2; }

# ── fixture: bare remote + primary checkout + linked worktree ──────────────
setup_fixture() {
  local base="$1"
  mkdir -p "$base"
  git init --bare -q "$base/remote.git"
  git init -q "$base/primary"
  (
    cd "$base/primary"
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
  )
  # A linked worktree gets its own copy of the tracked files, including
  # package.json — confirm, because the resolver depends on it.
  [ -f "$base/worktree/package.json" ] || { echo "fixture broken: worktree has no package.json"; exit 2; }

  # THE CONDITION UNDER TEST: one shared, ABSOLUTE hooksPath in the primary.
  mkdir -p "$base/primary/.githooks"
  cp "$RESOLVER" "$base/primary/.githooks/resolve-checkout.sh"
  chmod +x "$base/primary/.githooks/resolve-checkout.sh"
  cat > "$base/primary/.githooks/pre-push" <<'HOOK'
#!/usr/bin/env bash
set -uo pipefail
HOOK_DIR="$(cd "$(dirname "$0")" && pwd)"
if ! ROOT="$("$HOOK_DIR/resolve-checkout.sh")"; then
  echo "GATE: could not establish checkout — blocking" >&2; exit 1
fi
cd "$ROOT" || exit 1
echo "GATE: validated checkout $ROOT"
echo "GATE: HEAD $(git rev-parse --short HEAD)"
if [ -f "$ROOT/FAIL" ]; then
  echo "GATE: this checkout is marked failing" >&2; exit 1
fi
exit 0
HOOK
  chmod +x "$base/primary/.githooks/pre-push"
  # Absolute + shared: exactly how `npm run hooks:install` leaves it.
  git -C "$base/primary" config core.hooksPath "$base/primary/.githooks"
}

# ── 1. valid worktree + FAILING primary  → push from worktree MUST SUCCEED ──
A="$TMP/case-a"; setup_fixture "$A"
touch "$A/primary/FAIL"                       # primary is broken
rm -f "$A/worktree/FAIL"                      # worktree is fine
(
  cd "$A/worktree"
  echo change > w.txt && git add -A && git commit -qm w
) >/dev/null 2>&1
out_a="$(cd "$A/worktree" && git push origin feature 2>&1)"; rc_a=$?
if [ $rc_a -eq 0 ]; then
  ok "valid worktree + failing primary → push allowed (gate read the worktree)"
else
  bad "valid worktree + failing primary → push was BLOCKED" "$(echo "$out_a" | tail -3)"
fi
if grep -qF "GATE: validated checkout $A/worktree" <<<"$out_a"; then
  ok "gate printed the worktree as the validated checkout"
else
  bad "gate did not name the worktree as the validated checkout" "$(echo "$out_a" | grep GATE: | head -2)"
fi
if grep -q "GATE: HEAD " <<<"$out_a"; then
  ok "gate printed the validated HEAD"
else
  bad "gate did not print the validated HEAD"
fi

# ── 2. FAILING worktree + valid primary → push from worktree MUST FAIL ──────
B="$TMP/case-b"; setup_fixture "$B"
rm -f "$B/primary/FAIL"                       # primary is fine
touch "$B/worktree/FAIL"                      # worktree is broken
(
  cd "$B/worktree"
  echo change > w.txt && git add -A && git commit -qm w
) >/dev/null 2>&1
out_b="$(cd "$B/worktree" && git push origin feature 2>&1)"; rc_b=$?
if [ $rc_b -ne 0 ]; then
  ok "failing worktree + valid primary → push blocked (no free pass from the primary)"
else
  bad "failing worktree + valid primary → push was ALLOWED — the gate read the wrong tree"
fi

# ── 3. the ORIGINAL buggy resolution must fail case 2 ───────────────────────
# Proves these cases actually discriminate, rather than passing for free.
C="$TMP/case-c"; setup_fixture "$C"
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
rm -f "$C/primary/FAIL"; touch "$C/worktree/FAIL"
( cd "$C/worktree"; echo c > c.txt; git add -A; git commit -qm c ) >/dev/null 2>&1
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
( cd "$notrepo" && git init -q && git config user.email t@t.t && git config user.name t \
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

echo
if [ $fail -eq 0 ]; then
  echo "✓ pre-push checkout selection: $pass checks passed"
  exit 0
fi
echo "✗ pre-push checkout selection: $fail failed, $pass passed"
exit 1
