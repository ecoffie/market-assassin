import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The link-control migration must not invalidate any existing link (Eric, 2026-11-22). It adds two
 * NULLABLE columns, with no backfill, no default and no rewrite, and is idempotent. Applying it on its own
 * changes no behaviour. It ships as a file only and is applied with --only after RED approval.
 */
const sql = readFileSync(join(process.cwd(), 'supabase/migrations/20261122_market_reports_share_controls.sql'), 'utf8');
const code = sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n').toLowerCase();

describe('20261122_market_reports_share_controls.sql', () => {
  it('adds nullable expires_at and revoked_at idempotently', () => {
    expect(code).toContain('alter table market_reports add column if not exists expires_at timestamptz;');
    expect(code).toContain('alter table market_reports add column if not exists revoked_at timestamptz;');
    expect(code).not.toMatch(/not null|default/);
  });

  it('writes no data: no update, insert, delete, backfill or drop', () => {
    expect(code).not.toMatch(/\b(update|insert|delete|drop|truncate)\b/);
  });

  it('every statement is idempotent', () => {
    const stmts = code.split(';').map((s) => s.trim()).filter(Boolean);
    expect(stmts.length).toBe(3);
    for (const s of stmts) expect(s).toMatch(/if not exists/);
  });

  it('says it is not applied and names the --only command', () => {
    expect(sql).toContain('NOT APPLIED');
    expect(sql).toContain('npm run migrate -- --go --only 20261122_market_reports_share_controls.sql');
  });
});
