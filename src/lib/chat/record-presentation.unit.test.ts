/**
 * Ask Mindy record answers: presentation (Eric, 2026-11-17, screenshot of a GA 561720 buying-offices answer).
 * Same principles as the document engine: lead with the headline, show the results as a table, keep every
 * caveat that changes interpretation in ONE short note, compact money, top 10 with an honest count.
 * Presentation only: counts, ranking and the records themselves are unchanged.
 */
import { describe, it, expect } from 'vitest';
import { renderBuyingOffices, renderExpiringRecords, renderAwardList, renderVehicleMix, prepareChatToolArgs, BUYING_OFFICES_TOOL } from './record-render';

const RAW_MONEY = /\$\d{1,3}(?:,\d{3}){2,}/; // a dollar figure with 7+ digits printed raw ($1,234,567)

function office(i: number, extra: Record<string, unknown> = {}) {
  return {
    office_name: i === 0 ? 'FLETC GLYNCO PROCUREMENT OFFICE' : `NETWORK CONTRACT OFFICE ${i}`,
    office_code: i === 0 ? '70LGLY' : `36C${String(200 + i)}`,
    agency: i === 0 ? 'Department of Homeland Security' : 'Department of Veterans Affairs',
    sub_agency: i === 0 ? 'Federal Law Enforcement Training Center' : 'Department of Veterans Affairs',
    obligated: 30_000_000 - i * 500_000 + 0.42,
    share_pct: Number((10 - i * 0.15).toFixed(2)),
    award_count: 20 - Math.min(i, 15),
    top_funding_offices: [{ name: i === 0 ? 'FLETC GLYNCO PROCUREMENT OFFICE' : `VA MEDICAL CENTER ${i}`, obligated: 1_234_567 }],
    top_places: [{ city: 'BRUNSWICK', state: 'GA', obligated: 1_000_000 }],
    example_awards: [{ piid: `70LGLY24C000${i}`, obligated: 7_105_123 }, { piid: `70LGLY24C900${i}`, obligated: -6_402 }],
    ...extra,
  };
}
const offices = [...Array.from({ length: 47 }, (_, i) => office(i)),
  { office_name: 'DOL - JCAS - AEC', office_code: '1605AE', agency: 'Department of Labor', obligated: 0, share_pct: 0, award_count: 1 },
  { office_name: 'W072 ENDIST LOUISVILLE', office_code: 'W912QR', agency: 'Department of Defense', obligated: -6402, share_pct: 0, award_count: 1 },
  { office_name: 'USDA-FS, CSA EAST 11', office_code: '124451', agency: 'Department of Agriculture', obligated: -10, share_pct: 0, award_count: 1 }];
const GA = {
  scope: { state: 'GA', naics: ['561720'], window: 'FY2024-FY2026 (federal fiscal years, Oct 1 - Sep 30)' },
  offices,
  totals: { obligated: 298_054_424, award_count: 198, office_count: 52 },
  notes: ['No window given: defaulted to FY2024-FY2026.'],
  _meta: {
    as_of: '2026-09-30',
    lag_note: 'Source: USASpending contract actions in the Mindy BigQuery warehouse (prime contracts only; ingested weekly). as_of is the latest action date loaded for the last fiscal year in the window, not today.',
    defense_lag: { applies: true, note: 'Defense (DoD, including Navy, Army and Air Force) contract actions are published with a ~90-day delay, so Defense dollars after about 2026-08-19 may not be in these totals yet; the window runs through 2026-09-30.' },
    applied_filters: { rank_by: 'awarding' },
  },
};

