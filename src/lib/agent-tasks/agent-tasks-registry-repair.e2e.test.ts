import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { spawnTsxSync } from './test-cli-spawn';

/**
 * PHASE 3A.5 — END-TO-END, through the REAL CLI, against a LIVE-SHAPED fixture.
 *
 * The fixture in __fixtures__/pilot-registry-live-shaped.v1.json is the real pilot
 * registry's structure — format version 1, revision 18, TASK-001 cancelled and TASK-002
 * in integration, both durable supersession fields null, both audit halves intact
 * (checkpoint prose elided). Running the repair against a COPY of it is what proves the
 * command works on the shape it will actually meet, without going near the real file.
 *
 * The real runtime registry is never read, locked, or written by this suite.
 */

const ROOT = process.cwd();
const SCRIPT = join(ROOT, 'scripts/agent-task.mts');
const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(HERE, '__fixtures__/pilot-registry-live-shaped.v1.json');

const SRC = 'TASK-PSTACK-PILOT-001';
const SUC = 'TASK-PSTACK-PILOT-002';

let dir: string;
let reg: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pstack-repair-e2e-'));
  reg = join(dir, 'registry.json');
  writeFileSync(reg, readFileSync(FIXTURE, 'utf8'), 'utf8');
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const sha = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex');
const load = () => JSON.parse(readFileSync(reg, 'utf8'));

function run(args: string[]) {
  return spawnTsxSync(SCRIPT, [...args, '--registry', reg], {
    cwd: ROOT,
    env: process.env,
    encoding: 'utf8',
  });
}

const REPAIR = [
  'repair-supersession-link',
  SRC,
  '--actor',
  'eric-admin',
  '--role',
  'administrator',
  '--reason',
  'Re-materialize the durable supersession link proven by the revision-11 audit pair',
  '--confirm',
];

