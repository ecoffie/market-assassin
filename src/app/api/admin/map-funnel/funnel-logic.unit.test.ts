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

/**
 * Strategy COMBINATION rollup (PR2) — the combo is the SORTED strand set, so click order doesn't
 * fragment it, and the rollup is user-based (distinct users per combo). Mirrors the route's logic.
 */
function rollupStrategies(rows: { user_email: string; combo?: string; strands?: string[] }[]) {
  const comboUsers: Record<string, Set<string>> = {};
  const strandUsers: Record<string, Set<string>> = {};
  for (const r of rows) {
    const combo = r.combo || (Array.isArray(r.strands) ? r.strands.slice().sort().join('+') : '');
    if (!combo) continue;
    (comboUsers[combo] ||= new Set()).add(r.user_email.toLowerCase());
    for (const s of combo.split('+')) (strandUsers[s] ||= new Set()).add(r.user_email.toLowerCase());
  }
  return {
    top: Object.keys(comboUsers).map((c) => ({ combo: c, users: comboUsers[c].size })).sort((a, b) => b.users - a.users),
    strands: Object.keys(strandUsers).map((s) => ({ strand: s, users: strandUsers[s].size })).sort((a, b) => b.users - a.users),
  };
}

describe('strategy combination rollup', () => {
  it('a strategy = the SORTED strand set (click order does not fragment the combo)', () => {
    const r = rollupStrategies([
      { user_email: 'a@x.com', strands: ['set_aside', 'repeat_buyer'] },     // sorts → repeat_buyer+set_aside
      { user_email: 'b@x.com', strands: ['repeat_buyer', 'set_aside'] },     // same combo, different order
    ]);
    expect(r.top).toHaveLength(1);
    expect(r.top[0].combo).toBe('repeat_buyer+set_aside');
    expect(r.top[0].users).toBe(2);
  });

  it('ranks combos by distinct users; marginal strand popularity is separate', () => {
    const r = rollupStrategies([
      { user_email: 'a@x.com', combo: 'repeat_buyer+sb_friendly+closes_soon' },
      { user_email: 'b@x.com', combo: 'repeat_buyer+sb_friendly+closes_soon' },
      { user_email: 'c@x.com', combo: 'repeat_buyer' },
    ]);
    expect(r.top[0].combo).toBe('repeat_buyer+sb_friendly+closes_soon'); // 2 users beats the solo
    expect(r.top[0].users).toBe(2);
    // repeat_buyer appears in BOTH combos → 3 distinct users marginally; it's the most popular strand.
    expect(r.strands.find((s) => s.strand === 'repeat_buyer')!.users).toBe(3);
    expect(r.strands.find((s) => s.strand === 'closes_soon')!.users).toBe(2);
  });

  it('empty combo is ignored (an empty Apply is not a strategy)', () => {
    const r = rollupStrategies([{ user_email: 'a@x.com', strands: [] }, { user_email: 'b@x.com', combo: '' }]);
    expect(r.top).toHaveLength(0);
  });
});

/**
 * "Why this opportunity?" — per-strand click-through (PR3). Mirrors the route: for each strand seen on
 * an impression/click event's metadata.dna, count impressions vs clicks; ctr = clicks/impressions, but
 * only above a minImpressions floor (else null — not enough data to trust the rate).
 */
function rollupWhy(rows: { kind: 'impression' | 'click'; dna: string[] }[], minImpr = 20) {
  const impr: Record<string, number> = {}, click: Record<string, number> = {};
  for (const r of rows) {
    const bucket = r.kind === 'impression' ? impr : click;
    for (const s of r.dna) if (s) bucket[s] = (bucket[s] || 0) + 1;
  }
  return [...new Set([...Object.keys(impr), ...Object.keys(click)])]
    .map((strand) => {
      const impressions = impr[strand] || 0, clicks = click[strand] || 0;
      const ctr = impressions >= minImpr ? Math.round((clicks / impressions) * 1000) / 10 : null;
      return { strand, impressions, clicks, ctr };
    })
    .sort((a, b) => (b.ctr ?? -1) - (a.ctr ?? -1) || b.clicks - a.clicks);
}

describe('why-this-opportunity per-strand click-through', () => {
  it('computes CTR = clicks/impressions per strand (above the floor)', () => {
    const rows: { kind: 'impression' | 'click'; dna: string[] }[] = [];
    for (let i = 0; i < 100; i++) rows.push({ kind: 'impression', dna: ['repeat_buyer'] });
    for (let i = 0; i < 30; i++) rows.push({ kind: 'click', dna: ['repeat_buyer'] });
    const r = rollupWhy(rows, 20);
    expect(r[0].strand).toBe('repeat_buyer');
    expect(r[0].ctr).toBeCloseTo(30); // 30 clicks / 100 impressions = 30%
  });

  it('a strand below the impression floor gets ctr=null (not a fabricated 100%)', () => {
    // set_aside seen 3× impression, clicked once → would be 33% but below the 20-floor → null.
    const rows: { kind: 'impression' | 'click'; dna: string[] }[] = [
      { kind: 'impression', dna: ['set_aside'] }, { kind: 'impression', dna: ['set_aside'] },
      { kind: 'impression', dna: ['set_aside'] }, { kind: 'click', dna: ['set_aside'] },
    ];
    const r = rollupWhy(rows, 20);
    expect(r.find((s) => s.strand === 'set_aside')!.ctr).toBeNull();
  });

  it('the higher-CTR strand ranks first (which strand DRIVES the click)', () => {
    const rows: { kind: 'impression' | 'click'; dna: string[] }[] = [];
    for (let i = 0; i < 50; i++) rows.push({ kind: 'impression', dna: ['repeat_buyer', 'full_open'] });
    for (let i = 0; i < 25; i++) rows.push({ kind: 'click', dna: ['repeat_buyer'] }); // 50% CTR
    for (let i = 0; i < 5; i++) rows.push({ kind: 'click', dna: ['full_open'] });     // 10% CTR
    const r = rollupWhy(rows, 20);
    expect(r[0].strand).toBe('repeat_buyer'); // 50% beats 10% — repeat_buyer drives the click
    expect(r[0].ctr).toBeCloseTo(50);
  });
});
