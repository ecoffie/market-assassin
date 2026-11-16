import { describe, it, expect } from 'vitest';
import { missingHorizonFooter, findCompletionFooter, comingBackTable, prioritizedComingBack, answerNamesTopComingBack, comingBackListLeadsWithNotCompeted } from './find-completeness';
import { orderCompetedFirst } from '../opportunities/competition-facts';
import flFx from './__fixtures__/fl-janitorial-coming-back.json';

const FL = {
  open_now: { status: 'grounded', matched_count: 9 },
  coming_back: { status: 'grounded', matched_count: 80, direct_match: 44, related_market_candidate: 36 },
  coming_soon: { status: 'empty', matched_count: 0 },
};

describe('missingHorizonFooter', () => {
  it('the parity-run case: an answer that stopped after "Open now" gets Coming back + Coming soon from the summary', () => {
    const f = missingHorizonFooter('### Open now\n\n**Coast Guard janitorial — Key West** …', FL);
    expect(f).toBe('\n\n**Coming back:** 80 expiring contracts matched (44 direct, 36 related-market, not confirmed); these are not open solicitations. Ask me to list them.\n\n**Coming soon:** no matching agency forecasts.');
  });
  it('a complete answer gets nothing', () => {
    expect(missingHorizonFooter('## Open now\n…\n## Coming back\n…\n## Coming soon\n…', FL)).toBe('');
  });
  it('unavailable is said as unavailable, never zero', () => {
    const f = missingHorizonFooter('Open now: …', { ...FL, coming_soon: { status: 'unavailable', matched_count: null } });
    expect(f).toContain('**Coming soon:** could not be checked this time (not a zero).');
  });
  it('an open-only answer with no Open heading gets the open count', () => {
    expect(missingHorizonFooter('Coming back … Coming soon …', FL)).toBe('\n\n**Open now:** 9 open notices matched the search; ask me to list them.');
  });
  it('no summary, or only the horizons the tool returned', () => {
    expect(missingHorizonFooter('anything', null)).toBe('');
    expect(missingHorizonFooter('Open now …', { open_now: FL.open_now })).toBe('');
  });
});

// ───────── Florida janitorial regression (quality round, 2026-11-16) ─────────

const FL_FIND = { summary: flFx.summary, horizons: { coming_back: { status: 'grounded', items: flFx.items } } };
// What production a6d61a73 printed on erika@'s map chat: Coming back collapsed to one counts line.
const COLLAPSED = '## Open now\n\n- Coast Guard Sector Key West recurring janitorial services …\n\n## Coming back\n\n80 expiring contracts matched (44 direct, 36 related). Ask me to list them.\n\n## Coming soon\n\nNo matching Florida janitorial forecasts were returned.';

