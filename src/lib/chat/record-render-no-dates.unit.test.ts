import { describe, expect, it } from 'vitest';
import {
  renderAwardList, renderBuyingOffices, renderExpiringRecords, renderSbloContact, renderStatusChecks, renderVehicleMix,
  freshnessSentence, defenseLagSentence,
} from './record-render';

/**
 * Eric, 2026-11-27: "apply the no date rules everywhere". Rendered chat text never states how current Mindy's
 * data is or when a record was read/verified. Opportunity and contract dates (end dates, periods) stay, and a
 * staleness warning is still given, in words, without a date. The dates stay in the tool data (_meta).
 */
const DATA_DATE = /\bas of\b|retrieved \d|verified on|last (?:updated|loaded)|current through|data through|latest action loaded|re-verified since|after about \d/i;
const ISO = /\d{4}-\d{2}-\d{2}/;

const LAG_NOTE = 'USASpending data was last loaded 2026-11-13, but contract actions by DoD (including Navy, Army, Air Force) are published with a ~90-day delay, so the data is only reliably current through about 2026-08-15. The requested window (through 2026-11-14) is newer than that: awards made in it may not be published yet. Treat an empty or thin result as "not yet published", NOT as "no award was made".';

describe('no data dates: past-contract lag (freshnessSentence)', () => {
  it('states the delay in words, without the cutoff or load date', () => {
    const s = freshnessSentence({ lag_note: LAG_NOTE, as_of: '2026-11-13' });
    expect(s).not.toMatch(DATA_DATE);
    expect(s).not.toMatch(ISO);
    expect(s).toMatch(/about a 90-day delay, so awards from the last few months may not appear yet/);
    expect(s).toMatch(/check SAM\.gov award notices/);
  });

  it('an award list keeps every award end date and still warns the data may be incomplete', () => {
    const r = renderAwardList({
      awards: [{ awardId: 'N0018925P0001', recipientName: 'ACME LLC', awardAmount: 1000, startDate: '2025-10-01', endDate: '2027-03-31', description: 'janitorial' }],
      _meta: { total: 1, result_state: 'partial', as_of: '2026-11-13', lag_note: LAG_NOTE },
    })!;
    expect(r.text).toContain('2027-03-31'); // contract end date (an opportunity fact) stays
    expect(r.text).toMatch(/Data status: may be incomplete\./);
    expect(r.text).toMatch(/may not appear yet/);
    expect(r.text).not.toMatch(DATA_DATE);
    expect(r.text).not.toMatch(/2026-08-15|2026-11-13/);
  });

  it('an empty recent-window search is still NOT a verified zero, with the lag in words', () => {
    const r = renderStatusChecks({ awards: [], _meta: { result_state: 'partial', as_of: '2026-11-13', lag_note: LAG_NOTE } })!;
    expect(r.text).toMatch(/NOT a verified zero/);
    expect(r.text).toMatch(/may not appear yet/);
    expect(r.text).not.toMatch(DATA_DATE);
    expect(r.text).not.toMatch(/2026-08-15|2026-11-13/);
  });
});

