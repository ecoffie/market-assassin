import { describe, expect, it } from 'vitest';
import type { DeepDiveContext } from './compose';
import { investigateOpportunity, investigationNote, MIN_DAYS_TO_PURSUE, noticeToFitResult } from './investigate';
import type { FitProfile } from '@/lib/fit/fit-scorer';

// Synthetic fixtures only: no real company, person or customer document.
const NOW = Date.parse('2026-11-22T12:00:00Z');
const DAY = 86_400_000;
const iso = (days: number) => new Date(NOW + days * DAY).toISOString();

function dd(over: { notice?: Partial<DeepDiveContext['notice']>; incumbent?: DeepDiveContext['incumbent']; not_checked?: DeepDiveContext['not_checked'] } = {}): DeepDiveContext {
  const days = 20;
  return {
    notice: {
      state: 'found', title: 'Custodial services, federal building', identifiers: ['TEST26Q0001'], status: 'open', not_biddable: false,
      response_deadline: iso(days), days_to_deadline: days, latest_amendment: null, deadline_conflict: false,
      buyer: 'General Services Administration', naics: '561720', psc: 'S201',
      contact: { name: 'Pat Example', email: 'pat.example@example.gov', phone: null },
      ...over.notice,
    },
    incumbent: over.incumbent ?? { finding: 'identified', name: 'Example Incumbent Services LLC', award_id: 'TESTAWARD01', obligated: 2_400_000 },
    customer_brief_available: true,
    not_checked: over.not_checked ?? [],
  };
}

const COMPANY: FitProfile = {
  naicsCodes: ['561720', '561730'],
  certifications: [],
  states: ['GA'],
  pastPerformance: { buyerAgencies: ['General Services Administration'] },
};

const run = (deepDive: DeepDiveContext, profile: FitProfile | null = COMPANY, extras = { setAside: 'Total Small Business Set-Aside' } as Record<string, unknown>) =>
  investigateOpportunity({ deepDive, profile, extras, nowMs: NOW });

describe('investigateOpportunity: no notice, no recommendation', () => {
  it('not found → UNDETERMINED with a check-the-number next action, nothing invented', () => {
    const r = run(dd({ notice: { state: 'not_found' } as DeepDiveContext['notice'] }));
    expect(r.verdict).toBe('UNDETERMINED');
    expect(r.confidence).toBe('low');
    expect(r.fit).toBeNull();
    expect(r.next_action).toMatch(/solicitation number/);
    expect(r.risks).toEqual([]);
  });

  it('lookup failed → UNDETERMINED and says it is not a "no"', () => {
    const r = run(dd({ notice: { state: 'unavailable' } as DeepDiveContext['notice'] }));
    expect(r.verdict).toBe('UNDETERMINED');
    expect(r.reasons[0].text).toMatch(/not a "no"/);
    expect(r.reasons[0].source).toBe('lookup_solicitation');
  });

  it('ambiguous → UNDETERMINED and lists the matching identifiers', () => {
    const r = run(dd({ notice: { state: 'ambiguous', identifiers: ['A1', 'A2'] } as DeepDiveContext['notice'] }));
    expect(r.verdict).toBe('UNDETERMINED');
    expect(r.reasons[0].text).toContain('A1, A2');
    expect(r.next_action).toMatch(/which/);
  });
});