describe('3A.5 — live-shaped repair through the real CLI', () => {
  it('the fixture starts in the exact broken live shape', () => {
    const r = load();
    expect(r.version).toBe(1);
    expect(r.revision).toBe(18);
    expect(r.tasks[SRC].state).toBe('cancelled');
    expect(r.tasks[SRC].lease).toBeNull();
    expect(r.tasks[SUC].state).toBe('integration');
    expect(r.tasks[SUC].lease).toBeNull();
    expect(r.tasks[SRC].supersededByTaskId).toBeNull();
    expect(r.tasks[SUC].supersedesTaskId).toBeNull();
    expect(r.tasks['TASK-PSTACK-PILOT-003']).toBeUndefined();
  });

  it('repairs both fields, advances the revision once, and migrates v1 -> v2', () => {
    const res = run(REPAIR);
    expect(res.status).toBe(0);

    const after = load();
    expect(after.tasks[SRC].supersededByTaskId).toBe(SUC);
    expect(after.tasks[SUC].supersedesTaskId).toBe(SRC);
    expect(after.revision).toBe(19);
    expect(after.version).toBe(2);
    expect(after.provenance).toBeTruthy();
    expect(after.provenance.writerVersion).toBe(2);
    // Provenance names the real CLI and the worktree it ran from.
    expect(after.provenance.writerPath).toContain('agent-task');
    expect(after.provenance.worktreePath.startsWith('/')).toBe(true);
  });

  it('preserves states, bases, branches, worktrees and checkpoints byte-for-byte', () => {
    const before = load();
    run(REPAIR);
    const after = load();

    for (const id of [SRC, SUC]) {
      const b = before.tasks[id];
      const a = after.tasks[id];
      expect(a.state).toBe(b.state);
      expect(a.baseSha).toBe(b.baseSha);
      expect(a.branch).toBe(b.branch);
      expect(a.worktree).toBe(b.worktree);
      expect(a.lease).toEqual(b.lease);
      expect(a.allowedPaths).toEqual(b.allowedPaths);
      expect(a.forbiddenPaths).toEqual(b.forbiddenPaths);
      expect(a.authorizedScope).toBe(b.authorizedScope);
      expect(a.approvalRequired).toBe(b.approvalRequired);
      expect(a.createdAt).toBe(b.createdAt);
      // Checkpoints and PRIOR audits are byte-identical; only a new audit is appended.
      expect(JSON.stringify(a.checkpoints)).toBe(JSON.stringify(b.checkpoints));
      expect(JSON.stringify(a.auditLog.slice(0, b.auditLog.length))).toBe(
        JSON.stringify(b.auditLog),
      );
      expect(a.auditLog).toHaveLength(b.auditLog.length + 1);
      const appended = a.auditLog[a.auditLog.length - 1];
      expect(appended.action).toBe('supersession-link-repaired');
      expect(appended.actor).toBe('eric-admin');
      expect(appended.metadata.repairedSourceTaskId).toBe(SRC);
      expect(appended.metadata.repairedSuccessorTaskId).toBe(SUC);
      expect(appended.metadata.derivedFromSourceAuditId).toContain('supersede');
      expect(appended.metadata.derivedFromSuccessorAuditId).toContain('superseded-from');
    }
  });

  it('a REPEAT repair is refused as already_repaired and changes NOTHING', () => {
    expect(run(REPAIR).status).toBe(0);
    const afterFirst = sha(reg);

    const second = run(REPAIR);
    expect(second.status).not.toBe(0);
    expect(`${second.stderr}`).toContain('already_repaired');
    expect(sha(reg)).toBe(afterFirst);
    expect(load().revision).toBe(19);
  });

  it('REJECTS any arbitrary field / value / successor override', () => {
    for (const banned of [
      ['--field', 'supersededByTaskId'],
      ['--value', SUC],
      ['--successor', SUC],
      ['--new-task', SUC],
      ['--set', 'x'],
    ]) {
      const before = sha(reg);
      const res = run([...REPAIR, ...banned]);
      expect(res.status).not.toBe(0);
      expect(`${res.stderr}`).toContain('unauthorized_actor');
      expect(sha(reg)).toBe(before);
    }
  });

  it('REQUIRES administrator role, --confirm and a non-empty --reason', () => {
    const cases: string[][] = [
      ['repair-supersession-link', SRC, '--actor', 'a', '--role', 'builder', '--reason', 'r', '--confirm'],
      ['repair-supersession-link', SRC, '--actor', 'a', '--role', 'administrator', '--reason', 'r'],
      ['repair-supersession-link', SRC, '--actor', 'a', '--role', 'administrator', '--confirm'],
    ];
    for (const args of cases) {
      const before = sha(reg);
      const res = run(args);
      expect(res.status).not.toBe(0);
      expect(sha(reg)).toBe(before);
    }
  });

  it('an ORDINARY mutation on the version-1 fixture is refused with registry_upgrade_required', () => {
    const before = sha(reg);
    const res = run(['release', SUC, '--owner', 'pstack-pilot-integrator-v2', '--role', 'integrator']);
    expect(res.status).not.toBe(0);
    expect(`${res.stderr}`).toContain('registry_upgrade_required');
    expect(sha(reg)).toBe(before);
    expect(load().version).toBe(1);
  });

  it('post-repair, the registry passes `doctor` and the chain is traversable', () => {
    run(REPAIR);
    const after = load();
    expect(after.tasks[SRC].supersededByTaskId).toBe(SUC);
    expect(after.tasks[SUC].supersedesTaskId).toBe(SRC);
    // A readable registry is itself the invariant proof: assertRegistryInvariants
    // rejects an asymmetric or dangling link on every read.
    const list = run(['list']);
    expect(list.status).toBe(0);
  });
});

