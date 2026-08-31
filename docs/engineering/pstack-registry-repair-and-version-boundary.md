# PStack Phase 3A.5 — supersession-link repair, registry version boundary, worktree-only execution

Status: implemented, uncommitted checkpoint. Covers three bounded changes to the agent-task
control plane:

- **A.** an administrator-only, evidence-derived **supersession-link repair**
- **B.** a **registry format version boundary** (v1 → v2) that quarantines older writers
- **C.** **healthy-worktree enforcement** for every registry mutation

---

## A. Supersession-link repair

### The defect

The live pilot registry records a supersession that genuinely happened. At revision 11 an
administrator superseded `TASK-PSTACK-PILOT-001` with `TASK-PSTACK-PILOT-002`, and both
halves of that write are present in the audit trail:

| record | audit action | metadata |
|---|---|---|
| TASK-001 | `supersede` | `supersededByTaskId: TASK-PSTACK-PILOT-002`, `registryRevision: 11` |
| TASK-002 | `superseded-from` | `supersedesTaskId` + `sourceTaskId: TASK-PSTACK-PILOT-001`, `registryRevision: 11` |

Both audits carry the same timestamp (`2026-08-31T02:03:38.323Z`) and the same actor
(`eric-orchestrator`), because they were written in one atomic mutation.

But the **durable** fields — `supersededByTaskId` on the source and `supersedesTaskId` on
the successor — are `null`. The writer generation of the day recorded the relationship only
in the audit log.

The consequence is narrow but real: the lineage is **provable but not traversable**.
`supersessionChain` walks the durable fields and sees nothing, and
`assertRegistryInvariants` cannot enforce a link it cannot see.

### Why this is not a field editor

The obvious shape for a fix — `--field supersededByTaskId --value TASK-...` — would be a
general-purpose registry rewriter wearing a repair costume. It would let an administrator
**assert** any lineage at all, which is exactly the class of claim this registry exists to
make impossible. A repair that can invent a relationship is indistinguishable, on disk,
from the corruption it claims to fix.

**The contract instead:** the caller supplies only the **source task id**. Everything else
— the successor id above all — is derived from the audit pair and cross-checked. There is
no flag that can name a successor, and no flag that can name a field or a value.

### The command

```
npm run agent-task -- repair-supersession-link TASK-PSTACK-PILOT-001 \
  --actor <administrator> \
  --role administrator \
  --reason "<non-empty reason>" \
  --confirm
```

`--field`, `--value`, `--successor`, `--new-task`, `--set` and SHA overrides are rejected
explicitly, so the absence of a rewrite interface is enforced rather than merely undocumented.

### What must hold before anything is written

Evidence derivation (`src/lib/agent-tasks/supersession-repair.ts`) requires **all** of:

1. exactly **one** `supersede` audit on the source — ambiguity is a refusal, never "latest wins"
2. that audit names a successor which **exists** in this registry
3. exactly **one** `superseded-from` audit on that successor
4. the two audits agree on **source id, successor id, registry revision, timestamp, and actor**
5. the successor's corroborating **`sourceTaskId`** metadata agrees as well

Point 5 is not redundant with point 4. `supersedesTaskId` and `sourceTaskId` are written as
separate keys, so requiring both means a single hand-edited key cannot manufacture a link —
a forgery would have to be consistent across two records and two independent keys.

Then:

- **Neither task may hold an ACTIVE lease** (an *expired* lease is recoverable and permitted).
- Both durable fields must be genuinely **absent**. A half-written link is refused rather
  than half-endorsed; a conflicting pair is refused; and an already-correct pair returns
  **`already_repaired`**.

### Failure vocabulary

| code | meaning |
|---|---|
| `unauthorized_actor` | role / `--confirm` / `--reason` / `--actor` missing |
| `task_not_found` | unknown source task |
| `insufficient_repair_evidence` | missing, ambiguous, conflicting or mutually inconsistent audits |
| `lease_conflict` | either task holds an active lease |
| `already_repaired` | the link is already durable |
| `malformed_registry` | the registry itself is invalid (e.g. an asymmetric link) — refused at read time |

### Atomicity and recovery semantics

The write goes through the single `mutateRegistry` choke-point, so:

- both durable fields land in **one** revision — the registry never observes a half-repair,
  and `assertRegistryInvariants` would reject one anyway (a self-enforcing backstop)
- the registry revision advances **exactly once**
- states, bases, branches, worktrees, scopes, leases, checkpoints, prior audits and every
  unrelated task ride through **byte-identical**
- a `supersession-link-repaired` audit is appended to **both** tasks, carrying the
  administrator, the reason, the derived source/successor ids, and the **supporting audit ids**
- **a refusal leaves the file byte-identical** — validation precedes the write, and an
  injected write failure (read-only directory) is proven to change nothing
- **a repeat repair fails closed** rather than creating an audited no-op. A no-op would
  advance the revision and append an audit describing a change that did not happen — a small
  lie the registry would then carry forever.

---

## B. Registry format version boundary (v1 → v2)

### The problem

An older CLI generation parses a modern registry, understands only the fields it knows, and
writes back a record that has silently lost everything newer. Nothing errors. The registry
simply becomes quietly wrong.

### Why version 2 is a real boundary — measured, not assumed

Every parser generation shipped before 3A.5 begins `parseRegistry` with:

```ts
if (o.version !== 1) return null;
```

That is the **first structural check**, ahead of record parsing. Rather than trust the
reading, each historical generation was materialized from its real git blob and **executed**
against a version-2 registry on disk:

