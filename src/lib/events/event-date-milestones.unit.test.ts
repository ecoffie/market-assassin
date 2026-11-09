/**
 * Event dates are not acquisition milestones (2026-11-09). Fixtures are excerpts of real SAM notice
 * text read from sam_opportunities on 2026-11-09.
 */
import { describe, expect, it } from 'vitest';
import { classifyEvent, extractEventDate, findEventDates } from './classify';

const NOV_9 = new Date('2026-11-09T12:00:00Z');
const SEP_1 = new Date('2026-09-01T12:00:00Z');

const dateOf = (title: string, body: string, today = NOV_9) => {
  const c = classifyEvent(title, body, today);
  return { type: c?.type ?? null, date: c ? extractEventDate(title, body, c, null, today) : null };
};

// NASA KSC SIMO, RFP 80KSC027R0001 (notice fff15eda…, 2026-11-02 version).
const SIMO_TITLE = 'Spaceport Infrastructure Maintenance and Operations (SIMO)';
const SIMO_SCHEDULE = [
  'For planning purposes, the Contracting Officer anticipates:',
  '',
  ' Draft solicitation release: September 14, 2026',
  '',
  ' Due date for comments to the draft solicitation: October 6, 2026',
  '',
  ' Presolicitation conference and site visit: October, 2026',
  '',
  ' Solicitation release: October 28, 2026',
  '',
  ' Proposal due date: November 30, 2026',
  '',
  ' Contract award: February 11, 2027',
  '',
  ' Contract phase-in (approx. 45 days): February 12, through March 29, 2027 ',
  '',
  ' Contract start: April 1, 2027',
  '',
  ' ',
  '',
  ' SECTION 6: INDUSTRY ENGAGEMENT',
  '',
  ' The SIMO requirements development team (RDT) intends to hold various industry engagement opportunities throughout the acquisition process. At this time, the SIMO RDT contemplates one-on-one meetings with industry following receipt of capability statements.',
].join('\n');
const SIMO_PLANNING = [
  ' For planning purposes, the Government anticipates:',
  '',
  'Due date for comments to the draft solicitation: October 06, 2026',
  '',
  'RFP release: On or about October 28, 2026 ',
  '',
  'Proposal due date: On or about December 7, 2026 ',
  '',
  'Contract award: On or about February 11, 2027',
  '',
  'Contract start: April 1, 2027',
  '',
  ' The Government anticipates hosting the following industry engagement opportunity:',
  '',
  'Presolicitation conference and on-site tour: October, 2026',
].join('\n');

// JPL "Pre-RFI Market Research" (HPSC, notice bde3413a…).
const JPL_TITLE = 'High-Performance Space Computing (HPSC) (Pre-RFI Market Research)';
const JPL_BODY = [
  ' Also, JPL will host 3 webinars on the dates listed below to address questions live. Contract Technical Managers, the Subcontracts Manager, and representatives from the JPL Small Business Programs Office may be in attendance. Webinar registration links are in the &ldquo;Attachments/Links&rdquo; section of the SAM.gov posting.',
  '',
  ' ',
  ' Tuesday, September 8, 2026, 1:00 PM - 2:00 PM PT',
  '',
  ' Wednesday, September 9, 2026, 11:00 AM -12:00 PM PT',
  '',
  ' Thursday, September 10, 2026, 11:00 AM -12:00 PM PT',
].join('\n');

describe('contract milestones are never event dates', () => {
  it('SIMO: contract award, phase-in and start dates are excluded', () => {
    const isos = findEventDates(SIMO_SCHEDULE, NOV_9).map((d) => d.iso);
    expect(isos).not.toContain('2027-02-11');
    expect(isos).not.toContain('2027-03-29');
    expect(isos).not.toContain('2027-04-01');
  });

  it('SIMO schedule + "SECTION 6: INDUSTRY ENGAGEMENT": no event date, not an industry day', () => {
    expect(dateOf(SIMO_TITLE, SIMO_SCHEDULE)).toEqual({ type: null, date: null });
  });

  it('SIMO planning list ("Contract start: April 1, 2027" then "industry engagement"): no event date', () => {
    const r = dateOf(SIMO_TITLE, SIMO_PLANNING);
    expect(r.date).toBeNull();
    expect(r.type).not.toBe('industry_day');
  });

  it('RFP release dates are excluded too', () => {
    expect(findEventDates('RFP release: On or about December 14, 2026', NOV_9)).toEqual([]);
    expect(findEventDates('Anticipated solicitation issuance: January 12, 2027', NOV_9)).toEqual([]);
  });

  it('a milestone in an earlier sentence does not hide a real event date', () => {
    const body = 'Contract award is anticipated on February 11, 2027. The Industry Day will be held on December 8, 2026 at the Kennedy Space Center.';
    expect(dateOf('SIMO Industry Day', body).date).toBe('2026-12-08');
  });
});

