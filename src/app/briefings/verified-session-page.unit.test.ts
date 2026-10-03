/**
 * R1 migration (2026-10-03): the legacy /briefings page must authenticate every briefing/profile
 * call with the signed Mindy session, and must never LOAD a reader from a remembered, typed or
 * ?email= address. (The page is 2,000+ lines of client UI; this pins the contract in its source.)
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const page = readFileSync(join(__dirname, 'page.tsx'), 'utf8');

describe('/briefings page authenticates from the verified session', () => {
  it.each(['/api/briefings/latest', '/api/alerts/preferences', '/api/briefings/verify', '/api/alerts/save-profile'])(
    'every fetch to %s sends the Mindy session headers', (path) => {
      const calls = page.split('fetch(').slice(1).filter((c) => c.slice(0, 200).includes(path));
      expect(calls.length).toBeGreaterThan(0);
      for (const c of calls) expect(c.slice(0, 400)).toMatch(/getMIApiHeaders\(/);
    });

  it('never restores identity from the plaintext cookie', () => {
    expect(page).not.toMatch(/reconcileAccessEmail\(/);
  });

  it('a reader is loaded only from the session entry or the signed-in account', () => {
    const loads = [...page.matchAll(/verifyAndLoadUser\(([^)]*)\)/g)].map((m) => m[1].trim()).filter((a) => a !== 'userEmail: string');
    expect(loads.sort()).toEqual(['entry.email', 'entry.email', 'trimmed'].sort());
    expect(page).toMatch(/if \(trimmed === storedMIEmail\(\)\) \{\s*await verifyAndLoadUser\(trimmed\);/);
  });

  it('the secure link returns the reader to /briefings', () => {
    expect(page).toMatch(/destination: 'briefings', returnTo: '\/briefings'/);
  });
});
