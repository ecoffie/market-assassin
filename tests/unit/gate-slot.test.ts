/**
 * Machine-wide pre-push gate concurrency limit (.githooks/gate-slot.sh, 2026-11-17).
 * Runs the real script with bash in a temp slot dir. Async spawn (never spawnSync: it blocks the
 * vitest worker; see the 2026-10-03 gate-determinism fix).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, readdirSync } from 'node:fs';
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
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('gate-slot: queue, never skip', () => {
  it('a run that cannot get a slot within the timeout is BLOCKED (exit 1), not skipped', async () => {
    const dir = slotDir();
    const env = { MINDY_GATE_SLOT_DIR: dir, MINDY_GATE_SLOTS: '1', MINDY_GATE_SLOT_POLL_S: '0.1' };
    const holder = bash('gate_slot_acquire && sleep 3', env);
    await wait(500);
    const second = await bash('gate_slot_acquire', { ...env, MINDY_GATE_SLOT_TIMEOUT_S: '1' });
    expect(second.code).toBe(1);
    expect(second.out).toMatch(/BLOCKED \(fail closed\)/);
    expect((await holder).code).toBe(0);
  }, 15_000);

  it('two slots admit two concurrent runs; a third waits until one finishes', async () => {
    const dir = slotDir();
    const env = { MINDY_GATE_SLOT_DIR: dir, MINDY_GATE_SLOTS: '2', MINDY_GATE_SLOT_POLL_S: '0.1' };
    const a = bash('gate_slot_acquire && sleep 1.5; gate_slot_release', env);
    const b = bash('gate_slot_acquire && sleep 1.5; gate_slot_release', env);
    await wait(400);
    expect(readdirSync(dir).filter((n) => n.startsWith('slot-'))).toHaveLength(2);
    const t0 = Date.now();
    const c = await bash('gate_slot_acquire && echo GOT', { ...env, MINDY_GATE_SLOT_TIMEOUT_S: '10' });
    expect(c.code).toBe(0);
    expect(c.out).toMatch(/GOT/);
    expect(Date.now() - t0).toBeGreaterThan(500); // it had to wait
    await Promise.all([a, b]);
  }, 20_000);

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