describe('no data dates: warehouse totals (buying offices, vehicle mix)', () => {
  const dl = { applies: true, lag_days: 90, dod_complete_through: '2026-08-15', window_end: '2026-09-30', evidence: 'x', note: 'Defense (DoD, including Navy, Army and Air Force) contract actions are published with a ~90-day delay, so Defense dollars after about 2026-08-15 may not be in these totals yet; the window runs through 2026-09-30.' };

  it('defense lag is said without a date', () => {
    const s = defenseLagSentence({ defense_lag: dl })!;
    expect(s).toMatch(/about a 90-day delay, so the most recent Defense dollars may not be in these totals yet/);
    expect(s).not.toMatch(ISO);
    expect(s).not.toMatch(DATA_DATE);
    // A tool that gives only the note: the delay is read from it, the dates are not.
    const fromNote = defenseLagSentence({ defense_lag: { applies: true, note: dl.note } })!;
    expect(fromNote).toMatch(/about a 90-day delay/);
    expect(fromNote).not.toMatch(ISO);
    expect(defenseLagSentence({ defense_lag: { ...dl, applies: false } })).toBeNull();
  });

  it('buying offices: no "latest action loaded <date>", the lag warning remains', () => {
    const b = renderBuyingOffices({ scope: { naics: ['5613'] }, offices: [{ office_name: 'A', obligated: 10, share_pct: 100, award_count: 1 }], totals: { obligated: 10, award_count: 1, office_count: 1 }, notes: [], _meta: { as_of: '2026-09-30', defense_lag: dl, lag_note: 'prime contracts only; ingested weekly' } })!;
    expect(b.text).not.toMatch(DATA_DATE);
    expect(b.text).not.toMatch(/2026-09-30|2026-08-15/);
    expect(b.text).toMatch(/most recent actions may not appear yet/);
    expect(b.text).toMatch(/most recent Defense dollars may not be in these totals yet/);
  });

  it('vehicle mix: no data date, the lag warning remains, the FY window stays', () => {
    const v = renderVehicleMix({
      scope: { naics: ['541512'], window: 'FY2024–FY2026' }, total_obligated: 100, total_award_count: 2,
      buckets: [{ label: 'GSA Schedule', obligated: 100, share_pct: 100, award_count: 2 }], rollups: {}, classification: {},
      _meta: { as_of: '2026-09-30', defense_lag: dl, lag_note: 'as_of is the latest action date loaded.' },
    })!;
    expect(v.text).toContain('FY2024–FY2026');
    expect(v.text).not.toMatch(DATA_DATE);
    expect(v.text).not.toMatch(/2026-09-30|2026-08-15/);
    expect(v.text).toMatch(/may not appear yet/);
  });
});

describe('no data dates: expiring contracts', () => {
  it('drops the "as of" source date and keeps each contract end date', () => {
    const r = renderExpiringRecords({
      contracts: [{ contract_id: 'C1', piid: 'W912EQ25C0001', incumbent_name: 'ACME LLC', awarding_agency: 'Department of Defense', place_of_performance_state: 'TN', period_of_performance_current_end: '2027-03-31', total_obligation: 1000, description: 'janitorial' }],
      _meta: { grounded: true, degraded: false, result_state: 'results', ignored_args: [], total: 1, applied_filters: { naics: ['561720'], state: ['TN'], months_window: 18 }, window: { after: '2026-11-14', through: '2028-05-14', as_of: '2026-11-13', months: 18 } },
    })!;
    expect(r.text).toContain('2027-03-31');
    expect(r.text).not.toMatch(DATA_DATE);
    expect(r.text).not.toContain('2026-11-13');
  });
});

describe('no data dates: company contacts (get_sblo_contact)', () => {
  const base = { company: 'CACI INTERNATIONAL INC', sblo_name: 'Yadira Beltre', title: 'Small Business Liaison Officer', email: 'y@caci.com', source: 'company website' };
  it('registered SAM POCs carry no "as of" date', () => {
    const r = renderSbloContact({ contact: { company: 'X INC', sblo_name: null, uei: 'ABC' }, registered_points_of_contact: { label: 'registered SAM point of contact, not a designated small business liaison', as_of: '2026-08-15T17:41:45Z', contacts: [{ name: 'A B', title: 'President' }] }, _meta: {} })!;
    expect(r.text).toMatch(/1\. A B, President/);
    expect(r.text).not.toMatch(DATA_DATE);
    expect(r.text).not.toContain('2026-08-15');
  });
  it('a stale or unverified email still carries its warning, in words', () => {
    const stale = renderSbloContact({ contact: { ...base, verification: { email_kind: 'personal', email_status: 'stale', fields: { email: { verified_at: '2026-11-17' } } } }, _meta: {} })!;
    expect(stale.text).toMatch(/no longer shown on the company's page; confirm it before using it/);
    const unv = renderSbloContact({ contact: { ...base, verification: { email_kind: 'role', email_status: 'unverified', fields: { email: { verified_at: '2026-06' } } } }, _meta: {} })!;
    expect(unv.text).toMatch(/mailbox, not re-verified; confirm it before using it/);
    for (const t of [stale.text, unv.text]) {
      expect(t).not.toMatch(DATA_DATE);
      expect(t).not.toMatch(/2026-11-17|2026-06/);
    }
  });
});
