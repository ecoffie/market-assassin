// Portable, read-only credential loading for the benchmark harnesses. No machine paths, no values in Git.
//
// Resolution order (first that supplies every required key wins):
//   1. variables already exported in the process environment
//   2. the file named by MINDY_BENCH_ENV_FILE
//   3. <evaluation worktree>/.env.local  (the worktree passed as cwd, i.e. the checkout whose src/ is being evaluated)
//
// Fails closed. dotenv-style loaders silently continue with ZERO variables when a file is missing or a symlink loops
// (see CLAUDE.md, "Sharing .env.local into a worktree"); this throws instead. It also refuses a file that Git tracks,
// and it never prints a value, only the source path and which keys were found.
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

export type BenchEnv = Record<string, string>;

function parse(file: string): BenchEnv {
  const out: BenchEnv = {};
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m) continue;
    out[m[1]] = m[2].replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
  }
  return out;
}

function trackedByGit(file: string): boolean {
  try {
    execFileSync('git', ['-C', path.dirname(file), 'ls-files', '--error-unmatch', path.basename(file)], { stdio: 'ignore' });
    return true;
  } catch { return false; }
}

export function loadBenchEnv(required: string[], worktree: string = process.cwd(), optional: string[] = []): BenchEnv {
  const fromProcess = Object.fromEntries([...required, ...optional].filter((k) => process.env[k]).map((k) => [k, process.env[k] as string]));
  if (required.every((k) => fromProcess[k])) {
    console.error(`[bench-env] source: process environment (${Object.keys(fromProcess).join(', ')})`);
    return fromProcess;
  }
  const file = process.env.MINDY_BENCH_ENV_FILE
    ? path.resolve(process.env.MINDY_BENCH_ENV_FILE)
    : path.join(path.resolve(worktree), '.env.local');
  let real: string;
  try { real = fs.realpathSync(file); } catch (e: any) {
    throw new Error(`[bench-env] no readable env file at ${file} (${e.code || e.message}). ` +
      `Export the variables, set MINDY_BENCH_ENV_FILE, or link the worktree with: npm run env:link-worktree -- <worktree>`);
  }
  if (trackedByGit(real)) throw new Error(`[bench-env] refusing ${real}: it is tracked by Git. Credentials must never be committed.`);
  const parsed = parse(real);
  const env: BenchEnv = { ...parsed, ...fromProcess };
  const missing = required.filter((k) => !env[k]);
  if (missing.length) throw new Error(`[bench-env] ${real} is missing required keys: ${missing.join(', ')}`);
  console.error(`[bench-env] source: ${file}${real !== file ? ` -> ${real}` : ''} (keys: ${[...required, ...optional].filter((k) => env[k]).join(', ')})`);
  return env;
}

export function exportToProcess(env: BenchEnv, keys: string[]) {
  for (const k of keys) if (env[k]) process.env[k] = env[k];
}
