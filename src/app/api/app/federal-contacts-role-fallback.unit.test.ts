/**
 * App federal-contacts role fallback (FM-07, Eric/QA 2026-07-28). The app route
 * (/api/app/federal-contacts) has its OWN copy of the contact-role logic — a DUPLICATE of the lib
 * (contact-roster.ts) — so the lib-only FM-07 fix did NOT reach the app's contact panels
 * (GovDecisionMakersPanel, MyTargetListPanel). Those panels showed a null role for DoDAAC POCs whose
 * title is just "Primary/Secondary Contact" (classifyRole → null) while the row's DB role_category
 * ('contracting') sat unused. This locks the same fallback into the app route's TWO panel-emitting
 * map sites (office-roster + the main directory map) — same bug class as the buildSearchOr duplicate.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = readFileSync(join(__dirname, 'federal-contacts/route.ts'), 'utf8');

// Mirror the route's roleCategoryLabelFromDb fallback to lock its behavior.
function roleCategoryLabelFromDb(cat: string | null | undefined): string | null {
  const c = (cat || '').toLowerCase().trim();
  if (!c) return null;
  if (c.includes('contract')) return 'Contracting';
  if (c.includes('small business') || c.includes('osbp') || c.includes('sblo')) return 'Small Business';
  if (c.includes('program') || c.includes('technical')) return 'Program / Technical';
  return c[0].toUpperCase() + c.slice(1);
}

describe('roleCategoryLabelFromDb — DB role_category → human label (FM-07, app route)', () => {
  it('"contracting" → "Contracting" (the DoDAAC POC value)', () => {
    expect(roleCategoryLabelFromDb('contracting')).toBe('Contracting');
  });
  it('small-business categories → "Small Business"', () => {
    expect(roleCategoryLabelFromDb('small business')).toBe('Small Business');
    expect(roleCategoryLabelFromDb('osbp')).toBe('Small Business');
  });
  it('null/empty → null (never fabricate a role)', () => {
    expect(roleCategoryLabelFromDb(null)).toBeNull();
    expect(roleCategoryLabelFromDb('')).toBeNull();
    expect(roleCategoryLabelFromDb('   ')).toBeNull();
  });
});

describe('the app route wires the fallback on BOTH panel-emitting map sites (FM-07)', () => {
  it('defines the fallback helper', () => {
    expect(src).toContain('function roleCategoryLabelFromDb(');
  });
  it('BOTH queries that feed the panels select role_category', () => {
    // office-roster select + main directory select must both carry the DB column,
    // else the fallback has nothing to read.
    const selectsWithRoleCat = (src.match(/\.select\(\s*[\s\S]*?role_category[\s\S]*?\)/g) || []).length;
    expect(selectsWithRoleCat).toBeGreaterThanOrEqual(2);
  });
  it('office-roster map: title bucket wins, DB role_category is the fallback', () => {
    expect(src).toContain('const roleCategoryLabel = roleCategory || roleCategoryLabelFromDb(r.role_category)');
    expect(src).toContain('roleCategory: roleCategoryLabel');
  });
  it('main directory map: spread normalizeTitle then override roleCategory with the DB fallback', () => {
    expect(src).toContain('roleCategory: nt.roleCategory || roleCategoryLabelFromDb(');
  });
});
