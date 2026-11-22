/**
 * Machine-wide pre-push gate concurrency limit (.githooks/gate-slot.sh, 2026-11-17).
 * Runs the real script with bash in a temp slot dir. Async spawn (never spawnSync: it blocks the
 * vitest worker; see the 2026-10-03 gate-determinism fix).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const SCRIPT = path.resolve(__dirname, '../../.githooks/gate-slot.sh');
const dirs: string[] = [];
function slotDir() { const d = mkdtempSync(path.join(tmpdir(), 'gate-slot-test-')); dirs.push(d); return d; }
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

function bash(script: string, env: Record<string, string>): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    const p = spawn('bash', ['-c', `. "${SCRIPT}"; ${script}`], { env: { ...process.env, ...env } });
    let out = '';
    p.stdout.on('data', (b) => { out += b; });
    p.stderr.on('data', (b) => { out += b; });
    p.on('close', (code) => resolve({ code: code ?? -1, out }));
  });
}
/** Like bash(), but its output can be read while it is still running. */
function bashLive(script: string, env: Record<string, string>): { out: () => string; done: Promise<{ code: number; out: string }> } {
  let out = '';
  const done = new Promise<{ code: number; out: string }>((resolve) => {
    const p = spawn('bash', ['-c', `. "${SCRIPT}"; ${script}`], { env: { ...process.env, ...env } });
    p.stdout.on('data', (b) => { out += b; });
    p.stderr.on('data', (b) => { out += b; });
    p.on('close', (code) => resolve({ code: code ?? -1, out }));
  });
  return { out: () => out, done };
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Poll (bounded) until a running process has printed `re`. */
async function waitForOutput(read: () => string, re: RegExp, timeoutMs = 10_000): Promise<void> {
  const t0 = Date.now();
  while (!re.test(read())) {
    if (Date.now() - t0 > timeoutMs) throw new Error(`timed out waiting for output ${re}; have: ${read().slice(-200)}`);
    await wait(50);
  }
}
/**
 * A holder: acquires a slot, prints HELD, keeps it until the test creates `go`, then releases.
 * `held` resolves on the HELD event (not a wall-clock poll). If the process exits first, it REJECTS with the
 * holder's own output, so a holder that failed (a fork error under load, a script error) is reported at
 * once instead of surfacing as "timed out waiting for 2 held slot(s); have 1" (#2260, #2320, #2348).
 */
function holder(env: Record<string, string>, go: string): { held: Promise<void>; done: Promise<{ code: number; out: string }> } {
  let out = '';
  let onHeld!: () => void;
  let onFail!: (e: Error) => void;
  let isHeld = false;
  const held = new Promise<void>((res, rej) => { onHeld = res; onFail = rej; });
  const done = new Promise<{ code: number; out: string }>((resolve) => {
    const p = spawn('bash', ['-c', `. "${SCRIPT}"; gate_slot_acquire || exit 1; echo HELD; while [ ! -f "${go}" ]; do sleep 0.1; done; gate_slot_release`], { env: { ...process.env, ...env } });
    const read = (b: Buffer) => { out += b; if (!isHeld && /^HELD$/m.test(out)) { isHeld = true; onHeld(); } };
    p.stdout.on('data', read);
    p.stderr.on('data', read);
    p.on('close', (code) => {
      if (!isHeld) onFail(new Error(`holder exited (code ${code}) before acquiring a slot; output: ${out.slice(-300) || '(none)'}`));
      resolve({ code: code ?? -1, out });
    });
  });
  return { held, done };
}

/** Slots currently held: a slot dir whose pid file has been written (acquire is complete). */
function heldSlots(dir: string): string[] {
  return readdirSync(dir).filter((n) => n.startsWith('slot-') && existsSync(path.join(dir, n, 'pid')));
}
describe('gate-slot: queue, never skip', () => {
  it('a run that cannot get a slot within the timeout is BLOCKED (exit 1), not skipped', async () => {
    const dir = slotDir();
    const env = { MINDY_GATE_SLOT_DIR: dir, MINDY_GATE_SLOTS: '1', MINDY_GATE_SLOT_POLL_S: '0.1' };
    // The holder keeps its slot until the test releases it (same reason as below: no fixed-sleep window to miss).
    const go = path.join(dir, 'go');
    const h = holder(env, go);
    await h.held;
    const second = await bash('gate_slot_acquire', { ...env, MINDY_GATE_SLOT_TIMEOUT_S: '1' });
    expect(second.code).toBe(1);
    expect(second.out).toMatch(/BLOCKED \(fail closed\)/);
    writeFileSync(go, '');
    expect((await h.done).code).toBe(0);
  }, 15_000);

  it('two slots admit two concurrent runs; a third waits until one finishes', async () => {
    const dir = slotDir();
    const env = { MINDY_GATE_SLOT_DIR: dir, MINDY_GATE_SLOTS: '2', MINDY_GATE_SLOT_POLL_S: '0.1' };
    // Holders keep their slot until the test says so (a "go" file), not for a fixed `sleep 4`: on a loaded CI
    // runner the test could miss a 4 s window entirely ("timed out waiting for 2 held slot(s); have 0").
    const go = path.join(dir, 'go');
    const a = holder(env, go);
    const b = holder(env, go);
    // Event-driven: both holders announce HELD; a holder that dies first fails the test with its output.
    await Promise.all([a.held, b.held]);
    expect(heldSlots(dir)).toHaveLength(2);
    const cRun = bashLive('gate_slot_acquire && echo GOT', { ...env, MINDY_GATE_SLOT_TIMEOUT_S: '15' });
    // c must be queued behind the two holders before any slot frees up.
    await waitForOutput(cRun.out, /waiting for a gate slot \(2 in use/);
    writeFileSync(go, '');
    const c = await cRun.done;
    expect(c.code).toBe(0);
    expect(c.out).toMatch(/GOT/);
    // It had to wait: the script prints this only when every slot was taken on its first try.
    expect(c.out).toMatch(/waiting for a gate slot \(2 in use/);
    const [ra, rb] = await Promise.all([a.done, b.done]);
    expect(ra.code).toBe(0);
    expect(rb.code).toBe(0);
  }, 30_000);

  it('a holder that dies before acquiring fails the wait AT ONCE with its own output (no blind timeout)', async () => {
    const dir = slotDir();
    const blocker = path.join(dir, 'not-a-dir');
    writeFileSync(blocker, ''); // a FILE where the slot dir should be → mkdir -p fails → acquire returns 1
    const t0 = Date.now();
    const h = holder({ MINDY_GATE_SLOT_DIR: path.join(blocker, 'slots'), MINDY_GATE_SLOTS: '1' }, path.join(dir, 'go'));
    await expect(h.held).rejects.toThrow(/holder exited \(code 1\) before acquiring a slot; output: .*cannot create/s);
    expect(Date.now() - t0).toBeLessThan(5_000);
    expect((await h.done).code).toBe(1);
  }, 15_000);

  it('a slot whose owner died is reclaimed', async () => {
    const dir = slotDir();
    const env = { MINDY_GATE_SLOT_DIR: dir, MINDY_GATE_SLOTS: '1', MINDY_GATE_SLOT_POLL_S: '0.1', MINDY_GATE_SLOT_TIMEOUT_S: '5' };
    // Owner pid 999999 does not exist → stale.
    const seeded = await bash('mkdir -p "$MINDY_GATE_SLOT_DIR/slot-1" && echo 999999 > "$MINDY_GATE_SLOT_DIR/slot-1/pid"', env);
    expect(seeded.code).toBe(0);
    const r = await bash('gate_slot_acquire && cat "$GATE_SLOT_HELD/pid"', env);
    expect(r.code).toBe(0);
    expect(r.out).not.toMatch(/999999/);
  }, 15_000);

  it('release frees only a slot the caller owns', async () => {
    const dir = slotDir();
    const env = { MINDY_GATE_SLOT_DIR: dir, MINDY_GATE_SLOTS: '1' };
    const r = await bash('gate_slot_acquire; s="$GATE_SLOT_HELD"; echo 123 > "$s/pid"; gate_slot_release; [ -d "$s" ] && echo KEPT', env);
    expect(r.out).toMatch(/KEPT/);
    const own = await bash('gate_slot_acquire >/dev/null 2>&1; gate_slot_release; ls "$MINDY_GATE_SLOT_DIR"', { ...env, MINDY_GATE_SLOT_DIR: slotDir() });
    expect(own.out.trim()).toBe('');
  }, 15_000);
});

describe('pre-push wires the limit before the heavy steps', () => {
  it('sources gate-slot.sh, acquires before typecheck, releases on EXIT, and fails closed', async () => {
    const { readFileSync } = await import('node:fs');
    const hook = readFileSync(path.resolve(__dirname, '../../.githooks/pre-push'), 'utf8');
    const acquire = hook.indexOf('gate_slot_acquire');
    expect(acquire).toBeGreaterThan(0);
    expect(acquire).toBeLessThan(hook.indexOf('1/13${NC} typecheck'));
    expect(hook).toMatch(/trap gate_slot_release EXIT/);
    expect(hook).toMatch(/if ! gate_slot_acquire; then[\s\S]{0,200}exit 1/);
    expect(existsSync(SCRIPT)).toBe(true);
  });
});
