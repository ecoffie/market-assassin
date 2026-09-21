import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { writeRegistryFile, readRegistryFile } from './registry';
import { repairSupersessionLink } from './operations';
import {
  assertNoActiveLease,
  assertRepairable,
  deriveSupersessionEvidence,
  validateRepairInput,
} from './supersession-repair';
import { supersessionChain } from './supersession';
import { assertRegistryInvariants } from './validate';
import { createLease } from './lease';
import { testProvenance } from './test-registry-fixture';
import type { AgentTaskRegistry, TaskAuditEntry, TaskRecord } from './types';

/**
 * PHASE 3A.5 (A) — audited supersession-link repair.
 *
 * The live pilot registry records a supersession in its AUDIT trail (revision 11) whose
 * DURABLE fields were never written. These tests hold the repair to the contract that it
 * may only ever re-materialize a relationship two independent audits already agree on.
 *
 * Every test uses a DISPOSABLE registry under tmpdir. The real runtime registry at
 * {git-common-dir}/agent-tasks/registry.json is never opened, and never written.
 */

const SRC = 'TASK-PSTACK-PILOT-001';
const SUC = 'TASK-PSTACK-PILOT-002';
const OLD_BASE = '3c827cdc0a96f1ec5ab2384020bcf758726d0cc8';
const NEW_BASE = '5d8a3007e2aa931a41978705de030a6e304cc359';
const RUNBOOK = 'docs/engineering/pstack-phase-3a-pilot-runbook.md';
const AT = '2026-08-31T02:03:38.323Z';
const ACTOR = 'eric-orchestrator';
const NOW = Date.parse('2026-08-31T04:00:00.000Z');

let dir: string;
let reg: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pstack-repair-'));
  reg = join(dir, 'registry.json');
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const sha = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex');

function task(over: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: SRC,
    title: 'Pilot runbook',
    priority: 'normal',
    state: 'cancelled',
    authorizedScope: 'Author the Phase 3A pilot runbook',
    allowedPaths: [RUNBOOK],
    forbiddenPaths: ['src/', 'package.json'],
    dependencies: [],
    assignedRole: null,
    branch: 'docs/pstack-phase-3a-pilot',
    worktree: '.claude/worktrees/pstack-phase-3a-pilot',
    baseSha: OLD_BASE,
    lease: null,
    verificationProfile: ['docs-only'],
    allowSameAgentVerification: false,
    checkpoints: [],
    auditLog: [],
    prRef: null,
    mergeSha: null,
    deploymentRef: null,
    deploySha: null,
    allowedMutations: ['repo_files', 'git_commit'],
    approvalRequired: 'eric_explicit',
    supersededByTaskId: null,
    supersedesTaskId: null,
    createdAt: '2026-08-30T22:40:00.000Z',
    updatedAt: AT,
    ...over,
  };
}

/** The SOURCE's `supersede` audit, exactly as the live registry carries it. */
function supersedeAudit(over: Partial<TaskAuditEntry> = {}): TaskAuditEntry {
  return {
    id: 'audit-1788141818323-supersede',
    at: AT,
    actor: ACTOR,
    action: 'supersede',
    fromState: 'ready',
    toState: 'cancelled',
    evidenceRef: `supersede -> ${SUC}`,
    metadata: {
      registryRevision: '11',
      leaseOwner: 'none',
      role: 'administrator',
      reason: 'Base 3c827cdc is stale; origin/main advanced',
      supersededByTaskId: SUC,
      oldBaseSha: OLD_BASE,
      newBaseSha: NEW_BASE,
      currentMainSha: NEW_BASE,
    },
    ...over,
  };
}

/** The SUCCESSOR's corroborating `superseded-from` audit. */
function supersededFromAudit(over: Partial<TaskAuditEntry> = {}): TaskAuditEntry {
  return {
    id: 'audit-1788141818323-superseded-from',
    at: AT,
    actor: ACTOR,
    action: 'superseded-from',
    fromState: 'proposed',
    toState: 'ready',
    evidenceRef: `superseded-from ${SRC}`,
    metadata: {
      registryRevision: '11',
      leaseOwner: 'none',
      role: 'administrator',
      reason: 'Base 3c827cdc is stale; origin/main advanced',
      supersedesTaskId: SRC,
      sourceTaskId: SRC,
      newBaseSha: NEW_BASE,
      oldBaseSha: OLD_BASE,
    },
    ...over,
  };
}