describe('buying offices: presentation', () => {
  const r = renderBuyingOffices(GA)!;
  const lines = r.text.split('\n');
  it('leads with ONE headline sentence: count, compact total, awards', () => {
    expect(lines[0]).toMatch(/^\*\*52 contracting offices\*\* recorded award actions for this work: \*\*\$298\.1M\*\* net obligated across 198 awards\.$/);
  });
  it('never prints a raw 7+ digit dollar figure', () => {
    expect(r.text).not.toMatch(RAW_MONEY);
  });
  it('shows a markdown table of the top 10, with the honest count', () => {
    const header = lines.findIndex((l) => /^\| Office \| Net obligations \| Share \| Awards \| Agency \|$/.test(l));
    expect(header).toBeGreaterThan(0);
    expect(lines[header + 1]).toMatch(/^\|---/);
    const rows = lines.slice(header + 2).filter((l) => /^\| \d+\. /.test(l));
    expect(rows.length).toBe(10);
    expect(rows[0]).toBe('| 1. FLETC Glynco Procurement Office (70LGLY) | $30.0M | 10% | 20 | Federal Law Enforcement Training Center |');
    expect(r.text).toMatch(/Showing 1–10 of the 47 offices with positive net obligations\./);
    expect(r.text).toMatch(/Ask "show offices 11 to 20" for the next 10\./);
    expect(r.text).toMatch(/2 more offices rank below the top 50 retrieved/);
    expect(r.shown).toBe(10);
    expect(r.from).toBe(1);
    expect(r.to).toBe(10);
    expect(r.total).toBe(52);
    expect(r.exhaustive).toBe(false);
    expect(r.ids).toEqual(offices.slice(0, 10).map((o) => o.office_code));
  });
  it('methodology is ONE short note at the end (at most 2 lines) and keeps the caveats that change interpretation', () => {
    const at = lines.findIndex((l) => l.startsWith('**About this data:**'));
    expect(at).toBeGreaterThan(0);
    const note = lines.slice(at).join('\n');
    expect(lines.slice(at).filter((l) => l.trim()).length).toBeLessThanOrEqual(2);
    expect(note).toMatch(/net of deobligations/);
    expect(note).toMatch(/where the work was performed, not where the office sits/);
    expect(note).toMatch(/industry \(NAICS\) code/);
    expect(note).toMatch(/latest action loaded 2026-09-30/);
    expect(note).toMatch(/Defense \(DoD, including Navy, Army and Air Force\) contract actions are published with a ~90-day delay/);
    // Everything before the table is at most the headline + one scope line.
    const header = lines.findIndex((l) => l.startsWith('| Office |'));
    expect(lines.slice(0, header).filter((l) => l.trim()).length).toBeLessThanOrEqual(2);
  });
  it('no clutter: no internal words, no "))", no doubled code, no negative examples, no self-customer', () => {
    expect(r.text).not.toMatch(/as_of|BigQuery|warehouse/);
    expect(r.text).not.toMatch(/\)\)/);
    expect(r.text).not.toMatch(/\((\w+)\) \(\1\)/);
    for (const l of r.text.split('\n').filter((x) => x.includes('example awards'))) expect(l).not.toMatch(/-\$|C900/);
    expect(r.text).not.toMatch(/customers?: FLETC Glynco Procurement Office/i);
    // A window Mindy chose is disclosed in plain words, without jargon.
    expect(r.text).toMatch(/Search: NAICS 561720 · work performed in GA · FY2024-FY2026 \(federal fiscal years, Oct 1 - Sep 30\); you didn't name a period, so Mindy used this one\. /);
    expect(r.text).not.toMatch(/default window|none was given/i);
  });
  it('one precision per money column and per money list (the document engine rule)', () => {
    const decimalsOf = (xs: string[]) => new Set(xs.map((x) => (x.match(/\.(\d+)[KMB]$/)?.[1] ?? '').length));
    const rows = lines.filter((l) => /^\| \d+\. /.test(l));
    const col = rows.map((l) => l.split(' | ')[1]);
    expect(col.every((x) => /^\$\d+(\.\d+)?[KMB]$/.test(x))).toBe(true);
    expect(decimalsOf(col).size).toBe(1);
    const ex = [...r.text.matchAll(/example awards: ([^\n]+)/g)].flatMap((m) => [...m[1].matchAll(/\((\$[^)]+)\)/g)].map((x) => x[1]));
    expect(ex.length).toBeGreaterThan(1);
    expect(decimalsOf(ex).size).toBe(1);
  });
  it('offices with zero or negative net are still listed separately, never as buyers', () => {
    expect(r.text).toMatch(/Also returned, with zero or negative net obligations in this window \(deobligations, so not evidence of buying\): DOL - JCAS - AEC \(1605AE\) \$0; W072 Endist Louisville \(W912QR\) -\$6\.4K; USDA-FS, CSA East 11 \(124451\) -\$10\./);
  });
  it('page 2 (display offset 10): offices 11–20, from=11, ids in display order', () => {
    const p2 = renderBuyingOffices(GA, { offset: 10 })!;
    expect(p2.from).toBe(11);
    expect(p2.to).toBe(20);
    expect(p2.ids[0]).toBe(offices[10].office_code);
    expect(p2.ids).toEqual(offices.slice(10, 20).map((o) => o.office_code));
    expect(p2.text).toMatch(/^\| 11\. Network Contract Office 10 \(36C210\) \|/m);
    expect(p2.text).toMatch(/Showing 11–20 of the 47 offices/);
    expect(p2.text).toMatch(/Ask "show offices 21 to 30" for the next 10\./);
  });
  it('the last page says so and offers no further page', () => {
    const p5 = renderBuyingOffices(GA, { offset: 40 })!;
    expect(p5.text).toMatch(/Showing 41–47 of the 47 offices/);
    expect(p5.text).not.toMatch(/for the next 10/);
  });
  it('a short list shows everything and is exhaustive', () => {
    const small = renderBuyingOffices({ ...GA, offices: offices.slice(0, 3), totals: { obligated: 90_000_000, award_count: 60, office_count: 3 } })!;
    expect(small.text).toMatch(/Showing all 3 offices\./);
    expect(small.exhaustive).toBe(true);
    expect(small.text).not.toMatch(/next 10/);
  });
  it('prepareChatToolArgs strips display_offset for buying offices too', () => {
    const p = prepareChatToolArgs(BUYING_OFFICES_TOOL, JSON.stringify({ naics: '561720', state: 'GA', display_offset: 10 }));
    expect(p.displayOffset).toBe(10);
    expect(JSON.parse(p.args)).toEqual({ naics: '561720', state: 'GA' });
  });
});

