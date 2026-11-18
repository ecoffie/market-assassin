#!/usr/bin/env bash
# Machine-wide limit on concurrent pre-push gate runs (2026-11-17).
#
# Why: this 16-core Mac runs many Claude sessions and agents. Each gate run starts a ~2 GB `tsc`
# plus vitest with up to 8 forked workers. On 2026-11-17, 5–6 gates ran at once and the load
# average reached 65. pglite suites timed out in setup and workers died ("Channel closed"), so
# correct branches were blocked and pushes needed repeated retries. The fix is to queue, never to
# skip: at most MINDY_GATE_SLOTS gate runs hold a slot; the rest wait. A run that cannot get a
# slot within the timeout BLOCKS the push (fail closed). It never bypasses the tests.
#
# Slots are directories (mkdir is atomic) holding the owner's PID. A slot whose owner is gone
# (crash, kill -9, closed terminal) is reclaimed.
#
# Env (all optional):
#   MINDY_GATE_SLOTS           max concurrent gate runs        (default 2)
#   MINDY_GATE_SLOT_DIR        slot directory                  (default ~/.cache/mindy-gate-slots)
#   MINDY_GATE_SLOT_TIMEOUT_S  max wait before blocking push   (default 2700 = 45 min)
#   MINDY_GATE_SLOT_POLL_S     poll interval                   (default 5)
#
# Usage (sourced): gate_slot_acquire || exit 1 ; trap gate_slot_release EXIT

GATE_SLOT_HELD=""

_gate_slot_reclaim_if_stale() {
  local slot="$1" pid
  [ -d "$slot" ] || return 0
  pid="$(cat "$slot/pid" 2>/dev/null || true)"
  if [ -n "$pid" ]; then
    kill -0 "$pid" 2>/dev/null && return 0   # owner alive → keep
    rm -rf "$slot"                            # owner gone → reclaim
    return 0
  fi
  # No pid yet: the owner may be between mkdir and writing the pid. Reclaim only if old.
  if [ -n "$(find "$slot" -maxdepth 0 -mmin +1 2>/dev/null)" ]; then rm -rf "$slot"; fi
}

gate_slot_acquire() {
  local slots="${MINDY_GATE_SLOTS:-2}"
  local dir="${MINDY_GATE_SLOT_DIR:-$HOME/.cache/mindy-gate-slots}"
  local timeout="${MINDY_GATE_SLOT_TIMEOUT_S:-2700}"
  local poll="${MINDY_GATE_SLOT_POLL_S:-5}"
  local owner="${GATE_SLOT_OWNER_PID:-$$}"
  local start now waited last_note=0 i slot
  mkdir -p "$dir" 2>/dev/null || { echo "✗ gate slot: cannot create $dir — blocking push." >&2; return 1; }
  start=$(date +%s)
  while :; do
    for i in $(seq 1 "$slots"); do
      slot="$dir/slot-$i"
      _gate_slot_reclaim_if_stale "$slot"
      if mkdir "$slot" 2>/dev/null; then
        printf '%s\n' "$owner" > "$slot/pid"
        printf '%s\n' "${GATE_SLOT_LABEL:-$PWD}" > "$slot/label" 2>/dev/null || true
        GATE_SLOT_HELD="$slot"
        return 0
      fi
    done
    now=$(date +%s); waited=$((now - start))
    if [ "$waited" -ge "$timeout" ]; then
      echo "✗ gate slot: all $slots slots busy for ${waited}s — push BLOCKED (fail closed). Retry when other gate runs finish; never --no-verify." >&2
      for slot in "$dir"/slot-*; do [ -d "$slot" ] && echo "    held by pid $(cat "$slot/pid" 2>/dev/null) — $(cat "$slot/label" 2>/dev/null)" >&2; done
      return 1
    fi
    if [ $((waited - last_note)) -ge 30 ] || [ "$last_note" -eq 0 ]; then
      echo "  … waiting for a gate slot ($slots in use machine-wide; ${waited}s so far)" >&2
      last_note=$waited; [ "$last_note" -eq 0 ] && last_note=1
    fi
    sleep "$poll"
  done
}

gate_slot_release() {
  if [ -n "$GATE_SLOT_HELD" ] && [ -d "$GATE_SLOT_HELD" ]; then
    # Only remove a slot we still own.
    if [ "$(cat "$GATE_SLOT_HELD/pid" 2>/dev/null)" = "${GATE_SLOT_OWNER_PID:-$$}" ]; then rm -rf "$GATE_SLOT_HELD"; fi
  fi
  GATE_SLOT_HELD=""
}
