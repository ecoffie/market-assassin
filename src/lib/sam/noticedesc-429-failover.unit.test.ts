import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Issue-log #12: get_solicitation_documents used getRotatedSAMKey() alone for
 * noticedesc. On a day that key is 429-exhausted, sol# and UUID both resolve
 * identity but return empty body — even when another key still has quota.
 * Same class as entity-429-failover (DEFECT-7).
 *
 * Measured 2026-09-20 against N00024-26-R-4160 / 85a62e9a…: both distinct
 * production keys returned noticedesc 429; DB description empty; no
 * pursuit_documents / mcp_external_cache hit. Failover cannot invent content
 * when every key is unusable — but it must try each key once and disclose.
 */
const DESC = readFileSync(join(process.cwd(), 'src/lib/sam/notice-description.ts'), 'utf8');
const DOCS = readFileSync(join(process.cwd(), 'src/lib/sam/solicitation-documents.ts'), 'utf8');

const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const descCode = strip(DESC);
const docsCode = strip(DOCS);

describe('noticedesc: 429 multi-key failover', () => {
  it('walks getAllDistinctSAMKeys after the rotated key is unusable', () => {
    expect(descCode).toContain('getAllDistinctSAMKeys');
    expect(descCode).toContain('getRotatedSAMKey');
    expect(descCode).toContain('fetchNoticeDescriptionWithFailover');
    expect(descCode).toMatch(/isNoticedescKeyUnusable/);
  });

  it('fails over only on 429/401/403 — stops on ordinary errors', () => {
    expect(descCode).toMatch(/status === 429 \|\| status === 401 \|\| status === 403/);
    expect(descCode).toMatch(/non-throttle failure; stopping failover/);
  });

  it('does not invent body text when every key is unusable', () => {
    expect(descCode).toMatch(/allKeysUnusable:\s*sawUnusable/);
    expect(descCode).toContain('noticedescRetrievalLimitation');
    expect(descCode).toMatch(/Absence of description text does not mean the notice has no scope/);
  });

  it('solicitation-documents uses failover + discloses + persists on success', () => {
    expect(docsCode).toContain('fetchNoticeDescriptionWithFailover');
    expect(docsCode).toContain('noticedescRetrievalLimitation');
    expect(docsCode).not.toMatch(/getRotatedSAMKey\(\)/);
    expect(docsCode).toMatch(/description:\s*fetched\.text/);
    expect(docsCode).toMatch(/description_checked_at/);
  });
});
