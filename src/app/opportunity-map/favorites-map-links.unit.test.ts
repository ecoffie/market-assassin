/**
 * Saved-page record links, one per KIND.
 *
 * The Saved page (/opportunity-map/favorites) linked EVERY card as ?opp=<id> — including the
 * company (UEI), buyer (federal_contacts id) and recompete (contract_id) favorites, which the
 * map's opportunity-detail endpoint cannot resolve. The page's link builder is emitted client JS,
 * so it MIRRORS src/lib/maps/map-links.ts; this test executes the emitted function and pins it to
 * the shared helpers' output for every kind.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  mapLinkForBuyer, mapLinkForCompany, mapLinkForOpportunity, mapLinkForRecompete,
} from '@/lib/maps/map-links';

const SRC = readFileSync(join(__dirname, 'favorites', 'route.ts'), 'utf8');

function emitted(): (r: unknown) => string | null {
  const a = SRC.indexOf('  function recordKind(r){');
  const b = SRC.indexOf('  // end record link', a);
  if (a < 0 || b < 0) throw new Error('record-link block not found in favorites/route.ts');
  // Backslashes are doubled inside the TS template literal; undo that.
  const code = SRC.slice(a, b).replace(/\\\\/g, '\\');
  return new Function(`${code}\nreturn mapLinkFor;`)() as (r: unknown) => string | null;
}

const link = emitted();
const SAM = '006d77f604a74dd0a16c99d041e6c032';

describe('Saved page record links match the shared helpers, per kind', () => {
  const cases: [string, Record<string, unknown>, string | null][] = [
    ['SAM notice (heart save, no entityType)', { notice_id: SAM, source: 'manual' }, mapLinkForOpportunity(SAM)],
    ['SAM notice (opportunity_map)', { notice_id: SAM, source: 'opportunity_map', opportunity_data: { noticeId: SAM } }, mapLinkForOpportunity(SAM)],
    ['forecast id', { notice_id: 'fc-123', source: 'opportunity_map' }, mapLinkForOpportunity('fc-123')],
    ['company via entityType', { notice_id: 'abc123def456', source: 'company_map', opportunity_data: { entityType: 'company' } }, mapLinkForCompany('abc123def456')],
    ['company via source only', { notice_id: 'ABC123DEF456', source: 'company_map' }, mapLinkForCompany('ABC123DEF456')],
    ['buyer via entityType', { notice_id: '42', source: 'buyer_map', opportunity_data: { entityType: 'buyer' } }, mapLinkForBuyer('42')],
    ['buyer via source only', { notice_id: '42', source: 'buyer_map' }, mapLinkForBuyer('42')],
    ['recompete via entityType', { notice_id: 'CONT_AWD_W912_9700', source: 'recompete_map', opportunity_data: { entityType: 'recompete' } }, mapLinkForRecompete('CONT_AWD_W912_9700')],
    ['recompete via source only', { notice_id: 'A&B', source: 'recompete_map' }, mapLinkForRecompete('A&B')],
  ];
  for (const [name, row, want] of cases) {
    it(name, () => {
      expect(want).not.toBeNull();
      expect(link(row)).toBe(want);
    });
  }

  it('no record id → no record link (same as the helpers)', () => {
    expect(link({ notice_id: '' })).toBeNull();
    expect(mapLinkForOpportunity('')).toBeNull();
  });

  it('a company / buyer / recompete favorite never links ?opp=', () => {
    for (const source of ['company_map', 'buyer_map', 'recompete_map']) {
      expect(link({ notice_id: 'X1', source })).not.toContain('?opp=');
    }
  });

  it('the card uses the per-kind builder, not a hardcoded ?opp=', () => {
    expect(SRC).toContain(`href="'+h(mapLinkFor(r)||'/opportunity-map')+'"`);
    expect(SRC).not.toContain(`href="/opportunity-map?opp='+encodeURIComponent(o.nid)`);
  });
});
