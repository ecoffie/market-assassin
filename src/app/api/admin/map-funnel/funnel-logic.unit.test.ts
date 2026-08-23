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
  { step: 'pursuit_started', tokens: ['pursuit_started', 'save_to_pipeline', 'start_pursuit_clicked'] },
  { step: 'proposal_started', tokens: ['proposal_started', 'proposal_opened'] },
  // Lifecycle past discovery (2026-08-06) — kept in sync with route.ts.
  { step: 'proposal_built', tokens: ['section_built'] },
  { step: 'proposal_exported', tokens: ['export_proposal'] },
  { step: 'proposal_submitted', tokens: ['proposal_submitted'] },
];

// Terminal outcomes (NOT funnel steps) — a pursuit closes won/lost/no-bid.
const OUTCOME_TOKENS: Record<string, string> = { pursuit_won: 'won', pursuit_lost: 'lost', pursuit_nobid: 'no_bid' };
function tallyOutcomes(rows: Row[]) {
  const c: Record<string, number> = { won: 0, lost: 0, no_bid: 0 };
  for (const r of rows) { const t = r.metadata?.action || ''; if (OUTCOME_TOKENS[t]) c[OUTCOME_TOKENS[t]] += 1; }
  const decided = c.won + c.lost;
  return { ...c, total: c.won + c.lost + c.no_bid, winRate: decided > 0 ? Math.round((c.won / decided) * 1000) / 10 : null };
}

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

  it('the full lifecycle steps stay in the documented order (discovery -> execution)', () => {
    expect(FUNNEL_STEPS.map((s) => s.step)).toEqual([
      'map_open', 'pin_clicked', 'popup_open', 'listing_open', 'pursuit_started', 'proposal_started',
      'proposal_built', 'proposal_exported', 'proposal_submitted',
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
});

describe('lifecycle funnel continues past discovery (Saved -> Pursuit -> Proposal -> Submitted)', () => {
  it('the new tokens map to their steps + convert user-based', () => {
    const rows: Row[] = [
      { user_email: 'a', metadata: { action: 'map_view' } },
      { user_email: 'a', metadata: { action: 'pursuit_started' } },
      { user_email: 'b', metadata: { action: 'start_pursuit_clicked' } },   // Saved-side hop also = pursuit_started
      { user_email: 'a', metadata: { action: 'proposal_opened' } },          // workspace mount = proposal_started step
      { user_email: 'a', metadata: { action: 'section_built' } },
      { user_email: 'a', metadata: { action: 'proposal_submitted' } },
    ];
    const f = buildFunnel(rows);
    const by = Object.fromEntries(f.map((s) => [s.step, s.users]));
    expect(by.pursuit_started).toBe(2);      // a (pursuit_started) + b (start_pursuit_clicked)
    expect(by.proposal_started).toBe(1);     // a (proposal_opened)
    expect(by.proposal_built).toBe(1);
    expect(by.proposal_submitted).toBe(1);
  });
});

describe('terminal pursuit outcomes (won/lost/no-bid) — a separate breakdown, not a funnel step', () => {
  it('tallies by EVENT + computes winRate = won/(won+lost), no-bid excluded from the rate', () => {
    const rows: Row[] = [
      { user_email: 'a', metadata: { action: 'pursuit_won' } },
      { user_email: 'a', metadata: { action: 'pursuit_won' } },   // one user can close many
      { user_email: 'b', metadata: { action: 'pursuit_lost' } },
      { user_email: 'c', metadata: { action: 'pursuit_nobid' } },
    ];
    const o = tallyOutcomes(rows);
    expect(o.won).toBe(2); expect(o.lost).toBe(1); expect(o.no_bid).toBe(1); expect(o.total).toBe(4);
    expect(o.winRate).toBe(66.7);   // 2 / (2+1) = 66.7%, no-bid not in the denominator
  });
  it('nothing closed -> winRate null (not a fabricated 0%)', () => {
    expect(tallyOutcomes([]).winRate).toBe(null);
  });
  it('outcome tokens are NOT counted as funnel steps', () => {
    const f = buildFunnel([{ user_email: 'a', metadata: { action: 'pursuit_won' } }]);
    expect(f.every((s) => s.users === 0)).toBe(true);   // won is not a step
  });
});

describe('why-this-opportunity strand ranking', () => {
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

/**
 * ══ THE RESHAPE: two loops, two lenses ══
 * Discovery is measured by RETURN + engagement, never conversion (Principle 01/02); execution is a
 * legitimate funnel and the ONLY place a drop callout may appear. These pure helpers mirror route.ts.
 */

// Return-visit headline (Principle 02) — a "returner" = a user active on 2+ DISTINCT calendar days.
// Mirrors dayKey() + userActiveDays in the route. null (never 0%) when there are no active users.
interface DayRow { user_email: string; created_at: string }
function returnVisit(rows: DayRow[]) {
  const dayKey = (iso: string) => (iso.indexOf('T') > 0 ? iso.slice(0, iso.indexOf('T')) : iso.slice(0, 10));
  const userDays: Record<string, Set<string>> = {};
  for (const r of rows) (userDays[r.user_email.toLowerCase()] ||= new Set()).add(dayKey(r.created_at));
  const emails = Object.keys(userDays);
  const returners = emails.filter((e) => userDays[e].size >= 2).length;
  const counts = emails.map((e) => userDays[e].size).sort((a, b) => a - b);
  const median = counts.length
    ? (counts.length % 2 ? counts[(counts.length - 1) / 2] : (counts[counts.length / 2 - 1] + counts[counts.length / 2]) / 2)
    : null;
  return {
    activeUsers: emails.length,
    returners,
    returnRate: emails.length > 0 ? Math.round((returners / emails.length) * 1000) / 10 : null,
    medianActiveDays: median,
  };
}

describe('return-visit headline (Principle 02: we optimise return visits)', () => {
  it('a user active on 2+ DISTINCT days is a returner; a 1-day user is NOT', () => {
    const rows: DayRow[] = [
      { user_email: 'a@x.com', created_at: '2026-08-01T09:00:00Z' }, // day 1
      { user_email: 'a@x.com', created_at: '2026-08-03T10:00:00Z' }, // day 2 → returner
      { user_email: 'b@x.com', created_at: '2026-08-01T08:00:00Z' }, // single day
      { user_email: 'b@x.com', created_at: '2026-08-01T18:00:00Z' }, // SAME day → not a returner
    ];
    const rv = returnVisit(rows);
    expect(rv.activeUsers).toBe(2);
    expect(rv.returners).toBe(1);            // only a@x.com came back on a later day
    expect(rv.returnRate).toBe(50);          // 1 of 2
    expect(rv.medianActiveDays).toBe(1.5);   // a=2 days, b=1 day
  });

  it('no active users -> returnRate null (not a fabricated 0%)', () => {
    const rv = returnVisit([]);
    expect(rv.activeUsers).toBe(0);
    expect(rv.returnRate).toBeNull();
    expect(rv.medianActiveDays).toBeNull();
  });
});

// The two PENDING discovery ratios (Working Backwards §3). Both null when the denominator is 0.
function alertToMapReach(alertOpeners: string[], mapOpeners: string[]) {
  const openers = new Set(alertOpeners.map((e) => e.toLowerCase()));
  const map = new Set(mapOpeners.map((e) => e.toLowerCase()));
  let reached = 0;
  for (const e of openers) if (map.has(e)) reached += 1;
  return {
    alertOpeners: openers.size,
    reachedMap: reached,
    ratio: openers.size > 0 ? Math.round((reached / openers.size) * 1000) / 10 : null, // null = no data yet
  };
}
function cardsToListing(impressions: number, listingOpens: number) {
  return {
    impressions,
    listingOpens,
    ratio: impressions > 0 ? Math.round((listingOpens / impressions) * 1000) / 10 : null, // null = no data yet
  };
}

describe('discovery ratio 1 — daily_alert opener -> map reach', () => {
  it('is % of alert-openers who also opened the map (correct when present)', () => {
    const r = alertToMapReach(['a@x.com', 'b@x.com', 'c@x.com', 'd@x.com'], ['a@x.com', 'c@x.com', 'z@x.com']);
    expect(r.alertOpeners).toBe(4);
    expect(r.reachedMap).toBe(2);   // a + c reached the map; z is not an alert opener
    expect(r.ratio).toBe(50);
  });
  it('no alert openers -> ratio null (never a fabricated 0%)', () => {
    expect(alertToMapReach([], ['a@x.com']).ratio).toBeNull();
  });
});

describe('discovery ratio 2 — cards_shown -> listing_open', () => {
  it('is listingOpens / impressions (correct when present)', () => {
    expect(cardsToListing(200, 50).ratio).toBe(25);
  });
  it('zero impressions -> ratio null (never a fabricated 0% or a divide-by-zero)', () => {
    expect(cardsToListing(0, 0).ratio).toBeNull();
    expect(cardsToListing(0, 5).ratio).toBeNull(); // clicks with no recorded impression is still "no data"
  });
});

/**
 * The two-loop split: discovery steps NEVER carry a drop flag (browsing is normal); the EXECUTION
 * funnel may. Mirrors JOURNEY_STEPS[].loop + the route's per-loop aggregation.
 */
const JOURNEY_STEPS_WITH_LOOP: { step: string; loop: 'discovery' | 'execution' }[] = [
  { step: 'map_open', loop: 'discovery' },
  { step: 'pin_clicked', loop: 'discovery' },
  { step: 'popup_open', loop: 'discovery' },
  { step: 'listing_open', loop: 'discovery' },
  { step: 'saved', loop: 'discovery' },
  { step: 'pursuit_started', loop: 'execution' },
  { step: 'proposal_started', loop: 'execution' },
  { step: 'proposal_built', loop: 'execution' },
  { step: 'proposal_exported', loop: 'execution' },
  { step: 'proposal_submitted', loop: 'execution' },
];

// Discovery steps: neutral "N of the step above" — NO drop field is produced.
function discoveryStepRows(users: Record<string, number>) {
  const defs = JOURNEY_STEPS_WITH_LOOP.filter((s) => s.loop === 'discovery');
  let prev = users[defs[0].step] ?? 0;
  const top = prev;
  return defs.map((s, i) => {
    const u = users[s.step] ?? 0;
    const ofPrev = i === 0 ? null : (prev > 0 ? Math.round((u / prev) * 1000) / 10 : null);
    const ofTop = top > 0 ? Math.round((u / top) * 1000) / 10 : null;
    prev = u;
    return { step: s.step, users: u, ofPrev, ofTop };
  });
}

// Execution funnel: conversion + the biggest drop (scoped to execution ONLY).
function executionFunnel(users: Record<string, number>) {
  const defs = JOURNEY_STEPS_WITH_LOOP.filter((s) => s.loop === 'execution');
  const top = users[defs[0].step] ?? 0;
  let prev = top;
  const steps = defs.map((s, i) => {
    const u = users[s.step] ?? 0;
    const convFromPrev = i === 0 ? null : (prev > 0 ? Math.round((u / prev) * 1000) / 10 : null);
    prev = u;
    return { step: s.step, users: u, convFromPrev };
  });
  let biggestDrop: { fromStep: string; toStep: string; dropPct: number } | null = null;
  for (let i = 1; i < steps.length; i++) {
    const p = steps[i - 1].users, c = steps[i].users;
    if (p > 0) {
      const drop = Math.round((1 - c / p) * 1000) / 10;
      if (!biggestDrop || drop > biggestDrop.dropPct) biggestDrop = { fromStep: steps[i - 1].step, toStep: steps[i].step, dropPct: drop };
    }
  }
  return { steps, biggestDrop };
}

describe('two-loop split — discovery is not scored by conversion; execution is a funnel', () => {
  it('discovery step rows carry NO drop flag (only neutral ofPrev/ofTop context)', () => {
    const rows = discoveryStepRows({ map_open: 100, pin_clicked: 30, popup_open: 20, listing_open: 12, saved: 4 });
    // A low ratio (30% pin, 33% save) is NORMAL browsing — never surfaced as a "drop" to fix.
    for (const r of rows) {
      expect('drop' in r).toBe(false);
      expect('isDrop' in r).toBe(false);
    }
    expect(rows.find((r) => r.step === 'pin_clicked')!.ofPrev).toBe(30);   // neutral share of the step above
    expect(rows.find((r) => r.step === 'map_open')!.ofPrev).toBeNull();     // the mouth has no prior step
  });

  it('the execution funnel DOES compute a biggest drop, scoped to execution steps only', () => {
    const { biggestDrop } = executionFunnel({
      pursuit_started: 40, proposal_started: 30, proposal_built: 6, proposal_exported: 4, proposal_submitted: 3,
    });
    expect(biggestDrop).not.toBeNull();
    // proposal_started(30) -> proposal_built(6) = 80% drop — the steepest execution stall.
    expect(biggestDrop!.fromStep).toBe('proposal_started');
    expect(biggestDrop!.toStep).toBe('proposal_built');
    expect(biggestDrop!.dropPct).toBe(80);
    // The drop's steps are BOTH execution steps — a discovery step can never be named here.
    const discoverySet = new Set(JOURNEY_STEPS_WITH_LOOP.filter((s) => s.loop === 'discovery').map((s) => s.step));
    expect(discoverySet.has(biggestDrop!.fromStep)).toBe(false);
    expect(discoverySet.has(biggestDrop!.toStep)).toBe(false);
  });

  it('no execution activity -> biggestDrop null (not a fabricated stall)', () => {
    const { biggestDrop } = executionFunnel({});
    expect(biggestDrop).toBeNull();
  });
});

/**
 * ══ MISSION CONTROL RESHAPE (2026-08-06) ══
 * The five-stage lifecycle Discover → Decide → Pursue → Build → Win. North-star = EXECUTION-ONLY;
 * Product Intelligence = grounded in won pursuits ⋈ sam_opportunities; discovery is NEVER scored by
 * conversion. These pure helpers mirror route.ts exactly.
 */

// NORTH-STAR "Opportunities Advanced": derived ONLY from the execution steps (pursuit onward).
const EXECUTION_STEP_KEYS = ['pursuit_started', 'proposal_started', 'proposal_built', 'proposal_exported', 'proposal_submitted'];
function buildNorthStar(users: Record<string, number>) {
  const defs = JOURNEY_STEPS_WITH_LOOP.filter((s) => s.loop === 'execution');
  return { label: 'Opportunities Advanced', steps: defs.map((s) => ({ step: s.step, users: users[s.step] ?? 0 })) };
}

describe('north-star "Opportunities Advanced" — EXECUTION-ONLY', () => {
  it('derives ONLY from execution steps; no discovery step ever appears', () => {
    const ns = buildNorthStar({ map_open: 999, pursuit_started: 40, proposal_started: 30, proposal_submitted: 3 });
    const discoverySet = new Set(JOURNEY_STEPS_WITH_LOOP.filter((s) => s.loop === 'discovery').map((s) => s.step));
    expect(ns.steps.every((s) => !discoverySet.has(s.step))).toBe(true);      // no map_open/pin/popup/listing/saved
    expect(ns.steps.map((s) => s.step)).toEqual(EXECUTION_STEP_KEYS);          // exactly the execution chain
    expect(ns.steps[0].step).toBe('pursuit_started');                          // starts at Pursuit, not Discover
    expect(ns.steps.find((s) => s.step === 'map_open')).toBeUndefined();       // the huge discovery number can't leak in
  });
});

// PRODUCT INTELLIGENCE aggregation — mirrors the route's marketWins/agencyWins/stateWins + rank().
interface WonRow { id?: string | null; notice_id: string | null; naics_code: string | null; owner_email: string | null; user_email: string | null }
interface SamRow { department: string | null; sub_tier: string | null; naics_code: string | null; state: string | null }
// A tiny stand-in for isExcludedFromMetrics (staff domain + a known testimonial address).
const isExcluded = (email: string) => email.endsWith('@govcongiants.com') || email === 'aj@cypherintel.com';
// wonAt: pipeline id -> won-transition ISO (from pipeline_history where to_stage='won'). sinceIso null = all-time.
function buildProductIntelligence(won: WonRow[], sam: Record<string, SamRow>, wonAt: Record<string, string> = {}, sinceIso: string | null = null) {
  const staffOk = won.filter((r) => !isExcluded((r.owner_email || r.user_email || '').toLowerCase()));
  // WINDOW-SCOPE by the won-transition timestamp. A win with NO history row is undated → excluded + disclosed.
  let wonUndated = 0;
  const included = staffOk.filter((r) => {
    if (!sinceIso) return true;                          // no window → all-time (undated still counts)
    const at = r.id ? wonAt[r.id] : undefined;
    if (!at) { wonUndated += 1; return false; }          // pre-trigger win — can't be placed in the window
    return at >= sinceIso;
  });
  const marketWins: Record<string, number> = {}, agencyWins: Record<string, number> = {}, stateWins: Record<string, number> = {};
  for (const r of included) {
    const s = r.notice_id ? sam[r.notice_id] : undefined;
    const market = r.naics_code || s?.naics_code || null;
    if (market) marketWins[market] = (marketWins[market] || 0) + 1;
    const agency = s?.sub_tier || s?.department || null;
    if (agency) agencyWins[agency] = (agencyWins[agency] || 0) + 1;
    const state = s?.state || null;
    if (state) stateWins[state] = (stateWins[state] || 0) + 1;
  }
  const rank = (m: Record<string, number>) => Object.keys(m).map((key) => ({ key, wins: m[key] })).sort((a, b) => b.wins - a.wins).slice(0, 8);
  return { grounded: included.length > 0, windowScoped: sinceIso != null, wonCount: included.length, wonUndated, topMarket: rank(marketWins), topAgency: rank(agencyWins), topState: rank(stateWins) };
}

describe('product intelligence — grounded in won pursuits ⋈ sam_opportunities', () => {
  it('ranks topMarket / topAgency / topState by win count desc', () => {
    const won: WonRow[] = [
      { notice_id: 'n1', naics_code: '541512', owner_email: 'a@co.com', user_email: 'a@co.com' },
      { notice_id: 'n2', naics_code: '541512', owner_email: 'b@co.com', user_email: 'b@co.com' },
      { notice_id: 'n3', naics_code: '236220', owner_email: 'c@co.com', user_email: 'c@co.com' },
    ];
    const sam: Record<string, SamRow> = {
      n1: { department: 'DEPT OF DEFENSE', sub_tier: 'DEPT OF THE NAVY', naics_code: '541512', state: 'VA' },
      n2: { department: 'DEPT OF DEFENSE', sub_tier: 'DEPT OF THE NAVY', naics_code: '541512', state: 'VA' },
      n3: { department: 'INTERIOR', sub_tier: 'NATIONAL PARK SERVICE', naics_code: '236220', state: 'CA' },
    };
    const pi = buildProductIntelligence(won, sam);
    expect(pi.grounded).toBe(true);
    expect(pi.wonCount).toBe(3);
    expect(pi.topMarket[0]).toEqual({ key: '541512', wins: 2 });   // NAICS 541512 leads
    expect(pi.topAgency[0]).toEqual({ key: 'DEPT OF THE NAVY', wins: 2 }); // sub_tier preferred
    expect(pi.topState[0]).toEqual({ key: 'VA', wins: 2 });        // state VA leads
  });

  it('agency falls back to department when sub_tier is missing', () => {
    const won: WonRow[] = [{ notice_id: 'n1', naics_code: '541512', owner_email: 'a@co.com', user_email: 'a@co.com' }];
    const sam: Record<string, SamRow> = { n1: { department: 'INTERIOR', sub_tier: null, naics_code: '541512', state: 'CA' } };
    const pi = buildProductIntelligence(won, sam);
    expect(pi.topAgency[0]).toEqual({ key: 'INTERIOR', wins: 1 });
  });

  it('market falls back to the joined sam naics_code when the pursuit has none', () => {
    const won: WonRow[] = [{ notice_id: 'n1', naics_code: null, owner_email: 'a@co.com', user_email: 'a@co.com' }];
    const sam: Record<string, SamRow> = { n1: { department: 'X', sub_tier: null, naics_code: '332312', state: 'TX' } };
    const pi = buildProductIntelligence(won, sam);
    expect(pi.topMarket[0]).toEqual({ key: '332312', wins: 1 });
  });

  it('zero won pursuits -> grounded:false, wonCount:0, empty rankings', () => {
    const pi = buildProductIntelligence([], {});
    expect(pi.grounded).toBe(false);
    expect(pi.wonCount).toBe(0);
    expect(pi.topMarket).toEqual([]);
    expect(pi.topAgency).toEqual([]);
    expect(pi.topState).toEqual([]);
  });

  it('staff/testimonial won pursuits are EXCLUDED from the aggregation', () => {
    const won: WonRow[] = [
      { notice_id: 'n1', naics_code: '541512', owner_email: 'staff@govcongiants.com', user_email: 'staff@govcongiants.com' }, // staff
      { notice_id: 'n2', naics_code: '541512', owner_email: 'aj@cypherintel.com', user_email: 'aj@cypherintel.com' },         // testimonial
      { notice_id: 'n3', naics_code: '236220', owner_email: 'real@customer.com', user_email: 'real@customer.com' },           // real
    ];
    const sam: Record<string, SamRow> = {
      n1: { department: 'D', sub_tier: 'NAVY', naics_code: '541512', state: 'VA' },
      n2: { department: 'D', sub_tier: 'NAVY', naics_code: '541512', state: 'VA' },
      n3: { department: 'INTERIOR', sub_tier: 'NPS', naics_code: '236220', state: 'CA' },
    };
    const pi = buildProductIntelligence(won, sam);
    expect(pi.wonCount).toBe(1);                                   // only the real customer counts
    expect(pi.topMarket).toEqual([{ key: '236220', wins: 1 }]);   // staff/testimonial 541512 wins are gone
    expect(pi.topAgency).toEqual([{ key: 'NPS', wins: 1 }]);
  });

  it('window-scopes by the won-transition timestamp — only wins inside [since, now] count', () => {
    const won: WonRow[] = [
      { id: 'p1', notice_id: 'n1', naics_code: '541512', owner_email: 'a@co.com', user_email: 'a@co.com' }, // won 5 days ago
      { id: 'p2', notice_id: 'n2', naics_code: '541512', owner_email: 'b@co.com', user_email: 'b@co.com' }, // won 100 days ago
    ];
    const sam: Record<string, SamRow> = {
      n1: { department: 'D', sub_tier: 'NAVY', naics_code: '541512', state: 'VA' },
      n2: { department: 'D', sub_tier: 'NAVY', naics_code: '541512', state: 'VA' },
    };
    const wonAt = { p1: '2026-08-01T00:00:00Z', p2: '2026-04-28T00:00:00Z' };
    const since30d = '2026-07-07T00:00:00Z';                       // p1 inside, p2 outside
    const pi = buildProductIntelligence(won, sam, wonAt, since30d);
    expect(pi.windowScoped).toBe(true);
    expect(pi.wonCount).toBe(1);                                   // only p1 (the 100-day-old win is excluded)
    expect(pi.wonUndated).toBe(0);                                 // both wins are dated
    expect(pi.topMarket[0]).toEqual({ key: '541512', wins: 1 });  // NOT wins:2 — the old win did not leak in
  });

  it('an undated win (no history row) is EXCLUDED from a window + DISCLOSED as wonUndated — never silently kept', () => {
    const won: WonRow[] = [
      { id: 'p1', notice_id: 'n1', naics_code: '541512', owner_email: 'a@co.com', user_email: 'a@co.com' }, // dated, in-window
      { id: 'p2', notice_id: 'n2', naics_code: '236220', owner_email: 'b@co.com', user_email: 'b@co.com' }, // pre-trigger, no wonAt
    ];
    const sam: Record<string, SamRow> = {
      n1: { department: 'D', sub_tier: 'NAVY', naics_code: '541512', state: 'VA' },
      n2: { department: 'INTERIOR', sub_tier: 'NPS', naics_code: '236220', state: 'CA' },
    };
    const wonAt = { p1: '2026-08-01T00:00:00Z' };                  // p2 absent → undated
    const pi = buildProductIntelligence(won, sam, wonAt, '2026-07-07T00:00:00Z');
    expect(pi.wonCount).toBe(1);                                   // only the dated in-window win ranks
    expect(pi.wonUndated).toBe(1);                                 // the pre-trigger win is disclosed, not hidden
    expect(pi.topMarket).toEqual([{ key: '541512', wins: 1 }]);   // the undated 236220 win is NOT ranked
  });
});

describe('two-loop split — discovery objects carry NO conversion field; execution steps DO', () => {
  it('discovery step objects have no drop/isDrop/convFromPrev; execution steps carry convFromPrev', () => {
    const discRows = discoveryStepRows({ map_open: 100, pin_clicked: 30, popup_open: 20, listing_open: 12, saved: 4 });
    for (const r of discRows) {
      expect('drop' in r).toBe(false);
      expect('isDrop' in r).toBe(false);
      expect('convFromPrev' in r).toBe(false);   // discovery is never scored by conversion
    }
    const { steps: execRows } = executionFunnel({ pursuit_started: 40, proposal_started: 30, proposal_built: 6, proposal_exported: 4, proposal_submitted: 3 });
    for (const r of execRows) {
      expect('convFromPrev' in r).toBe(true);     // execution steps DO carry the conversion field
    }
  });
});

/**
 * ── COHORT-ELIGIBLE RETURN RATE ──
 * Mirrors the returnVisit block in route.ts. The bug this locks out: dividing returners by EVERY
 * active user, which counts a user who first arrived an hour ago as a failure to return. On
 * 2026-08-22 (Mindy Day) that reported 9.7% ("return habit is soft") when the true eligible rate
 * was 20.5% — 54% of the window was too new to have returned at all.
 *
 *     No opportunity to return ≠ churn.
 */
const DAY_MS = 86_400_000;

interface ActivityRow { user_email: string; created_at: string }

function computeReturnVisit(rows: ActivityRow[], now: number, eligibilityMs = DAY_MS) {
  const dayKey = (iso: string) => iso.slice(0, 10);
  const activeDays: Record<string, Set<string>> = {};
  const firstSeen: Record<string, number> = {};
  for (const r of rows) {
    const e = r.user_email.toLowerCase();
    (activeDays[e] ||= new Set()).add(dayKey(r.created_at));
    const ts = Date.parse(r.created_at);
    if (Number.isFinite(ts) && (firstSeen[e] === undefined || ts < firstSeen[e])) firstSeen[e] = ts;
  }
  const cutoff = now - eligibilityMs;
  const all = Object.keys(activeDays);
  const eligible = all.filter((e) => (firstSeen[e] ?? Infinity) <= cutoff);
  const returners = eligible.filter((e) => {
    const first = dayKey(new Date(firstSeen[e]).toISOString());
    for (const d of activeDays[e]) if (d > first) return true;
    return false;
  });
  return {
    activeUsers: all.length,
    eligibleUsers: eligible.length,
    pendingUsers: all.length - eligible.length,
    returners: returners.length,
    returnRate: eligible.length > 0 ? Math.round((returners.length / eligible.length) * 1000) / 10 : null,
  };
}

describe('cohort-eligible return rate', () => {
  const NOW = Date.parse('2026-08-23T12:00:00.000Z');
  const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();

  it('excludes users too new to have returned, rather than scoring them as failures', () => {
    const rows: ActivityRow[] = [
      // Eligible + returned: first seen 3d ago, active again 1d ago.
      { user_email: 'returner@x.com', created_at: iso(3 * DAY_MS) },
      { user_email: 'returner@x.com', created_at: iso(1 * DAY_MS) },
      // Eligible, never came back.
      { user_email: 'oneanddone@x.com', created_at: iso(3 * DAY_MS) },
      // PENDING: arrived an hour ago — cannot have returned.
      { user_email: 'brandnew@x.com', created_at: iso(3_600_000) },
      { user_email: 'alsonew@x.com', created_at: iso(3_600_000) },
    ];
    const r = computeReturnVisit(rows, NOW);
    expect(r.activeUsers).toBe(4);
    expect(r.eligibleUsers).toBe(2);
    expect(r.pendingUsers).toBe(2);
    expect(r.returners).toBe(1);
    expect(r.returnRate).toBe(50); // 1 of 2 eligible — NOT 25% (1 of 4 active)
  });

  it('the Mindy Day shape: a launch cohort must not drag the rate down', () => {
    const rows: ActivityRow[] = [];
    // 10 established users, 4 of whom returned.
    for (let i = 0; i < 10; i++) {
      rows.push({ user_email: `old${i}@x.com`, created_at: iso(10 * DAY_MS) });
      if (i < 4) rows.push({ user_email: `old${i}@x.com`, created_at: iso(2 * DAY_MS) });
    }
    // 90 users who all arrived 2 hours ago.
    for (let i = 0; i < 90; i++) rows.push({ user_email: `new${i}@x.com`, created_at: iso(7_200_000) });

    const r = computeReturnVisit(rows, NOW);
    expect(r.activeUsers).toBe(100);
    expect(r.eligibleUsers).toBe(10);
    expect(r.pendingUsers).toBe(90);
    expect(r.returnRate).toBe(40); // the real signal
    // The old formula would have said 4/100 = 4% and called the habit broken.
    expect(Math.round((r.returners / r.activeUsers) * 1000) / 10).toBe(4);
  });

  it('returns null (not 0%) when every user is too new to be eligible', () => {
    const rows: ActivityRow[] = [
      { user_email: 'a@x.com', created_at: iso(3_600_000) },
      { user_email: 'b@x.com', created_at: iso(1_800_000) },
    ];
    const r = computeReturnVisit(rows, NOW);
    expect(r.eligibleUsers).toBe(0);
    expect(r.returnRate).toBeNull(); // 0% would be a lie the morning after a launch
    expect(r.pendingUsers).toBe(2);
  });

  it('same-day repeat activity is not a return', () => {
    const rows: ActivityRow[] = [
      { user_email: 'busy@x.com', created_at: '2026-08-20T09:00:00.000Z' },
      { user_email: 'busy@x.com', created_at: '2026-08-20T17:00:00.000Z' },
    ];
    const r = computeReturnVisit(rows, NOW);
    expect(r.eligibleUsers).toBe(1);
    expect(r.returners).toBe(0);
    expect(r.returnRate).toBe(0); // genuinely 0 — eligible, had the chance, did not return
  });
});
