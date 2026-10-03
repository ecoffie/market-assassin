import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawn, spawnSync, type SpawnOptions } from 'node:child_process';

/**
 * Resolve the tsx CLI from THIS checkout's own install.
 *
 * There used to be a `../../../node_modules` fallback so a worktree under
 * .claude/worktrees/ could borrow the primary checkout's dependencies. That made
 * tests run the pushed code against another tree's install, and it is why a
 * worktree "worked" until a test asserted a local binary. Every checkout — primary
 * or linked worktree — must have its own `npm ci`; the pre-push gate checks it.
 */
export function resolveTsxCli(root = process.cwd()): string {
  const p = join(root, 'node_modules/tsx/dist/cli.mjs');
  if (existsSync(p)) return p;
  throw new Error(`tsx not found at ${p} — run \`npm ci\` in ${root}`);
}

export function spawnTsxSync(script: string, args: string[], opts?: SpawnOptions) {
  const tsx = resolveTsxCli();
  return spawnSync(process.execPath, [tsx, script, ...args], opts);
}

export function spawnTsxAsync(
  script: string,
  args: string[],
  opts?: SpawnOptions,
): Promise<{ code: number; stdout: string }> {
  const tsx = resolveTsxCli();
  return new Promise((resolve, reject) => {
    let stdout = '';
    const child = spawn(process.execPath, [tsx, script, ...args], {
      ...opts,
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    child.stdout?.on('data', (d: Buffer | string) => {
      stdout += d.toString();
    });
    child.on('error', reject);
    child.on('close', (code: number | null) => resolve({ code: code ?? 1, stdout }));
  });
}

/**
 * Async twin of spawnTsxSync with the SAME result shape ({ status, stdout, stderr }).
 *
 * Why tests must not use spawnTsxSync: a synchronous spawn blocks the Vitest worker's
 * event loop for the child's whole lifetime. The worker then cannot read Vitest's RPC
 * replies, and when a test chains several cold `tsx` launches under load, the worker's
 * 60s RPC timer fires before the reply is processed — `Timeout calling "onTaskUpdate"` —
 * failing the run although every test passed (measured 2026-09-28: 6/6 full runs at
 * >=12 workers). Awaiting the child keeps the event loop free.
 */
export function spawnTsx(
  script: string,
  args: string[],
  opts: SpawnOptions = {},
): Promise<{ status: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string }> {
  const tsx = resolveTsxCli();
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    const child = spawn(process.execPath, [tsx, script, ...args], { ...opts, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout?.on('data', (d: Buffer | string) => { stdout += d.toString(); });
    child.stderr?.on('data', (d: Buffer | string) => { stderr += d.toString(); });
    child.on('error', reject);
    child.on('close', (status, signal) => resolve({ status, signal, stdout, stderr }));
  });
}