describe('Florida janitorial: Coming back rows are shown deterministically, qualified by how they were awarded', () => {
  it('a collapsed Coming back gets the top-10 table from the tool data (not a second counts line)', () => {
    const { text, addedTable } = findCompletionFooter(COLLAPSED, FL_FIND);
    expect(addedTable).toBe(true);
    const rows = text.split('\n').filter((l) => /^\| \[/.test(l));
    expect(rows).toHaveLength(10);
    expect(text).toMatch(/top direct matches/);
    expect(text).toMatch(/80 matched \(44 direct, 36 related, not confirmed\)/);
    expect(text).not.toMatch(/\*\*Coming back:\*\*/); // no counts-only line on top of the table
    // Narrow panel: exactly four columns.
    for (const r of rows) expect(r.split('|').length - 2).toBe(4);
  });

  it('competed rows lead; AbilityOne / 8(a) sole-source rows follow; no row says "Full & Open"', () => {
    const order = prioritizedComingBack(flFx.items);
    const firstRestricted = order.findIndex((i) => i.competition?.class === 'not_competed');
    expect(order.slice(0, firstRestricted).every((i) => i.competition?.class !== 'not_competed')).toBe(true);
    expect(order.slice(firstRestricted).every((i) => i.competition?.class === 'not_competed')).toBe(true);
    const table = comingBackTable(flFx.items);
    expect(table).not.toMatch(/Full & Open|Full and open/i);
    // The $15.4M Gulfstream Goodwill row is labelled for what its record says, and is not first.
    expect(table.split('\n')[2]).not.toMatch(/Gulfstream/i);
    expect(table).toMatch(/Competed · SB set-aside/);
    expect(table).toMatch(/Not competed · AbilityOne/);
  });

  it('exact values and dates, a USASpending link per row, and no Puerto Rico location', () => {
    const table = comingBackTable(flFx.items);
    expect(table).toMatch(/\| \$763K \| Nov\. 30, 2026 \|/); // Dammel Cleaning, copied exactly
    expect(table).toMatch(/\(https:\/\/www\.usaspending\.gov\/award\/CONT_AWD_/);
    expect(flFx.items.every((i) => i.location_label === 'FL')).toBe(true);
  });

  it('an answer that already names the top rows, or has its own table, gets no second table', () => {
    const named = prioritizedComingBack(flFx.items).slice(0, 5).map((i) => i.incumbent_name).join('; ');
    expect(answerNamesTopComingBack(`## Coming back\n${named}`, flFx.items)).toBe(true);
    const ownTable = '| a | b |\n|---|---|\n' + Array.from({ length: 6 }, (_, k) => `| r${k} | x |`).join('\n');
    expect(findCompletionFooter(`## Open now\n…\n## Coming back\n${ownTable}\n## Coming soon\n…`, FL_FIND).addedTable).toBe(false);
  });

  it('fewer than three direct rows: prose is fine, no table; related rows are never tabled', () => {
    const two = flFx.items.slice(0, 2);
    expect(findCompletionFooter('## Open now … ## Coming back one line ## Coming soon …', { summary: flFx.summary, horizons: { coming_back: { status: 'grounded', items: two } } }).addedTable).toBe(false);
    const related = flFx.items.map((i) => ({ ...i, evidence_class: 'RELATED_MARKET_CANDIDATE' }));
    expect(comingBackTable(related)).toBe('');
  });
});

describe('Coming back order: competed first in every list (FL janitorial, 2026-11-16)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const items = (flFx as any).items as Parameters<typeof orderCompetedFirst>[0];
  it('the tool order puts every competed / not-established row before any not-competed one, keeping end-date order inside each group', () => {
    expect(items[0].competition?.class).toBe('not_competed'); // fixture = the pre-fix order (Ally Facility first)
    const out = orderCompetedFirst(items);
    expect(out).toHaveLength(items.length);
    const firstRestricted = out.findIndex((i) => i.competition?.class === 'not_competed');
    expect(out.slice(firstRestricted).every((i) => i.competition?.class === 'not_competed')).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const names = out.slice(0, firstRestricted).map((i: any) => i.incumbent_name);
    expect(names).toEqual(['DAMMEL CLEANING ENTERPRISE INC', 'CARC-ADVOCATES FOR CITIZENS WITH DISABILITIES, INC.', 'FORTAZO CORP.', 'NASCENCE GROUP LLC', 'VIP SPECIAL SERVICES LLC', 'CITADEL FEDERAL SOLUTIONS LLC']);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((out[firstRestricted] as any).incumbent_name).toBe('ALLY FACILITY SOLUTIONS, INC.');
  });
  it('evidence classes keep their order; a class is never mixed into another', () => {
    const rows = [
      { evidence_class: 'DIRECT_MATCH', competition: { class: 'not_competed' }, id: 1 },
      { evidence_class: 'DIRECT_MATCH', competition: { class: 'competed' }, id: 2 },
      { evidence_class: 'RELATED_MARKET_CANDIDATE', competition: { class: 'competed' }, id: 3 },
      { evidence_class: 'RELATED_MARKET_CANDIDATE', competition: null, id: 4 },
    ];
    expect(orderCompetedFirst(rows).map((r) => r.id)).toEqual([2, 1, 3, 4]);
  });
  it('flags a short list that opens with the not-competed Ally Facility row; passes once competed rows lead', () => {
    const bad = 'Coming back in Florida:\n- **Ally Facility Solutions** — ends Nov. 18, 2026 (Not competed)\n- **Dammel Cleaning Enterprise** — ends Nov. 30, 2026 (Competed · SB set-aside)';
    const good = 'Coming back in Florida:\n- **Dammel Cleaning Enterprise** — ends Nov. 30, 2026 (Competed · SB set-aside)\n- **Ally Facility Solutions** — ends Nov. 18, 2026 (Not competed)';
    expect(comingBackListLeadsWithNotCompeted(bad, items)).toBe(true);
    expect(comingBackListLeadsWithNotCompeted(good, items)).toBe(false);
  });
  it('the table alone never triggers it, and an all-not-competed result has nothing to put first', () => {
    expect(comingBackListLeadsWithNotCompeted(comingBackTable(items), items)).toBe(false);
    const restrictedOnly = items.filter((i) => i.competition?.class === 'not_competed');
    expect(comingBackListLeadsWithNotCompeted('Ally Facility Solutions ends soon.', restrictedOnly)).toBe(false);
  });
});