describe('a date before the event phrase counts only in the same paragraph', () => {
  it('Navy RCO Disruptor Day: date in the previous sentence of the same paragraph is kept', () => {
    const body = ' III. EVENT DETAILS \n\n The Disruptor Days event will occur starting the Week of November 30, 2026 (with a planned 2-week testing window) at NIWC Pacific in San Diego, CA . The event will take place in a specialized laboratory environment that allows vendors to brief their products in a traditional industry day format and execute live analytical evaluations.';
    expect(dateOf('Department of Navy Rapid Capabilities Office Disruptor Day: Multi-Sensor', body)).toEqual({ type: 'industry_day', date: '2026-11-30' });
  });

  it('bid opening and solicitation issuance are milestones, not the pre-bid conference date', () => {
    const boilers = 'Specifications and drawings, will be posted to SAM.gov (https://www.sam.gov) on or about September 25, 2026, with the bid opening on or about November 18, 2026. Details of the exact date and time of the pre-bid conference will be included in the solicitation.';
    expect(dateOf('Z1DA--Project 695-24-107 Replace Boilers 4 and 5', boilers).date).toBeNull();
    const range = 'The tentative date for issuing the solicitation is on-or-about 9 November 2026. The tentative date for the pre-bid conference will be listed in the SF 1442, typically 10 days after issuance of the solicitation.';
    expect(dateOf('Construct Small Arms Range - Presolicitation Notice', range).date).toBeNull();
  });

  it('same sentence: kept', () => {
    expect(dateOf('Notice', 'On December 8, 2026 the FAA will host an Industry Day for prospective offerors.')).toEqual({ type: 'industry_day', date: '2026-12-08' });
  });

  it('across a heading or line break: not the event date', () => {
    expect(dateOf('Notice', 'Proposal schedule: December 8, 2026\n\nINDUSTRY DAY\nDetails will follow.').date).toBeNull();
  });

  it('dates after the phrase are unchanged (VA Air Ambulance)', () => {
    const body = '4. Industry Day will be held virtually, on Microsoft Teams, on December 10 &ndash; 11, 2026.';
    expect(dateOf('V225--VA AIR AMBULANCE BROKER VIRTUAL INDUSTRY DAY NOTICE', body).date).toBe('2026-12-10');
  });
});

describe('explicit date lists referenced by the event phrase', () => {
  it('JPL: "webinars on the dates listed below" reads the first listed date', () => {
    expect(dateOf(JPL_TITLE, JPL_BODY, SEP_1)).toEqual({ type: 'webinar', date: '2026-09-08' });
  });

  it('list only (JPL text with "Webinar registration links" reworded): read from the list', () => {
    // Derived fixture: the real JPL text already passes because a second "Webinar" mention sits
    // within DATE_WINDOW of the first date. Rewording only that mention (same length) leaves the
    // dates ~330 characters from the phrase, so only the list cue can reach them.
    const listOnly = JPL_BODY.replace('Webinar registration links', 'Session registration links');
    expect(listOnly).not.toBe(JPL_BODY);
    expect(dateOf(JPL_TITLE, listOnly, SEP_1)).toEqual({ type: 'webinar', date: '2026-09-08' });
  });

  it('JPL after the webinars have passed: no event (past dates never qualify)', () => {
    expect(dateOf(JPL_TITLE, JPL_BODY, NOV_9).type).not.toBe('webinar');
  });

  it('a list cue does not reach past LIST_WINDOW or pick a deadline', () => {
    const body = `Industry day on the dates listed below.${' x'.repeat(700)}\nDecember 3, 2026`;
    expect(dateOf('Notice', body).date).toBeNull();
    expect(dateOf('Notice', 'Industry day on the dates listed below.\nResponses due December 1, 2026').date).toBeNull();
  });
});

