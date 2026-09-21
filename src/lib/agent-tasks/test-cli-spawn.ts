import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawn, spawnSync, type SpawnOptions } from 'node:child_process';

/** Resolve tsx CLI for worktrees that share the parent checkout's node_modules. */
export function resolveTsxCli(root = process.cwd()): string {
  const candidates = [
    join(root, 'node_modules/tsx/dist/cli.mjs'),
    join(root, '../../../node_modules/tsx/dist/cli.mjs'),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  throw new Error('tsx not found — install dependencies in the repo root');
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