| generation | `parseRegistry` | `readRegistryFile` | `mutateRegistry` | mutator body ran | bytes unchanged | still v2 |
|---|---|---|---|---|---|---|
| `27f0f935` | rejected (null) | `malformed_registry` | `malformed_registry` | **no** | **yes** | yes |
| `4b6c511c` | rejected (null) | `malformed_registry` | `malformed_registry` | **no** | **yes** | yes |
| `5d8a3007` | rejected (null) | `malformed_registry` | `malformed_registry` | **no** | **yes** | yes |
| `dd90ea7c` | rejected (null) | `malformed_registry` | `malformed_registry` | **no** | **yes** | yes |

**Control:** the same writers mutate a *version-1* registry successfully (revision 18 → 19,
bytes changed), which proves the harness works and the rejection is about the version rather
than a broken probe.

The decisive columns are *mutator body ran: no* and *bytes unchanged: yes* — an old writer
fails closed **before** reaching a mutation path, so it cannot drop fields it does not
understand. This experiment is retained as a permanent regression guard in
`agent-tasks-registry-repair.e2e.test.ts`; if version 2 ever became readable by an old
writer, the quarantine would be silently gone and that test is what catches it.

### The rules

- **Ordinary mutations refuse a version-1 registry** with `registry_upgrade_required`.
- **Version 1 stays READABLE.** The refusal is about mutation, not inspection — `list`,
  `deps` and `doctor` still answer, which is how an operator diagnoses a broken environment.
- **The bounded administrator repair/migration path may read v1** and atomically upgrade it
  to v2 **in the same single revision** as the repair.
- **Unknown versions fail closed** before records are parsed or a mutation path is entered.

### Execution provenance

Every version-2 write records who wrote it and from where:

```jsonc
"provenance": {
  "writerVersion": 2,               // writer generation
  "writerPath":   "/…/scripts/agent-task.mts",   // resolved CLI path
  "worktreePath": "/…/.claude/worktrees/<name>", // resolved invocation worktree
  "gitCommonDir": "/…/.git",
  "actor": "<lock owner>",
  "at": "<ISO>"
}
```

It is **required** on v2 and **forbidden** on v1 (a legacy file carrying one was not written
by any legitimate writer). It is **refreshed on every mutation**, not merely at creation, so
it always describes the most recent write. A malformed provenance block is a rejection, never
a silent drop — dropping it would erase the only record of which writer produced the state.

---

## C. Worktree-only execution

### The hole

A **bare** repository answers `git rev-parse --git-common-dir` perfectly well. Measured on
this repository, from the bare root:

```
--is-bare-repository   -> true
--is-inside-work-tree  -> false
--show-toplevel        -> fatal: this operation must be run in a work tree
--git-common-dir       -> .git          # resolves!
```

Because registry path resolution anchors on the common dir, the shared runtime registry was
fully **reachable — and therefore mutable — from the bare root**, where there is no checkout,
no branch, and no candidate worktree the operator could be reasoning about. A mutation issued
from there looks identical on disk to a legitimate one.

### The rule

`assertHealthyWorktree` (`src/lib/agent-tasks/worktree-health.ts`) refuses a mutation from:

- a **bare repository**
- a location **outside any work tree**
- a git dir that is **not a registered worktree** of the common dir
- a worktree whose backing directory has **gone missing** (stale/pruned registration)

The error names the remedy: *run from a healthy registered git worktree
(e.g. `.claude/worktrees/<branch-slug>`), not from the bare repository root.*

Two deliberate boundaries:

- **The check runs BEFORE the lock is acquired.** A caller that may not write must not be
  able to block one that may, and an unhealthy context should never leave lock debris in a
  shared runtime directory.
- **Read-only commands are NOT gated.** Refusing to answer questions from an unhealthy
  location would remove the only diagnostic tool available exactly when it is needed.

**Legitimate shared-runtime access is preserved:** the primary checkout and every linked
worktree resolve the *same* common dir, so they continue to reach the same runtime registry
at `{git-common-dir}/agent-tasks/registry.json`.

---

## Recovery semantics — quick reference

| situation | outcome |
|---|---|
| repair with valid evidence | both fields set, revision +1, v1→v2 migrated, audits appended to both tasks |
| repair run twice | `already_repaired`; file byte-identical, no revision bump, no audit |
| evidence missing/ambiguous/conflicting | `insufficient_repair_evidence`; file byte-identical |
| either task leased (active) | `lease_conflict`; file byte-identical |
| expired lease | permitted (recoverable) |
| write fails mid-operation | registry byte-identical (tmp+rename never lands) |
| ordinary mutation on a v1 registry | `registry_upgrade_required`; file byte-identical, still v1 |
| unknown registry version | fails closed before records are parsed |
| mutation from the bare root / outside a worktree | `unhealthy_worktree`; no lock taken, file byte-identical |
| read-only command from anywhere | still works |

## Test coverage

- `agent-tasks-supersession-repair.unit.test.ts` — derivation, every refusal branch, lease
  gates, authorization, atomicity, field preservation, repeat repair
- `agent-tasks-registry-version.unit.test.ts` — version parsing/gating, provenance
  lifecycle, bounded migration, worktree health (bare / outside / linked / stale)
- `agent-tasks-registry-repair.e2e.test.ts` — the real CLI against a **live-shaped** v1
  fixture, plus the historical-parser experiment as a permanent regression guard

Every test uses a **disposable** registry/repository under `tmpdir`. The real runtime
registry is never read, locked, or written by the suite.
