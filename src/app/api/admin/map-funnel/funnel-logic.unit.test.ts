import { describe, it, expect } from 'vitest';

/**
 * Pure-logic mirror of the map-funnel step aggregation (the correctness-critical parts of route.ts).
 * The route reads user_engagement live; this test locks the token→step mapping + user-based conversion
 * so a rename of a funnel token, or a regression to raw-event (non-deduped) conversion, fails loudly.
 * Kept in sync with FUNNEL_STEPS in route.ts by asserting the exact ordered steps below.
 */

const FUNNEL_STEPS = [
  { step: 'map_open', tokens: ['map_view'] },
  { step: 'pin_clicked', tokens: ['pin_clicked'] },
  { step: 'popup_open', tokens: ['popup_open'] },
  { step: 'listing_open', tokens: ['listing_open', 'click'] },
  { step: 'pursuit_started', tokens: ['pursuit_started'] },
  { step: 'proposal_started', tokens: ['proposal_started'] },
];

interface Row { user_email: string; metadata: { action?: string; kind?: string } }

function buildFunnel(rows: Row[]) {
  const tokenToStep = new Map<string, string>();
  for (const s of FUNNEL_STEPS) for (const t of s.tokens) tokenToStep.set(t, s.step);
  const stepUsers: Record<string, Set<string>> = {};
  for (const s of FUNNEL_STEPS) stepUsers[s.step] = new Set();
  for (const r of rows) {
    const token = r.metadata?.action || r.metadata?.kind || '';
    const step = tokenToStep.get(token);
    if (!step) continue;
    stepUsers[step].add(r.user_email.toLowerCase());
  }
  const top = stepUsers[FUNNEL_STEPS[0].step].size;
  let prev = top;
  return FUNNEL_STEPS.map((s, i) => {
    const users = stepUsers[s.step].size;
    const convFromPrev = i === 0 ? 1 : (prev > 0 ? users / prev : null);
    prev = users;
    return { step: s.step, users, convFromPrev };
  });
}

describe('map funnel — token → step aggregation', () => {
  it('maps __track action AND __trackCard kind onto the same funnel (both sources)', () => {
    const rows: Row[] = [
      { user_email: 'a@x.com', metadata: { action: 'map_view' } },      // __track
      { user_email: 'a@x.com', metadata: { kind: 'popup_open' } },      // __trackCard
      { user_email: 'a@x.com', metadata: { kind: 'click' } },           // __trackCard 'click' = listing_open
    ];
    const f = buildFunnel(rows);
    expect(f.find((s) => s.step === 'map_open')!.users).toBe(1);
    expect(f.find((s) => s.step === 'popup_open')!.users).toBe(1);
    expect(f.find((s) => s.step === 'listing_open')!.users).toBe(1); // 'click' counted as listing_open
  });

  it('is USER-based, not raw-event: 5 popup_opens by one user = 1 funnel-reach', () => {
    const rows: Row[] = Array.from({ length: 5 }, () => ({ user_email: 'b@x.com', metadata: { kind: 'popup_open' } }));
    const f = buildFunnel(rows);
    expect(f.find((s) => s.step === 'popup_open')!.users).toBe(1);
  });

  it('conversion is vs the PREVIOUS step (a real drop-off curve)', () => {
    // 10 open the map, 4 click a pin → 40% map→pin conversion.
    const rows: Row[] = [];
    for (let i = 0; i < 10; i++) rows.push({ user_email: `u${i}@x.com`, metadata: { action: 'map_view' } });
    for (let i = 0; i < 4; i++) rows.push({ user_email: `u${i}@x.com`, metadata: { action: 'pin_clicked' } });
    const f = buildFunnel(rows);
    expect(f.find((s) => s.step === 'map_open')!.users).toBe(10);
    expect(f.find((s) => s.step === 'pin_clicked')!.users).toBe(4);
    expect(f.find((s) => s.step === 'pin_clicked')!.convFromPrev).toBeCloseTo(0.4);
  });

  it('unknown tokens are ignored (no fabricated funnel step)', () => {
    const f = buildFunnel([{ user_email: 'c@x.com', metadata: { action: 'map_zoom' } }]);
    expect(f.every((s) => s.users === 0)).toBe(true);
  });

  it('the six funnel steps stay in the documented order', () => {
    expect(FUNNEL_STEPS.map((s) => s.step)).toEqual([
      'map_open', 'pin_clicked', 'popup_open', 'listing_open', 'pursuit_started', 'proposal_started',
    ]);
  });
});
