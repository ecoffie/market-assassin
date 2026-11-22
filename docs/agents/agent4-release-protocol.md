# Agent 4 release protocol

How builder PRs get from "draft" to "live and verified". This sits under CLAUDE.md rule 15 (release control) and never overrides it. Only Agent 4 coordinates merges to `main`. Builders never merge, arm auto-merge, or mark a PR ready in order to merge it. Branden's team (`claude/team-*`) reviews and merges its own work and is outside this protocol.

## Labels (hints, never authorization)
| Label | Meaning | Set by |
|---|---|---|
| `agent4:ready` | Handed off for review (`scripts/pr-handoff.mts` adds it) | builder |
| `agent4:changes` | Review asked for changes | Agent 4 |
| `agent4:green` / `agent4:yellow` / `agent4:red` | Review class | Agent 4 |
| `agent4:released` | Merged, live, production checks passed | release driver |
| `agent4:blocked` | Stopped: 3 failed attempts at one head, or production checks failed after release | release driver |

**Labels never authorize anything.** All agents share one GitHub identity, so anyone can set a label. A release is authorized only by a review record (below).

## Review record (the authorization)
A PR comment by Agent 4 containing exactly one fenced block tagged `agent4-review`:

````
```agent4-review
{"reviewer":"agent4","reviewed_sha":"<40-char head sha>","class":"GREEN","checks":["tests","tsc","diff read"]}
```
````

- `class` is `GREEN`, `YELLOW` or `RED`. YELLOW and RED also need `"eric_approval": {"quote": "<Eric's words>", "at": "<ISO time>"}`.
- **The driver accepts it only if:**
  - it is the **latest** review record on the PR;
  - it was **posted after the head commit's timestamp**;
  - it was **never edited** (`updated_at == created_at`). To change a review, post a new record;
  - `reviewed_sha` **equals the current head**. Any new push needs a new review.
- **Tamper-evident, not tamper-proof:** every agent posts as the same GitHub user. The rules above make a forged or altered record visible (edit timestamps, ordering against commits). They can't make one impossible. That's one reason unattended merging stays off until Eric decides.

## Release record (what the driver writes)
Fenced block tagged `agent4-release`:

```
{"type":"release","pr":2332,"status":"merged","sha":"<head>","merge_commit":"<sha>","at":"<ISO>"}
```

`status` is `merged`, `released`, `verify_failed`, `attempt_failed` or `blocked`. Records are append-only, and the driver rebuilds all of its state from them and the lock.

## The release driver: `scripts/agent-release.mts`
- **Stateless, one step per run, then exit.** It never sleeps. The caller schedules the next run.
  1. **A merge awaiting verification?** It finds one from a `merged` record with no `released`/`verify_failed` record, or from a lock naming a merged PR, which covers a crash between merge and record.
     - If production's build stamp (`<!-- maps-account-build:<sha> -->` on `/opportunity-map`) contains the merge, it runs the production checks, records the result, labels the PR `agent4:released` (or `agent4:blocked`) and releases the lock.
     - Otherwise it waits.
     - **It never merges again in this state.**
  2. **Otherwise,** it takes the oldest eligible PR and gates it:
     - review record valid for the exact head;
     - CI `verify` green on that head;
     - mergeable;
     - production == `main`;
     - the merged tree type-checks (in a throwaway worktree under `.agent-release/`).
     - Then it takes the lock, merges **pinned to the reviewed SHA** (`sha=`), records it and exits.
- **Serialization:**
  - Nothing merges while any merge awaits verification.
  - On top of that there's an **atomic lock**, the git ref `refs/agent4/release-lock`. It points at a parentless commit whose message is `{owner, pr, sha, expires_at}`.
  - Creating a ref that already exists fails, so taking the lock is a compare-and-swap.
  - An expired lock is taken over only after state is re-verified.
- **Eligibility:** open, non-draft, base `main`, a builder branch (`claude/*` but never `claude/team-*`), not `agent4:blocked`.
- **Failed attempts:** CI red, conflict, type-check failure or a refused merge count as failed attempts **for that head**. At 3, the PR is blocked. A new reviewed head starts again from zero.
- **No vercel commands, ever.**
- **Modes:**
  - **`--dry-run` is the default.** It prints the decision and changes nothing on GitHub.
  - **`--execute`** applies it.
  - Unattended (scheduled) execution stays **off** until Eric decides.

## Subscription hand-over
1. The builder subscribes to its PR while building, and fixes CI and review comments.
2. On handoff (`pr-handoff.mts` output sent to Agent 4, label `agent4:ready`), the builder **unsubscribes**, and Agent 4 subscribes.
3. After release the PR closes, and subscriptions end on their own.

## Fallback sweep
If events are missed, Agent 4 may run the driver every 10 minutes as a sweep. A sweep with nothing actionable prints `idle`/`wait` and exits at once. It does nothing else.

## Dry-run first
Every change to this process starts in dry-run. Compare the printed decisions with what Agent 4 would do by hand before any `--execute` run is trusted.