describe('investigateOpportunity: the four recommendations', () => {
  it('PURSUE: matching work, an agency they delivered for, small-business set-aside, time to respond', () => {
    const r = run(dd({ notice: { latest_amendment: 'Amendment 0002' } }));
    expect(r.verdict).toBe('PURSUE');
    expect(r.fit?.band).toBe('show');
    expect(r.reasons.every((x) => x.source === 'fit_scorer')).toBe(true);
    expect(r.reasons.map((x) => x.text).join(' ')).toMatch(/registered work codes/);
    expect(r.next_action).toContain('pat.example@example.gov');
    expect(r.next_action).toContain('Read Amendment 0002 first.');
    expect(r.risks.map((x) => x.text)).toContain('Incumbent: Example Incumbent Services LLC (award TESTAWARD01, $2.4M obligated).');
  });

  it(`WATCH, not PURSUE, with fewer than ${MIN_DAYS_TO_PURSUE} days left`, () => {
    const r = run(dd({ notice: { response_deadline: iso(2), days_to_deadline: 2 } }));
    expect(r.fit?.band).toBe('show');
    expect(r.verdict).toBe('WATCH');
    expect(r.reasons.map((x) => x.text)).toContain('Only 2 days left to respond.');
    expect(r.risks.map((x) => x.text).join(' ')).toMatch(/2 days left to respond/);
  });

  it('TEAM: a set-aside the company does not hold, but the work matches', () => {
    const r = run(dd(), COMPANY, { setAside: 'Women-Owned Small Business (WOSB) Program Set-Aside' });
    expect(r.fit?.route).toBe('subcontract');
    expect(r.verdict).toBe('TEAM');
    expect(r.reasons[0].text).toBe('You cannot prime it: set aside for WOSB, which you do not hold');
    expect(r.next_action).toMatch(/teaming partners/);
  });

  it('PASS: a set-aside the company does not hold and the work does not match', () => {
    const r = run(dd({ notice: { naics: '236220', title: 'Building construction' } }), COMPANY, { setAside: 'WOSB' });
    expect(r.verdict).toBe('PASS');
    expect(r.reasons.map((x) => x.text).join(' ')).toMatch(/not a close match/);
  });

  it('PASS: unrelated work, even when timing and a small-business set-aside lift it into the related band', () => {
    const r = run(dd({ notice: { naics: '236220', title: 'Building construction' } }), { ...COMPANY, pastPerformance: undefined });
    expect(r.fit?.factors.find((f) => f.id === 'capability')?.points).toBe(0);
    expect(r.fit?.band).toBe('related'); // the scorer alone would offer it as "show more"
    expect(r.verdict).toBe('PASS');
    expect(r.reasons[0].text).toBe('The work does not match what you do.');
  });

  it('PASS: the hidden band', () => {
    const r = run(dd({ notice: { naics: '236220', title: 'Building construction' } }), { ...COMPANY, pastPerformance: undefined }, {});
    expect(r.fit?.band).toBe('hidden');
    expect(r.verdict).toBe('PASS');
  });

  it('WATCH: a partial match (related band)', () => {
    // same industry group (15) + timing (15) + small-business set-aside (7), an agency they have not served (0): 37/70
    const r = run(dd({ notice: { naics: '561790', title: 'Pest control services', buyer: 'Department of Veterans Affairs' } }));
    expect(r.fit?.band).toBe('related');
    expect(r.fit?.evidenceNote).toBeUndefined();
    expect(r.verdict).toBe('WATCH');
  });
});

describe('investigateOpportunity: closed notices', () => {
  it('closed and a fit → WATCH for the follow-on', () => {
    const r = run(dd({ notice: { status: 'closed', not_biddable: true, response_deadline: iso(-5), days_to_deadline: -5 } }));
    expect(r.verdict).toBe('WATCH');
    expect(r.reasons[0]).toEqual({ text: 'Responses are closed (deadline passed 5 days ago).', source: 'lookup_solicitation' });
    expect(r.next_action).toMatch(/recompete/);
  });

  it('closed and company unknown → PASS on this notice (a fact, not a fit judgment)', () => {
    const r = run(dd({ notice: { status: 'archived', not_biddable: true } }), null);
    expect(r.verdict).toBe('PASS');
    expect(r.reasons[0].text).toMatch(/archived/);
  });
});