/** The LIVE shape: durable fields null, audits intact, both leases released. */
function liveShaped(over: { source?: Partial<TaskRecord>; successor?: Partial<TaskRecord> } = {}) {
  const source = task({ auditLog: [supersedeAudit()], ...over.source });
  const successor = task({
    id: SUC,
    state: 'integration',
    branch: 'docs/pstack-phase-3a-pilot-v2',
    worktree: '.claude/worktrees/pstack-phase-3a-pilot-v2',
    baseSha: NEW_BASE,
    auditLog: [supersededFromAudit()],
    ...over.successor,
  });
  return { source, successor };
}

function registry(tasks: TaskRecord[], revision = 18, version: 1 | 2 = 2): AgentTaskRegistry {
  return {
    version,
    revision,
    updatedAt: AT,
    tasks: Object.fromEntries(tasks.map((t) => [t.id, t])),
    adminAuditLog: [],
    ...(version === 2 ? { provenance: testProvenance() } : {}),
  } as AgentTaskRegistry;
}

function seed(over?: Parameters<typeof liveShaped>[0], revision = 18, version: 1 | 2 = 2) {
  const { source, successor } = liveShaped(over);
  writeRegistryFile(reg, registry([source, successor], revision, version));
}

function input(over: Record<string, unknown> = {}) {
  return {
    taskId: SRC,
    actor: 'eric-admin',
    role: 'administrator',
    reason: 'Re-materialize the durable supersession link proven by revision 11 audits',
    confirm: true,
    nowMs: NOW,
    ...over,
  } as Parameters<typeof repairSupersessionLink>[1];
}

describe('3A.5 A — the exact TASK-001/TASK-002 live-shaped repair', () => {
  it('repairs BOTH durable fields from audit evidence alone', () => {
    seed();
    const r = repairSupersessionLink(reg, input());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.source.supersededByTaskId).toBe(SUC);
    expect(r.value.successor.supersedesTaskId).toBe(SRC);

    const after = readRegistryFile(reg);
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    expect(after.value.tasks[SRC].supersededByTaskId).toBe(SUC);
    expect(after.value.tasks[SUC].supersedesTaskId).toBe(SRC);
  });

  it('derives the successor id EXCLUSIVELY from the audit pair', () => {
    seed();
    const loaded = readRegistryFile(reg);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const d = deriveSupersessionEvidence(loaded.value, SRC);
    expect(d.ok).toBe(true);
    if (!d.ok) return;
    expect(d.value.successorTaskId).toBe(SUC);
    expect(d.value.registryRevision).toBe('11');
    expect(d.value.at).toBe(AT);
    expect(d.value.actor).toBe(ACTOR);
    expect(d.value.sourceAuditId).toBe('audit-1788141818323-supersede');
    expect(d.value.successorAuditId).toBe('audit-1788141818323-superseded-from');
  });

  it('makes the supersession chain traversable: TASK-001 -> TASK-002', () => {
    seed();
    repairSupersessionLink(reg, input());
    const after = readRegistryFile(reg);
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    expect(supersessionChain(after.value, SRC)).toEqual([SRC, SUC]);
  });

  it('advances the registry revision EXACTLY once', () => {
    seed(undefined, 18);
    const r = repairSupersessionLink(reg, input());
    expect(r.ok && r.revision).toBe(19);
    const after = readRegistryFile(reg);
    expect(after.ok && after.value.revision).toBe(19);
  });

  it('post-repair invariants pass', () => {
    seed();
    repairSupersessionLink(reg, input());
    const after = readRegistryFile(reg);
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    expect(assertRegistryInvariants(after.value)).toBeNull();
  });

  it('appends a supersession-link-repaired audit to BOTH tasks with admin, reason and supporting ids', () => {
    seed();
    repairSupersessionLink(reg, input());
    const after = readRegistryFile(reg);
    if (!after.ok) return;
    for (const id of [SRC, SUC]) {
      const audits = after.value.tasks[id].auditLog.filter(
        (a) => a.action === 'supersession-link-repaired',
      );
      expect(audits).toHaveLength(1);
      const a = audits[0];
      expect(a.actor).toBe('eric-admin');
      expect(a.metadata.reason).toContain('Re-materialize');
      expect(a.metadata.repairedSourceTaskId).toBe(SRC);
      expect(a.metadata.repairedSuccessorTaskId).toBe(SUC);
      expect(a.metadata.derivedFromSourceAuditId).toBe('audit-1788141818323-supersede');
      expect(a.metadata.derivedFromSuccessorAuditId).toBe('audit-1788141818323-superseded-from');
      expect(a.metadata.role).toBe('administrator');
    }
  });

  it('preserves states, bases, branches, worktrees, scopes, leases and checkpoints', () => {
    seed();
    // Baseline is the registry AS PARSED FROM DISK, not the in-memory literal:
    // parseTaskRecord normalizes absent optional fields to null, so comparing against
    // the literal would flag a difference the repair did not make.
    const baseline = readRegistryFile(reg);
    expect(baseline.ok).toBe(true);
    if (!baseline.ok) return;
    const before = {
      source: baseline.value.tasks[SRC],
      successor: baseline.value.tasks[SUC],
    };

    repairSupersessionLink(reg, input());
    const after = readRegistryFile(reg);
    if (!after.ok) return;

    for (const original of [before.source, before.successor]) {
      const now = after.value.tasks[original.id];
      // Everything EXCEPT the two link fields, the appended audit, and updatedAt.
      const strip = (t: TaskRecord) => {
        const {
          supersededByTaskId: _a,
          supersedesTaskId: _b,
          auditLog: _c,
          updatedAt: _d,
          ...rest
        } = t;
        return rest;
      };
      expect(strip(now)).toEqual(strip(original));
      // Prior audits ride through byte-identical, in order.
      expect(now.auditLog.slice(0, original.auditLog.length)).toEqual(original.auditLog);
      expect(now.checkpoints).toEqual(original.checkpoints);
      expect(now.state).toBe(original.state);
      expect(now.baseSha).toBe(original.baseSha);
      expect(now.branch).toBe(original.branch);
      expect(now.worktree).toBe(original.worktree);
      expect(now.lease).toBeNull();
    }
  });

  it('leaves UNRELATED tasks byte-identical', () => {
    const { source, successor } = liveShaped();
    const unrelated = task({
      id: 'TASK-UNRELATED-009',
      state: 'ready',
      branch: 'feat/unrelated',
      worktree: '.claude/worktrees/unrelated',
      allowedPaths: ['docs/other.md'],
      auditLog: [],
    });
    writeRegistryFile(reg, registry([source, successor, unrelated], 18));
    // Byte-level comparison of the unrelated record's serialized form, taken from disk
    // before and after, so normalization by the parser cannot mask a real change.
    const beforeParsed = readRegistryFile(reg);
    if (!beforeParsed.ok) return;
    const beforeJson = JSON.stringify(beforeParsed.value.tasks['TASK-UNRELATED-009']);

    repairSupersessionLink(reg, input());
    const after = readRegistryFile(reg);
    if (!after.ok) return;
    expect(JSON.stringify(after.value.tasks['TASK-UNRELATED-009'])).toBe(beforeJson);
  });
});

