import { describe, it, expect } from 'vitest';
import { classifyEvent, extractEventDate, findEventDates } from './classify';

// Real SAM notices (excerpts of their own text), read 2026-11-09.
const TODAY = new Date('2026-11-09T12:00:00Z');

const AIR_AMBULANCE = {
  title: 'V225--VA AIR AMBULANCE BROKER   WITH SUPPORTING GROUND TRANSPORTATION     VIRTUAL INDUSTRY DAY NOTICE',
  description:
    'VA AIR AMBULANCE BROKER \n\n WITH SUPPORTING GROUND TRANSPORTATION \n\n VIRTUAL INDUSTRY DAY NOTICE \n\n December 10-11, 2026 \n\n Department of Veterans Affairs (VA) \n\n Veterans Transportation Program (VTP) \n\n Network Contracting Office (NCO) 20 \n\n 1. Purpose \n\n The Department of Veterans Affairs (VA), Veterans Transportation Program (VTP), will host an Industry Day to engage with air and ground transportation brokers.',
  responseDeadline: '2026-12-05T00:00:00+00:00',
};
const CHEMICAL_TOILETS = {
  title: 'Chemical Toilets',
  description: 'CHEMICAL TOILET SERVICES INDUSTRY DAY &ndash; NOVEMBER 17, 2026   The Regional Contracting Office (RCO), Marine Corps Installations West (MCI-West) will host an industry day.',
  responseDeadline: '2026-11-06T00:00:00+00:00',
};
const GWS = {
  title: 'GUN WEAPON SYSTEMS (GWS) Request for Information',
  description: 'See the attached Advance Notice/Sources Sought for additional information. NSWCDD will host an in-person Industry Day regarding the anticipated follow-on contract for Gun Weapon Systems (GWS), on 19 November 2026 at the University.',
  responseDeadline: '2026-11-30T00:00:00+00:00',
};
const FRAME = {
  title: 'Facility Readiness and Maintenance Execution (FRAME) Request for Proposal (RFP) - DRAFT',
  description: 'Industry is invited to review the quality of the draft Request for Proposal (dRFP), review requirements, the tentative acquisition schedule, and the upcoming Industry Day and Site Visit.   This notice is for planning purposes only and does not constitute an invitation for bids. Comments are due by February 1, 2027.',
  responseDeadline: '2027-02-01T00:00:00+00:00',
};
const PHARMA = { title: '6505--Department of Veterans Affairs Pharmaceutical Industry Day', description: null, responseDeadline: '2026-11-20T00:00:00+00:00' };
const C5ISRT = {
  title: 'C5ISRT NEXT GENERATION CYBERSECURITY AND INFORMATION ASSURANCE Presolicitation Conference',
  description: '***ONLY SEAPORT MAC HOLDERS SHOULD RESPOND TO THIS PRE SOLICITATION NOTICE*** PRE-SOLICITATION CONFERENCE AND SYNOPSIS ANNOUNCEMENT: This is a follow up to SOURCES SOUGHT ANNOUNCEMENT N6133126SNQ36.',
  responseDeadline: '2026-11-13T00:00:00+00:00',
};
const NOMEC = { title: 'NOMEC and NOPP Partnership Forum', description: 'Partnership Forum on Building U.S. Ocean Technology and Data Partnerships.', responseDeadline: '2026-12-01T00:00:00+00:00' };
const PLAIN_RFI = { title: 'S218--RFI New Snow & Ice Removal - CI', description: 'This is a Request for Information. Responses are due November 20, 2026.', responseDeadline: '2026-11-20T00:00:00+00:00' };

const run = (n: { title: string; description: string | null; responseDeadline: string }) => {
  const c = classifyEvent(n.title, n.description, TODAY);
  return { c, date: c ? extractEventDate(n.title, n.description, c, n.responseDeadline, TODAY) : null };
};

describe('event date is the event, never the response deadline', () => {
  it('VA Air Ambulance: the date range in its own text, not the Dec 5 deadline', () => {
    expect(run(AIR_AMBULANCE)).toEqual({ c: { type: 'industry_day', evidence: 'title' }, date: '2026-12-10' });
  });

  it('a titled industry day with no stated date is UNKNOWN (null), not its deadline', () => {
    expect(run(PHARMA)).toEqual({ c: { type: 'industry_day', evidence: 'title' }, date: null });
  });

  it('a deadline-cued date next to the phrase is not taken as the event date', () => {
    expect(findEventDates('Comments are due by February 1, 2027.', TODAY)).toEqual([]);
    expect(findEventDates('Industry Day on February 1, 2027.', TODAY).map((d) => d.iso)).toEqual(['2027-02-01']);
  });

  it('parses ranges and day-first forms; ignores past dates', () => {
    const iso = (s: string) => findEventDates(s, TODAY).map((d) => d.iso);
    expect(iso('December 10-11, 2026')).toEqual(['2026-12-10']);
    expect(iso('10-11 December 2026')).toEqual(['2026-12-10']);
    expect(iso('Dec. 3 through Dec 4, 2026')).toEqual(['2026-12-03']);
    expect(iso('19 November 2026')).toEqual(['2026-11-19']);
    expect(iso('11/19/2026')).toEqual(['2026-11-19']);
    expect(iso('October 1, 2026')).toEqual([]);
  });
});

describe('industry_day needs strong event evidence', () => {
  it('genuine events identified from a dated body mention are kept', () => {
    expect(run(CHEMICAL_TOILETS)).toEqual({ c: { type: 'industry_day', evidence: 'description_dated' }, date: '2026-11-17' });
    expect(run(GWS)).toEqual({ c: { type: 'industry_day', evidence: 'description_dated' }, date: '2026-11-19' });
  });

  it('an undated body mention ("upcoming Industry Day") does not make a draft RFP an event', () => {
    expect(classifyEvent(FRAME.title, FRAME.description, TODAY)?.type).not.toBe('industry_day');
  });

  it('a future industry day with no date yet ("2nd Quarter FY27", "at a later date") is not an event', () => {
    expect(classifyEvent('Next Generation Tactical Radio (NGTR)', 'Estimated Industry Day: 2nd Quarter FY27 Estimated Draft RFP Release: 3rd Quarter FY 27', TODAY)?.type).not.toBe('industry_day');
    expect(classifyEvent('Purchase of Potential Government Working Dogs (CONUS)', 'THERE WILL BE AN INDUSTRY DAY INVITE TO ALL NEW POTENTIAL BPA HOLDERS THAT SUBMIT THEIR CAPABILITIES STATEMENT TO THIS SOURCES SOUGHT. THE INVITE WILL BE SENT AT A LATER DATE.', TODAY)?.type).toBe('rfi');
  });

  it('conferences and forums named in the title are attendable, not RFIs', () => {
    expect(run(C5ISRT).c).toEqual({ type: 'industry_day', evidence: 'title' });
    expect(run(NOMEC).c).toEqual({ type: 'industry_day', evidence: 'title' });
  });

  it('RFIs stay notices; their date is the response deadline, shown as a notice', () => {
    expect(run(PLAIN_RFI)).toEqual({ c: { type: 'rfi', evidence: 'keyword' }, date: '2026-11-20' });
  });

  it('"rfi" must be a whole word', () => {
    expect(classifyEvent('Terrific widgets', 'A terrific purchase.', TODAY)).toBeNull();
    expect(classifyEvent('Full Food Service', 'supports the Warfighter with flexible service.', TODAY)).toBeNull();
    expect(classifyEvent('C1DA--Renovate Specialty Clinics', 'Responses to the RFIs are being prepared.', TODAY)?.type).toBe('rfi');
  });
});