describe('investigateOpportunity: honesty when evidence is thin', () => {
  it('company unknown → UNDETERMINED; value first: the facts stay, the profile is offered, not required', () => {
    const r = run(dd(), null);
    expect(r.verdict).toBe('UNDETERMINED');
    expect(r.fit).toBeNull();
    expect(r.missing_evidence).toContain('company profile: who the company is and what it does is unknown');
    expect(r.risks.map((x) => x.text).join(' ')).toMatch(/Example Incumbent Services/);
    expect(r.next_action).toMatch(/company profile/);
    expect(r.next_action).toMatch(/stand on their own/);
  });

  it('profile with nothing the scorer can use → UNDETERMINED, never a made-up score', () => {
    const r = run(dd({ notice: { naics: null, psc: null, title: null, response_deadline: null, days_to_deadline: undefined, buyer: null } }), {}, {});
    expect(r.fit?.band).toBe('unscored');
    expect(r.verdict).toBe('UNDETERMINED');
  });

  it('a fit on thin evidence (work codes and timing only) is WATCH with low confidence and says what is missing', () => {
    const r = run(dd(), { naicsCodes: ['561720'] }, {});
    expect(r.fit?.evidenceNote).toBeTruthy();
    expect(r.verdict).toBe('WATCH');
    expect(r.confidence).toBe('low');
    expect(r.missing_evidence).toContain('set-aside not known, so eligibility was not checked');
    expect(r.missing_evidence.some((m) => m.startsWith('fit not checked for: past performance'))).toBe(true);
  });

  it('conflicting deadlines lower confidence, so a show-band fit is WATCH, not PURSUE', () => {
    const r = run(dd({ notice: { deadline_conflict: true } }));
    expect(r.fit?.band).toBe('show');
    expect(r.confidence).toBe('low');
    expect(r.verdict).toBe('WATCH');
    expect(r.risks.map((x) => x.text).join(' ')).toMatch(/deadlines disagree/);
  });

  it('an unidentified incumbent is never named; the tool sentence is carried as missing evidence', () => {
    const note = 'A candidate award was found but not confirmed as this solicitation’s predecessor.';
    const r = run(dd({ incumbent: { finding: 'candidate_not_confirmed', absence_note: note } }));
    expect(r.risks.some((x) => x.source === 'get_solicitation_incumbent')).toBe(false);
    expect(r.missing_evidence).toContain(`incumbent: ${note}`);
    expect(r.confidence).not.toBe('high');
  });

  it('steps that did not run are listed; the deferred bid_decision step is not', () => {
    const r = run(dd({ not_checked: [
      { step: 'documents', state: 'unavailable', reason: 'timeout' },
      { step: 'bid_decision', state: 'skipped', reason: 'left to the answer turn' },
    ] }));
    expect(r.missing_evidence).toContain('documents not checked (unavailable: timeout)');
    expect(r.missing_evidence.join(' ')).not.toMatch(/bid decision/);
    expect(r.confidence).toBe('medium');
    expect(r.verdict).toBe('PURSUE');
  });
});

describe('noticeToFitResult', () => {
  it('carries only known fields and labels the deadline', () => {
    expect(noticeToFitResult({ state: 'found', naics: '561720', response_deadline: '2026-12-01', title: null, psc: null, buyer: null })).toEqual({
      kind: 'open', naics: '561720', date: '2026-12-01', dateKind: 'response_deadline',
    });
  });
});

describe('investigationNote', () => {
  it('states the recommendation, sources each line, and never prints a score', () => {
    const r = run(dd());
    const note = investigationNote(r);
    expect(note).toMatch(/^INVESTIGATION/);
    expect(note).toContain('Recommendation: PURSUE · confidence');
    expect(note).toContain('[fit_scorer]');
    expect(note).toContain('[get_solicitation_incumbent]');
    expect(note).not.toContain(String(r.fit?.score));
    expect(note).toMatch(/never print a score/);
  });

  it('UNDETERMINED tells the model not to pick one of the four', () => {
    const note = investigationNote(run(dd(), null));
    expect(note).toContain('NOT ENOUGH EVIDENCE TO RECOMMEND');
    expect(note).toContain('Missing evidence (unknown, not zero');
  });
});