describe('3A.5 A — evidence must be present, unambiguous and mutually consistent', () => {
  it('refuses when the source has NO supersede audit', () => {
    const { successor } = liveShaped();
    writeRegistryFile(reg, registry([task({ auditLog: [] }), successor], 18));
    const r = repairSupersessionLink(reg, input());
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('insufficient_repair_evidence');
    expect(r.message).toContain('no supersede audit');
  });

  it('refuses AMBIGUOUS evidence — two supersede audits on the source', () => {
    const { successor } = liveShaped();
    writeRegistryFile(
      reg,
      registry(
        [
          task({
            auditLog: [supersedeAudit(), supersedeAudit({ id: 'audit-2-supersede' })],
          }),
          successor,
        ],
        18,
      ),
    );
    const r = repairSupersessionLink(reg, input());
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('insufficient_repair_evidence');
    expect(r.message).toContain('ambiguous lineage');
  });

  it('refuses AMBIGUOUS evidence — two superseded-from audits on the successor', () => {
    seed({
      successor: {
        auditLog: [supersededFromAudit(), supersededFromAudit({ id: 'audit-2-superseded-from' })],
      },
    });
    const r = repairSupersessionLink(reg, input());
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.message).toContain('ambiguous lineage');
  });

  it('refuses when the successor named by the audit does not exist', () => {
    writeRegistryFile(reg, registry([task({ auditLog: [supersedeAudit()] })], 18));
    const r = repairSupersessionLink(reg, input());
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.message).toContain('does not exist in this registry');
  });

  it('refuses when the successor carries NO corroborating audit', () => {
    seed({ successor: { auditLog: [] } });
    const r = repairSupersessionLink(reg, input());
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.message).toContain('does not corroborate');
  });

  it('refuses CONFLICTING supersedesTaskId on the successor', () => {
    seed({
      successor: {
        auditLog: [
          supersededFromAudit({
            metadata: { ...supersededFromAudit().metadata, supersedesTaskId: 'TASK-OTHER-777' },
          }),
        ],
      },
    });
    const r = repairSupersessionLink(reg, input());
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.message).toContain('conflicts with source');
  });

  it('refuses when the corroborating sourceTaskId disagrees', () => {
    seed({
      successor: {
        auditLog: [
          supersededFromAudit({
            metadata: { ...supersededFromAudit().metadata, sourceTaskId: 'TASK-OTHER-777' },
          }),
        ],
      },
    });
    const r = repairSupersessionLink(reg, input());
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.message).toContain('corroborating sourceTaskId');
  });

  it('refuses a MISMATCHED registry revision between the two audits', () => {
    seed({
      successor: {
        auditLog: [
          supersededFromAudit({
            metadata: { ...supersededFromAudit().metadata, registryRevision: '12' },
          }),
        ],
      },
    });
    const r = repairSupersessionLink(reg, input());
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.message).toContain('registryRevision');
  });

  it('refuses a MISMATCHED timestamp between the two audits', () => {
    seed({ successor: { auditLog: [supersededFromAudit({ at: '2026-08-31T09:99:00.000Z' })] } });
    const r = repairSupersessionLink(reg, input());
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.message).toContain('timestamp');
  });

  it('refuses a MISMATCHED actor between the two audits', () => {
    seed({ successor: { auditLog: [supersededFromAudit({ actor: 'someone-else' })] } });
    const r = repairSupersessionLink(reg, input());
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.message).toContain('actor');
  });

  it('refuses a self-referential audit', () => {
    writeRegistryFile(
      reg,
      registry(
        [
          task({
            auditLog: [
              supersedeAudit({
                metadata: { ...supersedeAudit().metadata, supersededByTaskId: SRC },
              }),
            ],
          }),
        ],
        18,
      ),
    );
    const r = repairSupersessionLink(reg, input());
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.message).toContain('supersedes itself');
  });

  it('refuses an unknown source task', () => {
    seed();
    const r = repairSupersessionLink(reg, input({ taskId: 'TASK-NOPE-000' }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('task_not_found');
  });
});

