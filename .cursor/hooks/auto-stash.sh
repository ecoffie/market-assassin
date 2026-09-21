#!/bin/bash
# Auto-stash hook — protects working-tree changes against Cursor restarts.
#
# Wired to sessionEnd (fires when a Cursor agent session ends, including
# before the app upgrades or quits). When the working tree has uncommitted
# changes, take a non-destructive snapshot:
#
#   1. `git stash push -u` captures everything (including untracked) under
#      a timestamped label like  "auto: cursor sessionEnd 2026-06-13T16:45:01"
#   2. `git stash apply` restores the working tree immediately, so the
#      user sees no change. The snapshot remains in the stash list as a
#      recoverable backup.
#   3. Log the stash ref to tasks/logs/auto-stash.log so the user has a
#      breadcrumb if something later goes sideways.
#   4. Cap auto-stashes at the most recent 20; older "auto:" prefixed
#      entries get dropped so the stash list stays clean.
#
# Recovery — if Cursor crashed and the working tree is gone:
#   git stash list                    # find the auto-stash you want
#   git stash apply stash@{N}         # restore it
#
# This hook FAILS OPEN. Any error path exits 0 so a hook failure never
# blocks Cursor from quitting cleanly.

set -u  # not -e — fail open
exec </dev/null  # don't read from stdin past initial JSON

# Read the hook-input JSON (per Cursor hook protocol). We don't actually
# use any field; the hook is purely cwd-aware. But we still drain stdin
# because Cursor will block waiting for the hook to consume it.
INPUT="$(cat || true)"
: "${INPUT:=}"

# Bail if we're not in a git repo. User hooks fire from any cwd, including
# non-repo directories; project hooks always fire from the project root,
# but we still defend just in case.
if ! command -v git >/dev/null 2>&1; then
  exit 0
fi

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  exit 0
fi

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"
[ -z "$REPO_ROOT" ] && exit 0
cd "$REPO_ROOT" || exit 0

LOG_DIR="$REPO_ROOT/tasks/logs"
LOG_FILE="$LOG_DIR/auto-stash.log"
mkdir -p "$LOG_DIR" 2>/dev/null || true

NOW="$(date '+%Y-%m-%dT%H:%M:%S%z')"
log() {
  printf '[%s] %s\n' "$NOW" "$*" >> "$LOG_FILE" 2>/dev/null || true
}

# Skip during rebase / merge / cherry-pick — stashing in those states can
# corrupt the in-progress operation.
GIT_DIR="$(git rev-parse --git-dir 2>/dev/null)"
for marker in MERGE_HEAD CHERRY_PICK_HEAD REVERT_HEAD rebase-merge rebase-apply; do
  if [ -e "$GIT_DIR/$marker" ]; then
    log "skip: in-progress $marker — not stashing"
    exit 0
  fi
done

# Anything to stash? `--porcelain` is empty when working tree is clean.
DIRTY_LINES="$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')"
if [ "$DIRTY_LINES" = "0" ] || [ -z "$DIRTY_LINES" ]; then
  exit 0
fi

LABEL="auto: cursor sessionEnd $NOW"

# Stash everything (-u includes untracked). Capture the new stash ref.
if git stash push -u -m "$LABEL" >/dev/null 2>&1; then
  STASH_REF="$(git rev-parse stash@{0} 2>/dev/null || echo unknown)"

  # Restore the working tree so the user sees no change. If apply
  # conflicts (rare — implies concurrent change to HEAD), leave the
  # stash on the list; the user can recover manually.
  if git stash apply --quiet stash@{0} 2>/dev/null; then
    log "stashed+restored ($DIRTY_LINES dirty entries) ref=$STASH_REF label=\"$LABEL\""
  else
    log "stashed but apply FAILED — recover with: git stash apply $STASH_REF"
  fi
else
  log "stash push failed (working tree was: $DIRTY_LINES dirty entries) — no snapshot taken"
fi

# Cap auto-stashes at the 20 most recent. Walk the stash list, count
# entries whose message starts with "auto: cursor sessionEnd", and drop
# anything beyond the 20th.
KEEP=20
# git stash list emits: stash@{N}: On <branch>: <label>
# We want indices of "auto:" entries, drop oldest first (highest index).
AUTO_INDICES="$(git stash list 2>/dev/null \
  | awk -F: '/auto: cursor sessionEnd/{ gsub(/[^0-9]/,"",$1); print $1 }' \
  | sort -n)"

# Count + drop. Highest indices = oldest stashes.
COUNT="$(printf '%s\n' "$AUTO_INDICES" | grep -c .)"
if [ "$COUNT" -gt "$KEEP" ] 2>/dev/null; then
  TO_DROP=$((COUNT - KEEP))
  # Take the LAST $TO_DROP entries from sorted indices (= oldest).
  # Drop in reverse-index order so each drop doesn't renumber the next.
  printf '%s\n' "$AUTO_INDICES" \
    | tail -n "$TO_DROP" \
    | sort -rn \
    | while read -r idx; do
        if git stash drop --quiet "stash@{$idx}" 2>/dev/null; then
          log "dropped old auto-stash stash@{$idx}"
        fi
      done
fi

exit 0
