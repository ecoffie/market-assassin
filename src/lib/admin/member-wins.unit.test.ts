import { describe, expect, it } from 'vitest';
import { memberUeis, sinceJoining, tallyWins } from './member-wins';

describe('member contract wins', () => {
  it('keeps only valid UEIs and uses the earliest join date', () => {
    const { joined, withUei } = memberUeis(
      [
        { user_email: 'a@x.com', uei: ' abcdefghijk1 ', created_at: '2026-05-01T00:00:00Z' },
        { user_email: 'b@x.com', uei: 'ABCDEFGHIJK1', created_at: '2026-03-01T00:00:00Z' },
        { user_email: 'c@x.com', uei: 'short', created_at: '2026-01-01T00:00:00Z' },
        { user_email: 'd@x.com', uei: null, created_at: null },
      ],
      [{ user_email: 'A@x.com', created_at: '2026-02-01T00:00:00Z' }],
    );
    expect(withUei).toBe(2);
    expect([...joined.keys()]).toEqual(['ABCDEFGHIJK1']);
    expect(joined.get('ABCDEFGHIJK1')).toBe(Date.parse('2026-02-01T00:00:00Z'));
  });

  it('counts distinct positive awards and splits lifetime from since-joining', () => {
    const rows = [
      { recipient_uei: 'U1', award_id: 'A1', first_action: '2025-01-01', amount: 1000 },
      { recipient_uei: 'U1', award_id: 'A2', first_action: '2026-06-01', amount: 500 },
      { recipient_uei: 'U2', award_id: 'A3', first_action: '2026-07-01', amount: -50 },
    ];
    expect(tallyWins(rows)).toEqual({ companiesWithWins: 1, contracts: 2, dollars: 1500 });
    const joined = new Map([['U1', Date.parse('2026-01-01')], ['U2', NaN]]);
    expect(tallyWins(sinceJoining(rows, joined))).toEqual({ companiesWithWins: 1, contracts: 1, dollars: 500 });
  });
});