describe('3A.5 A — lease, authorization and repeat-repair gates', () => {
  it('refuses when the SOURCE holds an active lease', () => {
    seed({ source: { state: 'integration', lease: createLease('someone', 'integrator', NOW) } });
    const r = repairSupersessionLink(reg, input());
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('lease_conflict');
    expect(r.message).toContain(SRC);
  });

  it('refuses when the SUCCESSOR holds an active lease', () => {
    seed({ successor: { lease: createLease('integrator-v2', 'integrator', NOW) } });
    const r = repairSupersessionLink(reg, input());
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('lease_conflict');
    expect(r.message).toContain(SUC);
  });

  it('PERMITS repair when a lease has EXPIRED (recoverable, unlike an active one)', () => {
    const stale = createLease('gone', 'integrator', NOW - 10 * 60 * 60 * 1000);
    seed({ successor: { lease: stale } });
    const r = repairSupersessionLink(reg, input());
    expect(r.ok).toBe(true);
  });

  it('requires the administrator role', () => {
    seed();
    const r = repairSupersessionLink(reg, input({ role: 'builder' }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('unauthorized_actor');
  });

  it('requires --confirm', () => {
    seed();
    const r = repairSupersessionLink(reg, input({ confirm: false }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.message).toContain('--confirm');
  });

  it('requires a non-empty reason', () => {
    seed();
    for (const reason of ['', '   ']) {
      const r = repairSupersessionLink(reg, input({ reason }));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.message).toContain('--reason');
    }
  });

  it('requires an actor', () => {
    seed();
    const r = repairSupersessionLink(reg, input({ actor: '' }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('unauthorized_actor');
  });

  it('a REPEAT repair fails closed as already_repaired — no audited no-op', () => {
    seed();
    const first = repairSupersessionLink(reg, input());
    expect(first.ok).toBe(true);
    const beforeSecond = sha(reg);

    const second = repairSupersessionLink(reg, input());
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.code).toBe('already_repaired');

    // The refusal must not touch the file at all: no revision bump, no audit entry.
    expect(sha(reg)).toBe(beforeSecond);
    const after = readRegistryFile(reg);
    if (!after.ok) return;
    expect(after.value.revision).toBe(19);
    expect(
      after.value.tasks[SRC].auditLog.filter((a) => a.action === 'supersession-link-repaired'),
    ).toHaveLength(1);
  });

  it('refuses a HALF-written link — rejected as a malformed registry BEFORE repair runs', () => {
    // An asymmetric durable link is not merely unrepairable, it is an INVALID registry:
    // assertRegistryInvariants rejects it at read time. The refusal therefore arrives as
    // malformed_registry, which is the stronger outcome — the file is never even opened
    // for mutation. assertRepairable covers the same shape at the unit level below.
    seed({ source: { supersededByTaskId: SUC } });
    const before = sha(reg);
    const r = repairSupersessionLink(reg, input());
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('malformed_registry');
    expect(r.message).toContain('not mutual');
    expect(sha(reg)).toBe(before);
  });

  it('assertRepairable refuses a HALF-written link at the unit level', () => {
    const { source, successor } = liveShaped({ source: { supersededByTaskId: SUC } });
    const r = assertRepairable(source, successor);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('insufficient_repair_evidence');
    expect(r.message).toContain('half-written');
  });

  it('refuses when an existing durable link CONFLICTS with the derived pair', () => {
    // Both halves point at a task that does not exist -> the registry itself is invalid,
    // so the read fails closed before any repair decision is made.
    const { source, successor } = liveShaped({
      source: { supersededByTaskId: 'TASK-OTHER-777' },
      successor: { supersedesTaskId: 'TASK-OTHER-777' },
    });
    writeRegistryFile(reg, registry([source, successor], 18));
    const before = sha(reg);
    const r = repairSupersessionLink(reg, input());
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('malformed_registry');
    expect(sha(reg)).toBe(before);
  });

  it('assertRepairable refuses a CONFLICTING durable pair at the unit level', () => {
    const { source, successor } = liveShaped({
      source: { supersededByTaskId: 'TASK-OTHER-777' },
      successor: { supersedesTaskId: 'TASK-OTHER-777' },
    });
    const r = assertRepairable(source, successor);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('insufficient_repair_evidence');
    expect(r.message).toContain('conflicts with the derived pair');
  });
});

describe('3A.5 A — atomicity: a failed write leaves the registry byte-identical', () => {
  it('an injected write failure changes NOTHING', () => {
    seed();
    const before = sha(reg);
    const beforeText = readFileSync(reg, 'utf8');

    // Make the containing directory read-only so the tmp+rename write cannot land.
    chmodSync(dir, 0o500);
    let r: ReturnType<typeof repairSupersessionLink>;
    try {
      r = repairSupersessionLink(reg, input());
    } finally {
      chmodSync(dir, 0o700);
    }

    expect(r.ok).toBe(false);
    expect(sha(reg)).toBe(before);
    expect(readFileSync(reg, 'utf8')).toBe(beforeText);
  });

  it('a refusal mid-validation leaves the registry byte-identical', () => {
    seed({ successor: { auditLog: [] } });
    const before = sha(reg);
    const r = repairSupersessionLink(reg, input());
    expect(r.ok).toBe(false);
    expect(sha(reg)).toBe(before);
  });

  it('both fields are written together — the registry never observes a half-repair', () => {
    seed();
    repairSupersessionLink(reg, input());
    const after = readRegistryFile(reg);
    if (!after.ok) return;
    const a = after.value.tasks[SRC].supersededByTaskId;
    const b = after.value.tasks[SUC].supersedesTaskId;
    expect(Boolean(a)).toBe(Boolean(b));
    // assertRegistryInvariants rejects an asymmetric link, so a readable registry
    // proves the pair landed together.
    expect(assertRegistryInvariants(after.value)).toBeNull();
  });
});

describe('3A.5 A — pure helpers', () => {
  it('validateRepairInput gates role, confirm, reason, actor and task id', () => {
    const base = { taskId: SRC, actor: 'a', role: 'administrator', reason: 'r', confirm: true };
    expect(validateRepairInput(base).ok).toBe(true);
    expect(validateRepairInput({ ...base, role: 'verifier' }).ok).toBe(false);
    expect(validateRepairInput({ ...base, confirm: false }).ok).toBe(false);
    expect(validateRepairInput({ ...base, reason: ' ' }).ok).toBe(false);
    expect(validateRepairInput({ ...base, actor: '' }).ok).toBe(false);
    expect(validateRepairInput({ ...base, taskId: '' }).ok).toBe(false);
  });

  it('assertRepairable reports already_repaired only for the MATCHING pair', () => {
    const { source, successor } = liveShaped({
      source: { supersededByTaskId: SUC },
      successor: { supersedesTaskId: SRC },
    });
    const r = assertRepairable(source, successor);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('already_repaired');
  });

  it('assertNoActiveLease accepts two released tasks', () => {
    const { source, successor } = liveShaped();
    expect(assertNoActiveLease(source, successor, NOW).ok).toBe(true);
  });
});
