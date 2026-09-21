/**
 * Unit test for the Gov Buyer drawer's "Similar buyers" peer-card filter (gap 7).
 *
 * `buyerSimilarPeers(b, limit)` (in route.ts's injected drawer JS) is the pure filter behind the
 * clickable peer flywheel that REPLACED the old "Find similar buyers" CTA link. Peers come from
 * b.roster (same-agency contacts already loaded on the buyer detail). It must:
 *   - only include roster contacts with a real federal_contacts id (needed to open their drawer)
 *   - EXCLUDE self (by id)
 *   - dedupe by id and cap at `limit`
 *   - skip nameless rows
 *
 * Extracted straight from route.ts and eval'd so the test tracks the SHIPPED source.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const routeSrc = readFileSync(join(__dirname, 'route.ts'), 'utf8');

function extractFn(name: string): string {
  const start = routeSrc.indexOf(`function ${name}(`);
  expect(start, `function ${name} must exist in route.ts`).toBeGreaterThan(-1);
  const open = routeSrc.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < routeSrc.length; i++) {
    const c = routeSrc[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return routeSrc.slice(start, i + 1); }
  }
  throw new Error(`unbalanced braces extracting ${name}`);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const buyerSimilarPeers: (b: any, limit?: number) => any[] =
  new Function(`${extractFn('buyerSimilarPeers')}; return buyerSimilarPeers;`)();

const C = (over: Record<string, unknown>) => ({ name: 'Contact', ...over });

describe('buyerSimilarPeers — similar-buyers filter (gap 7)', () => {
  const b = {
    id: '100',
    agency: 'Department of the Army',
    roster: [
      C({ id: '100', name: 'Self (should be excluded)' }), // self by id
      C({ id: '201', name: 'Jane Doe', title: 'Contracting Officer' }),
      C({ id: '202', name: 'John Roe', title: 'Contract Specialist' }),
      C({ id: '', name: 'No Id (excluded — cannot open a drawer)' }),
      C({ id: '201', name: 'Dup Id (excluded)' }),           // dup id
    ],
  };

  it('returns roster peers with a real id, excluding self, deduped', () => {
    const out = buyerSimilarPeers(b, 6);
    expect(out.map((c) => c.id)).toEqual(['201', '202']);
  });

  it('skips contacts with no id (a card needs the id to open the peer drawer)', () => {
    const out = buyerSimilarPeers({ id: '1', roster: [C({ id: '', name: 'x' }), C({ id: '2', name: 'y' })] }, 6);
    expect(out.map((c) => c.id)).toEqual(['2']);
  });

  it('caps at the limit', () => {
    const roster = [];
    for (let i = 1; i <= 12; i++) roster.push(C({ id: String(i + 500), name: 'P' + i }));
    const out = buyerSimilarPeers({ id: '1', roster }, 6);
    expect(out).toHaveLength(6);
  });

  it('returns [] when the roster is empty / missing', () => {
    expect(buyerSimilarPeers({ id: '1', roster: [] }, 6)).toEqual([]);
    expect(buyerSimilarPeers({ id: '1' }, 6)).toEqual([]);
  });
});