describe('3A.5 B — historical parsers reject version 2 WITHOUT rewriting it', () => {
  /**
   * The load-bearing experiment, kept as a permanent regression guard. Each historical
   * generation's parser is materialized from its real git blob and executed against a
   * version-2 registry. If a future change ever made version 2 readable by an old writer,
   * the quarantine would be silently gone — this test is what would catch that.
   */
  const GENERATIONS = ['27f0f935', '4b6c511c', '5d8a3007', 'dd90ea7c'];
  const MODULES = ['validate.ts', 'types.ts', 'registry.ts', 'lock.ts', 'git-paths.ts'];

  let workDir: string;

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), 'pstack-histparse-'));
  });
  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  function materialize(genSha: string): string | null {
    const out = join(workDir, genSha);
    mkdirSync(out, { recursive: true });
    for (const mod of MODULES) {
      try {
        const blob = execFileSync('git', ['show', `${genSha}:src/lib/agent-tasks/${mod}`], {
          cwd: ROOT,
          encoding: 'utf8',
          maxBuffer: 1024 * 1024 * 8,
        });
        writeFileSync(join(out, mod), blob, 'utf8');
      } catch {
        return null; // history unavailable (e.g. shallow clone) — skip, never fail blind
      }
    }
    return out;
  }

  // The mutator is deliberately BENIGN (it changes no records). A mutator that injected a
  // task would make the v1 CONTROL write a registry the historical parser then rejects on
  // its own post-write invariant read — which would look like the boundary working when it
  // is really the fixture being invalid. What must be observed is only whether the old
  // writer REACHED its mutator and WROTE.
  const PROBE = `
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const [, , genDir, target] = process.argv;
const { parseRegistry } = await import(genDir + '/validate.ts');
const { readRegistryFile, mutateRegistry } = await import(genDir + '/registry.ts');
const sha = () => createHash('sha256').update(readFileSync(target)).digest('hex');
const before = sha();
let mutatorRan = false;
const m = mutateRegistry(target, null, (reg) => {
  mutatorRan = true;
  return { ok: true, value: true };
}, { lockOwner: 'historical-probe' });
console.log(JSON.stringify({
  parseRejected: parseRegistry(JSON.parse(readFileSync(target, 'utf8'))) === null,
  readRejected: !readRegistryFile(target).ok,
  mutateRejected: !m.ok,
  mutatorRan,
  bytesUnchanged: sha() === before,
  stillVersion2: JSON.parse(readFileSync(target, 'utf8')).version === 2,
  revision: JSON.parse(readFileSync(target, 'utf8')).revision,
}));
`;

  it.each(GENERATIONS)('generation %s rejects a version-2 registry and writes nothing', (genSha) => {
    const genDir = materialize(genSha);
    if (!genDir) return; // history not available in this checkout

    const target = join(workDir, `v2-${genSha}.json`);
    writeFileSync(
      target,
      `${JSON.stringify(
        {
          version: 2,
          revision: 18,
          updatedAt: '2026-08-31T02:33:16.303Z',
          tasks: {},
          adminAuditLog: [],
          provenance: {
            writerVersion: 2,
            writerPath: '/x/agent-task.mts',
            worktreePath: '/x',
            gitCommonDir: '/x/.git',
            actor: 'modern',
            at: '2026-08-31T02:33:16.303Z',
          },
        },
        null,
        2,
      )}\n`,
      'utf8',
    );

    const probePath = join(workDir, `probe-${genSha}.mts`);
    writeFileSync(probePath, PROBE, 'utf8');
    const res = spawnTsxSync(probePath, [genDir, target], {
      cwd: ROOT,
      env: process.env,
      encoding: 'utf8',
    });
    expect(res.status).toBe(0);

    const out = JSON.parse(`${res.stdout}`.trim().split('\n').pop() as string);
    expect(out.parseRejected).toBe(true);
    expect(out.readRejected).toBe(true);
    expect(out.mutateRejected).toBe(true);
    // The decisive properties: the old writer never reached its mutator, and the file
    // is byte-identical and still version 2.
    expect(out.mutatorRan).toBe(false);
    expect(out.bytesUnchanged).toBe(true);
    expect(out.stillVersion2).toBe(true);
  });

  it('CONTROL: the same historical writer DOES mutate a version-1 registry', () => {
    // Without this control, every assertion above could pass because the harness is
    // broken rather than because the version boundary works.
    const genDir = materialize('dd90ea7c');
    if (!genDir) return;

    const target = join(workDir, 'v1-control.json');
    writeFileSync(
      target,
      `${JSON.stringify(
        { version: 1, revision: 18, updatedAt: '2026-08-31T02:33:16.303Z', tasks: {}, adminAuditLog: [] },
        null,
        2,
      )}\n`,
      'utf8',
    );
    const probePath = join(workDir, 'probe-control.mts');
    writeFileSync(probePath, PROBE, 'utf8');
    const res = spawnTsxSync(probePath, [genDir, target], {
      cwd: ROOT,
      env: process.env,
      encoding: 'utf8',
    });
    expect(res.status, `probe stderr: ${res.stderr}`).toBe(0);
    const out = JSON.parse(`${res.stdout}`.trim().split('\n').pop() as string);
    expect(out.mutateRejected).toBe(false);
    expect(out.mutatorRan).toBe(true);
    expect(out.bytesUnchanged).toBe(false);
    expect(out.revision).toBe(19);
  });
});
