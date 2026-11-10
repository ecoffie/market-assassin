import { describe, expect, it } from 'vitest';
import { companyBreakdown, memberUeis, recentWinners, sinceJoining, tallyWins } from './member-wins';

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

  it('lists members with a NEW award in the window, biggest first', () => {
    const rows = [
      { recipient_uei: 'U1', award_id: 'A1', first_action: '2025-01-01', amount: 1000, recipient_name: 'One LLC', awarding_agency: 'VA' },
      { recipient_uei: 'U1', award_id: 'A2', first_action: '2026-06-01', amount: 500, recipient_name: 'One LLC', awarding_agency: 'VA' },
      { recipient_uei: 'U2', award_id: 'A3', first_action: '2026-08-01', amount: 900, recipient_name: 'Two Inc', awarding_agency: 'DOD' },
      { recipient_uei: 'U3', award_id: 'A4', first_action: '2026-09-01', amount: -10, recipient_name: 'Three', awarding_agency: 'GSA' },
    ];
    const r = recentWinners(rows, new Map([['U1', ['a@x.com']]]), 12, Date.parse('2026-11-10'));
    expect(r.since).toBe('2025-11-10');
    expect(r.members.map((m) => [m.uei, m.contracts, m.dollars])).toEqual([['U2', 1, 900], ['U1', 1, 500]]);
    expect(r.members[1].emails).toEqual(['a@x.com']);
    expect(r.contracts).toBe(2);
  });

  it('breaks wins down per company with lifetime, last 12 months and since joining', () => {
    const rows = [
      { recipient_uei: 'U1', award_id: 'A1', first_action: '2024-01-01', amount: 1000, recipient_name: 'One LLC', awarding_agency: 'VA' },
      { recipient_uei: 'U1', award_id: 'A2', first_action: '2026-06-01', amount: 500, recipient_name: 'One LLC', awarding_agency: 'DOD' },
      { recipient_uei: 'U2', award_id: 'A3', first_action: '2026-08-01', amount: 5000, recipient_name: 'Two Inc', awarding_agency: 'GSA' },
    ];
    const b = companyBreakdown(rows, new Map([['U1', ['a@x.com']]]), new Map([['U1', Date.parse('2026-01-01')], ['U2', NaN]]), Date.parse('2026-11-10'));
    expect(b.map((c) => c.uei)).toEqual(['U2', 'U1']);
    expect(b[1]).toMatchObject({
      company: 'One LLC', emails: ['a@x.com'], joined: '2026-01-01',
      lifetime: { contracts: 2, dollars: 1500 }, last12Months: { contracts: 1, dollars: 500 },
      sinceJoining: { contracts: 1, dollars: 500 }, latestAward: '2026-06-01', agencies: ['VA', 'DOD'],
    });
    expect(b[0].sinceJoining.contracts).toBe(0);
  });
});
