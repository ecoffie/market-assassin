import { describe, it, expect } from 'vitest';
import {
  groupOf,
  reasonsFor,
  savedBecause,
  toO,
  isForecast,
  daysLeft,
  deadlineMoved,
  type SavedRow,
} from './favorites-grouping';

// Fixed "now" so day-diff math is deterministic. All test deadlines are computed off this.
const NOW = new Date('2026-08-05T09:00:00');
function iso(daysFromNow: number): string {
  const d = new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() + daysFromNow, 12, 0, 0);
  return d.toISOString().slice(0, 10);
}

function row(overrides: Partial<SavedRow>): SavedRow {
  return { notice_id: 'n1', ...overrides };
}

describe('favorites inbox — grouping / priority (one group per row)', () => {
  it('closing in 2 days -> Needs Attention (attn)', () => {
    expect(groupOf(row({ response_deadline: iso(2) }), NOW)).toBe('attn');
  });

  it('closing today (0 days) -> Needs Attention', () => {
    expect(groupOf(row({ response_deadline: iso(0) }), NOW)).toBe('attn');
  });

  it('closing in exactly 3 days -> Needs Attention (<=3 boundary)', () => {
    expect(groupOf(row({ response_deadline: iso(3) }), NOW)).toBe('attn');
  });

  it('closing in 5 days -> Closing Soon (soon)', () => {
    expect(groupOf(row({ response_deadline: iso(5) }), NOW)).toBe('soon');
  });

  it('closing in 7 days -> Closing Soon (upper boundary)', () => {
    expect(groupOf(row({ response_deadline: iso(7) }), NOW)).toBe('soon');
  });

  it('closing in 20 days -> Watching (watch)', () => {
    expect(groupOf(row({ response_deadline: iso(20) }), NOW)).toBe('watch');
  });

  it('undated active row -> Watching', () => {
    expect(groupOf(row({ response_deadline: null }), NOW)).toBe('watch');
  });

  it('already-expired open row -> Closed (never silently dropped)', () => {
    expect(groupOf(row({ response_deadline: iso(-4) }), NOW)).toBe('closed');
  });

  it('deadline MOVED since save (live != snapshot) -> Needs Attention even if far out', () => {
    const r = row({ response_deadline: iso(20), saved_response_deadline: iso(30) });
    expect(deadlineMoved(r)).toBe(true);
    expect(groupOf(r, NOW)).toBe('attn');
  });

  it('deadline unchanged (live == snapshot) -> NOT a delta', () => {
    const r = row({ response_deadline: iso(20), saved_response_deadline: iso(20) });
    expect(deadlineMoved(r)).toBe(false);
    expect(groupOf(r, NOW)).toBe('watch');
  });

  it('priority: a closing-2d row that ALSO moved still lands in exactly one group (attn), not two', () => {
    const r = row({ response_deadline: iso(2), saved_response_deadline: iso(9) });
    const g = groupOf(r, NOW);
    expect(g).toBe('attn');
    // exactly-one: it is attn, and NOT any of the others.
    (['soon', 'watch', 'closed'] as const).forEach((k) => expect(g).not.toBe(k));
  });
});

describe('favorites inbox — forecast handling', () => {
  const foreRow = row({
    response_deadline: iso(-10), // even with a "past" date, a forecast is not "closed"
    opportunity_dna_keys: ['forecast'],
    opportunity_dna: [{ key: 'forecast', label: 'Forecast', tone: 'neutral', tier: 1 }],
  });

  it('a row with a forecast genome key -> isForecast true', () => {
    expect(isForecast(foreRow)).toBe(true);
  });

  it('forecast rows are Watching (never Closed) and toO marks src=FORECAST -> the Forecasts filter', () => {
    expect(groupOf(foreRow, NOW)).toBe('watch');
    expect(toO(foreRow).src).toBe('FORECAST');
  });

  it('a non-forecast SAM row -> src=SAM', () => {
    expect(toO(row({ response_deadline: iso(5) })).src).toBe('SAM');
  });
});

