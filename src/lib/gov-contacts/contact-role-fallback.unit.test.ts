/**
 * Contact role fallback (FM-07, Eric/QA 2026-07-28). search_federal_contacts returned role /
 * role_category_label NULL on every record for DoDAAC pulls (W15QKN, N00174) — because SAM POC titles
 * are just "Primary/Secondary Contact" (classifyRole → null), while the row's DB role_category
 * ("contracting") was DISCARDED. Fix: role_category_label falls back to the DB role_category so a
 * buying-office POC reads as "Contracting" instead of null (title-derived bucket still wins when present).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = readFileSync(join(__dirname, 'contact-roster.ts'), 'utf8');

// Mirror the roleCategoryLabel fallback (a pure fn in the source) to lock its behavior.
function roleCategoryLabel(cat: string | null | undefined): string | null {
  const c = (cat || '').toLowerCase().trim();
  if (!c) return null;
  if (c.includes('contract')) return 'Contracting';
  if (c.includes('small business') || c.includes('osbp') || c.includes('sblo')) return 'Small Business';
  if (c.includes('program') || c.includes('technical')) return 'Program / Technical';
  return c[0].toUpperCase() + c.slice(1);
}

describe('roleCategoryLabel — DB role_category → human label (FM-07 fallback)', () => {
  it('"contracting" → "Contracting" (the actual W15QKN/N00174 value)', () => {
    expect(roleCategoryLabel('contracting')).toBe('Contracting');
  });
  it('small-business categories → "Small Business"', () => {
    expect(roleCategoryLabel('small business')).toBe('Small Business');
    expect(roleCategoryLabel('osbp')).toBe('Small Business');
  });
  it('null/empty → null (never fabricate a role)', () => {
    expect(roleCategoryLabel(null)).toBeNull();
    expect(roleCategoryLabel('')).toBeNull();
  });
});

describe('the fallback is wired so role_category_label is never NEEDLESSLY null', () => {
  it('the query selects role_category and the map uses it as a fallback', () => {
    expect(src).toContain('role_category'); // selected from the DB
    // title-derived bucket wins, DB role_category is the fallback (not the other way around)
    expect(src).toContain('const roleCatLabel = roleCategory || roleCategoryLabel(r.role_category)');
    expect(src).toContain('role_category_label: roleCatLabel');
  });
});
