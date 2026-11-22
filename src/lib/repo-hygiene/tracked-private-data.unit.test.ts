import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  realLookingEmails,
  pathViolation,
  contentViolation,
  MAX_REAL_EMAILS,
  KNOWN_EXCEPTIONS,
  type Violation,
} from './tracked-private-data';

/**
 * Blocking repository-hygiene check (runs in the pre-push gate and CI verify): no tracked file may
 * carry private operational data. Violations are reported by PATH and RULE only — never content.
 * Private inputs belong in $MINDY_PRIVATE_DIR (scripts/lib/private-path.js), never the tree.
 */

const ROOT = join(__dirname, '..', '..', '..');
const BINARY_EXT = /\.(png|jpe?g|gif|webp|ico|svg|woff2?|ttf|otf|eot|pdf|zip|gz|mp4|mov|mp3|wav|lock|pptx|docx|xlsx)$/i;
const MAX_BYTES = 25 * 1024 * 1024;

function trackedFiles(): string[] {
  return execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    .split('\0')
    .filter(Boolean);
}

/** Fixture addresses are assembled at run time so this file itself contains none. */
function plantedAddresses(n: number): string {
  return Array.from({ length: n }, (_, i) => ['person', String(i), '@', 'realco', String(i), '.', 'com'].join('')).join('\n');
}

describe('tracked files carry no private operational data', () => {
  it('every tracked file passes the path and email-density rules', () => {
    const violations: Violation[] = [];
    for (const p of trackedFiles()) {
      const pv = pathViolation(p);
      if (pv) { violations.push(pv); continue; }
      if (BINARY_EXT.test(p)) continue;
      let text: string;
      try {
        const abs = join(ROOT, p);
        if (statSync(abs).size > MAX_BYTES) continue;
        text = readFileSync(abs, 'utf8');
      } catch {
        continue; // deleted in the working tree / unreadable
      }
      if (text.includes('\u0000')) continue;
      const cv = contentViolation(p, text);
      if (cv) violations.push(cv);
    }
    // Path + rule only, never content. Fix: move the data to $MINDY_PRIVATE_DIR, or (for a genuinely
    // public resource) add the path to EMAIL_DENSITY_ALLOWLIST with a reason.
    expect(violations.map((v) => `${v.rule}: ${v.path} (${v.detail})`)).toEqual([]);
  });

  it('every known exception still exists (remove entries once the data has moved)', () => {
    const files = new Set(trackedFiles());
    for (const k of KNOWN_EXCEPTIONS) expect(files.has(k.path), k.path).toBe(true);
  });
});

describe('the check itself (planted fixtures)', () => {
  it(`fails a planted file with ${MAX_REAL_EMAILS + 1} real-looking addresses`, () => {
    const v = contentViolation('docs/planted-fixture.md', plantedAddresses(MAX_REAL_EMAILS + 1));
    expect(v?.rule).toBe('email_density');
  });

  it(`allows up to ${MAX_REAL_EMAILS}`, () => {
    expect(contentViolation('docs/planted-fixture.md', plantedAddresses(MAX_REAL_EMAILS))).toBeNull();
  });

  it('does not count synthetic, own-domain or public-official addresses', () => {
    const at = '@';
    const text = [
      `a${at}example.com`, `b${at}x.com`, `c${at}example.test`, `d${at}govcongiants.com`, `e${at}getmindy.ai`,
      `f${at}army.mil`, `g${at}sba.gov`, `h${at}co.com`, `i${at}test.govcongiants.org`, `j${at}corp.com`,
    ].join(' ');
    expect(realLookingEmails(text)).toEqual([]);
  });

  it('allowlisted public resources are not counted', () => {
    expect(contentViolation('public/resources/planted.html', plantedAddresses(50))).toBeNull();
  });

  it('a known exception may not grow past its cap', () => {
    const k = KNOWN_EXCEPTIONS[0];
    expect(contentViolation(k.path, plantedAddresses(k.maxEmails + 1))?.rule).toBe('known_exception_grew');
    expect(contentViolation(k.path, plantedAddresses(k.maxEmails))).toBeNull();
  });

  it('refuses export-style paths and stray root files', () => {
    expect(pathViolation('tasks/cache/calls/abc.txt')?.rule).toBe('export_path');
    expect(pathViolation('scripts/paid_customers_unified.csv')?.rule).toBe('export_path');
    expect(pathViolation('data/bootcamp-attendees.txt')?.rule).toBe('export_path');
    expect(pathViolation('docs/subscriber-export.json')?.rule).toBe('export_path');
    expect(pathViolation('"email"')?.rule).toBe('stray_root_file');
    expect(pathViolation('f')?.rule).toBe('stray_root_file');
  });

  it('leaves ordinary code, docs and migrations alone', () => {
    for (const p of ['src/lib/mindy/campaign-exclusions.ts', 'docs/agents/platform.md', 'package.json', 'README.md',
      'supabase/migrations/20260101_rollback_safe.sql', 'src/data/contractors.json']) {
      expect(pathViolation(p), p).toBeNull();
    }
  });
});