describe('favorites inbox — Needs-Attention reasons (grounded, no fabrication)', () => {
  it('closing in 2 days yields a "Closes in 2 days" reason chip', () => {
    expect(reasonsFor(row({ response_deadline: iso(2) }), NOW)).toContain('Closes in 2 days');
  });

  it('closing today -> "Closes today"', () => {
    expect(reasonsFor(row({ response_deadline: iso(0) }), NOW)).toContain('Closes today');
  });

  it('a moved deadline yields a "Deadline moved" reason', () => {
    const r = row({ response_deadline: iso(2), saved_response_deadline: iso(9) });
    expect(reasonsFor(r, NOW)).toEqual(expect.arrayContaining(['Closes in 2 days', 'Deadline moved']));
  });

  it('a far-out, unmoved row has NO reasons (no fabricated dots)', () => {
    expect(reasonsFor(row({ response_deadline: iso(30) }), NOW)).toEqual([]);
  });
});

describe('favorites inbox — "Saved because <strand>" (omitted when no strands)', () => {
  it('a row with strands -> the top strand label, ordered by dnaOrder (repeat_buyer beats set_aside)', () => {
    const r = row({
      opportunity_dna: [
        { key: 'set_aside', label: 'HUBZone Set-Aside', tone: 'good', tier: 1 },
        { key: 'repeat_buyer', label: 'Repeat Buyer', tone: 'good', tier: 1 },
      ],
    });
    expect(savedBecause(r)).toBe('Repeat Buyer');
  });

  it('a row with NO strands -> empty string (the line is OMITTED, never "Saved because · —")', () => {
    expect(savedBecause(row({ opportunity_dna: null }))).toBe('');
    expect(savedBecause(row({ opportunity_dna: [] }))).toBe('');
  });
});

describe('favorites inbox — saved-row -> card `o` mapping', () => {
  it('maps every field the Decision Card reads (title, agency, subAgency, naics, set, close, value range, dna)', () => {
    const r = row({
      notice_id: 'abc123',
      title: 'REGION 3 JOC 5 YEAR',
      agency: 'DEPT OF THE ARMY',
      sub_tier: 'Army',
      naics_code: '236220',
      set_aside_description: 'Total Small Business Set-Aside (FAR 19.5)',
      response_deadline: iso(4) + 'T17:00:00Z',
      notice_type: 'Combined Synopsis/Solicitation',
      solicitation_number: 'W911SA26RA026',
      pop_state: 'TX',
      intel_value_range: { low: 1_000_000, median: 2_500_000, high: 4_000_000, label: '62 comparable 236220 contracts' },
      opportunity_dna: [{ key: 'repeat_buyer', label: 'Repeat Buyer', tone: 'good', tier: 1 }],
    });
    const o = toO(r);
    expect(o.nid).toBe('abc123');
    expect(o.subAgency).toBe('Army');
    expect(o.naics).toBe('236220');
    expect(o.set).toBe('Total Small Business Set-Aside'); // FAR citation trimmed
    expect(o.close).toBe(iso(4)); // sliced to YYYY-MM-DD
    expect(o.loc).toBe('TX');
    expect(o.est).toBe(2_500_000);
    expect(o.estLow).toBe(1_000_000);
    expect(o.estHigh).toBe(4_000_000);
    expect(o.estN).toBe(62); // parsed comparable count from the label
    expect(o.dna).toHaveLength(1);
  });

  it('NAICS coercion: an array or object never becomes "[object Object]"', () => {
    expect(toO(row({ naics_code: ['337121'] })).naics).toBe('337121');
    expect(toO(row({ naics_code: { code: '541512' } as unknown })).naics).toBe('541512');
    expect(toO(row({ naics_code: null })).naics).toBe('');
  });

  it('value estimate absent -> est 0 (card shows "Estimate Pending", never a fabricated number)', () => {
    expect(toO(row({ intel_value_range: null })).est).toBe(0);
    expect(toO(row({ intel_value_range: null })).estN).toBe(0);
  });
});

describe('favorites inbox — daysLeft is null-safe + noon-anchored', () => {
  it('undated -> null (not 0)', () => {
    expect(daysLeft(row({ response_deadline: null }), NOW)).toBeNull();
  });
  it('a full-ISO timestamp is sliced to the date and yields a clean integer', () => {
    expect(daysLeft(row({ response_deadline: iso(6) + 'T23:59:00Z' }), NOW)).toBe(6);
  });
});