// USCG "Doing Business with the United States Coast Guard" (notice 3a3e4c9b…), full text as stored.
const USCG_TITLE = 'Doing Business with the United States Coast Guard';
const USCG_BODY = "The U.S. Coast Guard (USCG) Office of Small Business and Industry Engagement Program is continuously seeking opportunities to promote and develop strategies for increasing the industrial base of our contracting program, while adhering to federal small business regulations in the procurement process.\n\n We invite you to join us at one of our quarterly virtual sessions. These educational webinars are designed to help attendees learn more about the USCG Mission, our Program Executive Offices, top agency spend, and how to effectively search the forecast for current and future procurement opportunities.\n\n Target Audience\n\n This event is intended for small businesses, large businesses, academic institutions, and traditional businesses that are unfamiliar with the USCG organization and the federal government marketplace.\n\n Upcoming Session Details\n\n \n Date: November 18, 2026\n\n Time: 1:00 p.m. &ndash; 2:00 p.m. Eastern Time (ET)\n\n Format: Virtual Webinar\n\n \n\n LIVE Form | RSVP Doing Business with the USCG - Educational Webinar (FY27/Q1) Registration\n\n Tentative Future Schedule\n\n Please mark your calendars for our upcoming quarterly sessions:\n\n Session\n\n Tentative Date\n\n Q2 FY27\n\n March 24, 2027\n\n Q3 FY27\n\n June 23, 2027\n\n Q4 FY27\n\n August 25, 2027\n\n Contact Information\n\n For additional information about the webinar series, please send an email to: openforbusiness@uscg.mil.";

describe('explicitly labeled session dates', () => {
  it('USCG: "Upcoming Session Details … Date: November 18, 2026" is the webinar date', () => {
    expect(dateOf(USCG_TITLE, USCG_BODY)).toEqual({ type: 'webinar', date: '2026-11-18' });
  });

  it('USCG after Nov 18: the past session never wins; a later scheduled session is used', () => {
    expect(dateOf(USCG_TITLE, USCG_BODY, new Date('2026-11-20T12:00:00Z')).date).toBe('2027-03-24');
  });

  it('a labeled response or award date is never the session date', () => {
    const body = 'Webinar Details\n\n Response Date: December 1, 2026\n\n Award Date: December 2, 2026\n\n The webinar will be held on December 9, 2026.';
    expect(dateOf('Industry Webinar', body).date).toBe('2026-12-09');
  });

  it('a session header alone does not make a labeled date an event of another type', () => {
    // USCG's own text: "Industry Engagement" is far from the labeled date, "Virtual Webinar" is near.
    expect(dateOf(USCG_TITLE, USCG_BODY).type).not.toBe('industry_day');
  });

  it('a bare "Date:" with no event phrase nearby is not chosen for its label', () => {
    const body = `Date: December 3, 2026\n\n${'Background on the requirement. '.repeat(15)}\n\nA webinar will follow on December 10, 2026.`;
    expect(dateOf('Notice', body).date).toBe('2026-12-10');
  });

  it('TSA amendment: a labeled date the notice says was replaced is never chosen', () => {
    // Real text, notice db864acb… (Amendment 1, posted 2026-10-27).
    const body = 'Amendment 1 to Special Notice \n\n This amendment updates the date for the Domestic Aviation Design Industry Day.\n\n The Domestic Aviation Design Industry Day will be held at 9:00 a.m. EDT on Wednesday, November 18, 2026 .\n\n ______________ \n\n Domestic Aviation Design Industry Day \n\n Important Dates: \n\n Industry Day Registration Deadline -- 3:00 PM EDT on Friday, November 13, 2026\n\n Industry Day -- 9:00 AM EDT on Tuesday, November 17, 2026 (Amendment 1 updated this date to November 18, 2026)\n\n 3. Event Description: \n\n Date : Tuesday, November 17, 2026 9:00 AM EDT (Amendment 1 updated this date to November 18, 2026)\n\n Location : Virtual (Microsoft Teams)';
    expect(dateOf('Domestic Aviation Design Industry Day', body)).toEqual({ type: 'industry_day', date: '2026-11-18' });
  });

  it('existing correct dates are unchanged (VA Air Ambulance, Navy RCO Disruptor Day)', () => {
    expect(dateOf('V225--VA AIR AMBULANCE BROKER VIRTUAL INDUSTRY DAY NOTICE', '4. Industry Day will be held virtually, on Microsoft Teams, on December 10 &ndash; 11, 2026.').date).toBe('2026-12-10');
  });
});
