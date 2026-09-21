import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import type { RegistryResult } from './types';

/** Git honors GIT_* in the environment over `cwd`; strip them so `cwd` wins (e.g. push hooks). */
function gitSubprocessEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith('GIT_')) delete env[key];
  }
  return env;
}

function normalizeAbsolutePath(cwd: string, raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error('git path empty');
  }
  const abs = isAbsolute(trimmed) ? trimmed : resolve(cwd, trimmed);
  return realpathSync.native ? realpathSync.native(abs) : realpathSync(abs);
}

export function resolveGitCommonDir(cwd: string): RegistryResult<string> {
  try {
    const raw = execFileSync('git', ['rev-parse', '--git-common-dir'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: gitSubprocessEnv(),
    });
    return { ok: true, value: normalizeAbsolutePath(cwd, raw) };
  } catch {
    return {
      ok: false,
      code: 'not_git_repository',
      message: 'cwd is not inside a git repository',
    };
  }
}

export function resolveGitRoot(cwd: string): RegistryResult<string> {
  try {
    const raw = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: gitSubprocessEnv(),
    });
    return { ok: true, value: normalizeAbsolutePath(cwd, raw) };
  } catch {
    return {
      ok: false,
      code: 'not_git_repository',
      message: 'cwd is not inside a git repository',
    };
  }
}
