/**
 * DEFECT-7 — SAM entity lookup reported OUR outage as "this company is not registered".
 *
 * Traced 2026-08-24 from a live research session. Measured, in order:
 *   1. Of the four production keys: SAM_API_KEY = 401 API_KEY_INVALID (dead), _1 and _2 = 429
 *      (quota exhausted), _BACKUP a duplicate. Every usable key was unusable.
 *   2. The fail-over loop broke on `status !== 429`, so landing on the DEAD key looked like a
 *      real answer and it stopped trying.
 *   3. That non-429 error returned `{ entities: [] }` — indistinguishable from a genuine
 *      no-match, with `degraded:false`.
 *   4. The tool caught its own failure and RESOLVED, so the billing seam charged 5 credits
 *      for a result containing nothing.
 *
 * Same class as `count ?? 0`: an EVIDENCE failure rendered as a WORLD fact.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const code = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
   .replace(/^([^\n]*?)\/\/.*$/gm, '$1');

describe('key fail-over treats a REJECTED key as unusable, not as an answer', () => {
  const api = () => code(read('src/lib/sam/entity-api.ts'));

  it('401/403 are unusable alongside 429', () => {
    const c = api();
    expect(c).toContain('keyUnusable');
    expect(c).toMatch(/st === 429 \|\| st === 401 \|\| st === 403/);
  });

  it('the loop no longer breaks on a non-429 error', () => {
    // The exact bug: `if (result.error?.status !== 429) break;` stopped fail-over on the dead key.
    expect(api()).not.toMatch(/if \(result\.error\?\.status !== 429\) break;/);
    expect(api()).toMatch(/if \(!keyUnusable\(result\.error\?\.status\)\) break;/);
  });
});

describe('an upstream failure NEVER renders as an empty result', () => {
  it('searchEntities throws instead of returning entities: []', () => {
    const c = code(read('src/lib/sam/entity-api.ts'));
    // The silent-empty return is what let an outage read as "not registered in SAM".
    expect(c).not.toMatch(/console\.error\('\[Entity Search Error\]'[\s\S]{0,120}return \{\s*entities: \[\]/);
    expect(c).toContain('throw new Error(`SAM entity lookup failed (');
  });

  it('an invalid key produces a message naming the real cause, not a fake quota story', () => {
    const c = code(read('src/lib/sam/entity-api.ts'));
    expect(c).toContain('check SAM_API_KEY* validity');
  });
});

describe('local registry fallback keeps identity available during a SAM outage', () => {
  const fb = () => code(read('src/lib/sam/entity-local-fallback.ts'));
  const tool = () => code(read('src/mcp/tools/sam-entity.ts'));

  it('the tool falls back to the local mirror on a live failure', () => {
    const c = tool();
    expect(c).toContain('localEntityByUEI');
    expect(c).toContain('localEntitiesByName');
  });

  it('a local hit is reported HONESTLY — degraded stays true, source is local', () => {
    const c = tool();
    expect(c).toContain("source: usedLocal ? 'local_registry' : 'sam_live'");
    // `degraded` must NOT be reset to false just because the fallback succeeded: the data is
    // cached, and the caller has to be able to say "as of <date>".
    expect(c).not.toMatch(/usedLocal\s*=\s*true;[\s\S]{0,80}degraded\s*=\s*false/);
  });

  it('uses the REAL freshness column (synced_at, not updated_at)', () => {
    // PostgREST fails the WHOLE query on one unknown column, so `updated_at` made the fallback
    // silently return nothing while 8 matching rows sat in the table.
    const c = fb();
    expect(c).toContain('synced_at');
    expect(c).not.toContain('updated_at');
  });

  it('query errors are LOGGED, not swallowed', () => {
    // A silent `return []` is what hid the bad column name.
    expect(fb()).toContain('[sam-local-fallback]');
  });

  it('a cached row is never presented as a confirmed active registration', () => {
    expect(fb()).toContain("registrationStatus: 'Unknown'");
  });
});

describe('billing — a degraded, empty paid call is not charged', () => {
  it('metered.ts skips the debit when degraded && !grounded', () => {
    const c = code(read('src/lib/mcp/metered.ts'));
    expect(c).toMatch(/meta\?\.degraded === true && meta\?\.grounded !== true/);
    expect(c).toContain("status: 'uncharged'");
  });

  it('a GENUINE no-match still bills (that is a real answer)', () => {
    // The guard is deliberately narrow: degraded=false + grounded=false must fall through to
    // the normal debit, because "this company is not registered" is useful and cost a live call.
    const c = code(read('src/lib/mcp/metered.ts'));
    expect(c).toMatch(/degraded === true && meta\?\.grounded !== true/);
    expect(c).not.toMatch(/meta\?\.grounded !== true\)\s*\{[\s\S]{0,40}debitCredits/);
  });
});