describe('expiring contracts: presentation', () => {
  const rec = (i: number) => ({
    contract_id: `C${i}`, piid: `W912QR24C${String(i).padStart(4, '0')}`, incumbent_name: 'ACME JANITORIAL LLC',
    awarding_agency: 'Department of Defense', awarding_sub_agency: 'Department of the Army',
    place_of_performance_city: 'SAVANNAH', place_of_performance_state: 'GA',
    period_of_performance_current_end: `2027-01-${String((i % 28) + 1).padStart(2, '0')}`, total_obligation: 2_345_678 + i,
    description: 'JANITORIAL SERVICES AT FORT STEWART',
  });
  const res = { contracts: Array.from({ length: 25 }, (_, i) => rec(i)), _meta: { total: 25, result_state: 'ok', applied_filters: { naics: '561720', state: 'GA' }, window: { as_of: '2026-11-10' } } };
  const r = renderExpiringRecords(res)!;
  it('compact money, a table, top 10 by default with the honest count', () => {
    expect(r.text).not.toMatch(RAW_MONEY);
    expect(r.text).toMatch(/^\| Contract \| Obligated \| Ends \| Incumbent \| Agency \| Place \| Work \|$/m);
    expect(r.text.split('\n').filter((l) => /^\| \d+\. /.test(l)).length).toBe(10);
    expect(r.text).toMatch(/Showing 1–10 of 25, soonest end date first\./);
    expect(r.text).toMatch(/\$2\.35M/);
    expect(r.shown).toBe(10);
  });
  it('methodology before the table is short', () => {
    const lines = r.text.split('\n');
    const header = lines.findIndex((l) => l.startsWith('| Contract |'));
    expect(lines.slice(0, header).filter((l) => l.trim()).length).toBeLessThanOrEqual(3);
  });
});

describe('award list and vehicle mix: presentation', () => {
  it('award list: table, compact money', () => {
    const r = renderAwardList({ awards: [{ awardId: '70LGLY24C0001', recipientName: 'ACME LLC', description: 'JANITORIAL', startDate: '2024-01-01', endDate: '2027-01-01', awardAmount: 12_345_678, popState: 'GA' }], _meta: { total: 1, applied_filters: { naics: '561720' } } })!;
    expect(r.text).not.toMatch(RAW_MONEY);
    expect(r.text).toMatch(/^\| Award \| Lifetime value \| Recipient \| Period \| Place \| Work \|$/m);
    expect(r.text).toMatch(/^\| 1\. 70LGLY24C0001 \| \$12\.3M \| Acme LLC \| 2024-01-01 to 2027-01-01 \| GA \| JANITORIAL \|$/m);
  });
  it('vehicle mix: table, compact money', () => {
    const r = renderVehicleMix({ scope: { naics: ['561720'], window: 'FY2024-FY2026' }, total_obligated: 298_054_424, total_award_count: 198, buckets: [{ label: 'GSA Schedule', obligated: 120_000_000, share_pct: 40.3, award_count: 50 }, { label: 'Standalone contract', obligated: 178_054_424, share_pct: 59.7, award_count: 148 }], rollups: {}, classification: {}, _meta: {} })!;
    expect(r.text).not.toMatch(RAW_MONEY);
    expect(r.text).toMatch(/^\| Vehicle \| Obligations \| Share \| Awards \|$/m);
    expect(r.text).toMatch(/^\| GSA Schedule \| \$120\.0M \| 40\.3% \| 50 \|$/m);
  });
});
