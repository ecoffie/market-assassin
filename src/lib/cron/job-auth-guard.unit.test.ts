/**
 * Static guard: caller-set headers (`x-cron-dispatch`, `x-vercel-cron`) must never grant access, and
 * every scheduled job route must carry a server-side authorization check.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import { NextRequest } from 'next/server';
import { isAuthorizedJobRequest, requireJobAuth } from './cron-request-auth';

const ROOT = process.cwd();

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/** Files allowed to READ the dispatch header, as a hint only, after authorization has passed. */
const HINT_ONLY = new Set(['src/app/api/cron/saved-search-alerts/route.ts']);

describe('caller-set headers never authorize', () => {
  const files = [...walk(join(ROOT, 'src/app/api')), ...walk(join(ROOT, 'src/lib'))];

  it('no source reads x-cron-dispatch / x-vercel-cron except as a post-auth hint', () => {
    const offenders = files
      .map((f) => relative(ROOT, f))
      .filter((rel) => !HINT_ONLY.has(rel))
      .filter((rel) => /headers\.get\(\s*['"]x-(cron-dispatch|vercel-cron)['"]\s*\)/.test(stripComments(readFileSync(join(ROOT, rel), 'utf8'))));
    expect(offenders).toEqual([]);
  });

  it('the hint-only file checks authorization before reading the header', () => {
    for (const rel of HINT_ONLY) {
      const src = stripComments(readFileSync(join(ROOT, rel), 'utf8'));
      const gate = src.indexOf('requireJobAuth(request)');
      const hint = src.search(/headers\.get\(\s*['"]x-cron-dispatch['"]\s*\)/);
      expect(gate).toBeGreaterThan(-1);
      expect(gate).toBeLessThan(hint);
    }
  });

  it('every cron route carries a server-side authorization check', () => {
    const marker = /requireJobAuth|isAuthorizedJobRequest|hasValidCronSecret|authorizeCronRequest|cronBearerAuthorized|retiredAlertRoute|CRON_SECRET/;
    const missing = walk(join(ROOT, 'src/app/api/cron'))
      .filter((f) => f.endsWith('/route.ts'))
      .filter((f) => !marker.test(stripComments(readFileSync(f, 'utf8'))))
      .map((f) => relative(ROOT, f));
    expect(missing).toEqual([]);
  });
});

describe('isAuthorizedJobRequest', () => {
  const req = (headers: Record<string, string> = {}, qs = '') => new NextRequest(`https://getmindy.ai/api/cron/x${qs}`, { headers });
  const withEnv = (env: Record<string, string | undefined>, fn: () => void) => {
    const saved = { CRON_SECRET: process.env.CRON_SECRET, ADMIN_PASSWORD: process.env.ADMIN_PASSWORD };
    Object.assign(process.env, env);
    for (const [k, v] of Object.entries(env)) if (v === undefined) delete process.env[k];
    try { fn(); } finally {
      for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    }
  };

  it('accepts only the exact CRON_SECRET bearer', () => withEnv({ CRON_SECRET: 's3cret', ADMIN_PASSWORD: 'pw' }, () => {
    expect(isAuthorizedJobRequest(req({ authorization: 'Bearer s3cret' }))).toBe(true);
    expect(isAuthorizedJobRequest(req({ authorization: 'Bearer s3cre' }))).toBe(false);
    expect(isAuthorizedJobRequest(req({ authorization: 's3cret' }))).toBe(false);
  }));

  it('caller-set headers alone are rejected', () => withEnv({ CRON_SECRET: 's3cret', ADMIN_PASSWORD: 'pw' }, () => {
    expect(isAuthorizedJobRequest(req({ 'x-cron-dispatch': '1' }))).toBe(false);
    expect(isAuthorizedJobRequest(req({ 'x-vercel-cron': '1' }))).toBe(false);
    expect(requireJobAuth(req({ 'x-cron-dispatch': '1', 'x-vercel-cron': '1' }))?.status).toBe(401);
  }));

  it('fails closed when the secrets are unset or empty', () => withEnv({ CRON_SECRET: undefined, ADMIN_PASSWORD: undefined }, () => {
    expect(isAuthorizedJobRequest(req({ authorization: 'Bearer ' }))).toBe(false);
    expect(isAuthorizedJobRequest(req({ authorization: 'Bearer undefined' }))).toBe(false);
    expect(isAuthorizedJobRequest(req({}, '?password='))).toBe(false);
  }));

  it('admin password works only where allowed', () => withEnv({ CRON_SECRET: 's3cret', ADMIN_PASSWORD: 'pw' }, () => {
    expect(isAuthorizedJobRequest(req({}, '?password=pw'))).toBe(true);
    expect(isAuthorizedJobRequest(req({}, '?password=pw'), { allowAdminPassword: false })).toBe(false);
    expect(isAuthorizedJobRequest(req({}, '?password=nope'))).toBe(false);
  }));
});
