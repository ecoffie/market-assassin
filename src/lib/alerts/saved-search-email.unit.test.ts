/**
 * Guards the saved-search alert email (the live-card format). Asserts the pieces that carry meaning
 * or could mislead: set-aside mapping (never invent one), notice-type display, the ≤7-day urgency
 * pill, Due being date-ONLY (days-left lives only in the pill — no redundancy), posted-ago, agency
 * title-casing, and that every opportunity renders a card with its labeled fields + a link.
 */
import { describe, it, expect } from 'vitest';
import { buildEmail, agencyCase, SET_ASIDE_CHIP, noticeTypeLabel, postedAgo } from './saved-search-email';

const soon = (days: number) => new Date(Date.now() + days * 86400000).toISOString();

describe('agencyCase', () => {
  it('title-cases a raw uppercase SAM agency, keeping of/and/the lowercase', () => {
    expect(agencyCase('DEPT OF DEFENSE')).toBe('Dept of Defense');
    expect(agencyCase('VETERANS AFFAIRS, DEPARTMENT OF')).toBe('Veterans Affairs, Department of');
  });
});

describe('SET_ASIDE_CHIP', () => {
  it('maps real SAM codes to short labels', () => {
    expect(SET_ASIDE_CHIP['8A']).toBe('8(a)');
    expect(SET_ASIDE_CHIP.SDVOSBC).toBe('SDVOSB');
    expect(SET_ASIDE_CHIP.WOSB).toBe('WOSB');
  });
});

describe('noticeTypeLabel', () => {
  it('displays the stored full label as-is (notice_type is NOT a code)', () => {
    expect(noticeTypeLabel('Solicitation')).toBe('Solicitation');
    expect(noticeTypeLabel('Sources Sought')).toBe('Sources Sought');
  });
  it('shortens the one long value to fit the chip', () => {
    expect(noticeTypeLabel('Combined Synopsis/Solicitation')).toBe('Combined Synopsis/Sol.');
  });
  it('empty → "" (no chip, never invented)', () => {
    expect(noticeTypeLabel('')).toBe('');
    expect(noticeTypeLabel(null)).toBe('');
  });
});

describe('postedAgo', () => {
  it('renders a relative posted string', () => {
    expect(postedAgo(soon(-1))).toBe('Posted 1 day ago');
    expect(postedAgo(soon(-3))).toBe('Posted 3 days ago');
    expect(postedAgo(soon(0))).toBe('Posted today');
  });
});

describe('buildEmail', () => {
  const opp = (over: Record<string, unknown> = {}) => ({
    title: 'Test Opportunity', department: 'DEPT OF DEFENSE', pop_state: 'FL', pop_city: 'jacksonville',
    naics_code: '541519', set_aside_code: '', notice_type: 'Solicitation', posted_date: soon(-2),
    response_deadline: soon(10), solicitation_number: 'ABC123', ui_link: 'https://getmindy.ai/opportunity-map', ...over,
  });

  it('subject counts the matches', () => {
    expect(buildEmail({ name: 'Cyber' }, [opp(), opp()]).subject).toBe('2 new matches for “Cyber”');
    expect(buildEmail({ name: 'Cyber' }, [opp()]).subject).toBe('1 new match for “Cyber”');
  });

  it('renders each opportunity as a card with the labeled fields, chips + a link', () => {
    const { html } = buildEmail({ name: 'Cyber' }, [opp({ set_aside_code: '8A', notice_type: 'Presolicitation' })]);
    expect(html).toContain('Test Opportunity');
    expect(html).toContain('Set-aside');
    expect(html).toContain('NAICS');
    expect(html).toContain('541519');
    expect(html).toContain('8(a)');                       // set-aside value from the code
    expect(html).toContain('Presolicitation');            // notice-type chip
    expect(html).toContain('Posted 2 days ago');          // posted chip
    expect(html).toContain('View details');
    expect(html).toContain('https://getmindy.ai/opportunity-map');
  });

  it('a ≤7-day deadline shows the red "N days left" pill; Due is date-ONLY (no redundant countdown)', () => {
    const urgent = buildEmail({ name: 'x' }, [opp({ response_deadline: soon(2) })]).html;
    expect(urgent).toContain('#e0322f');                  // live red used (pill + Due)
    expect(urgent).toContain('2 days left');              // countdown ONLY in the pill
    expect(urgent).not.toMatch(/· 2d/);                   // NOT appended to the Due value
    const calm = buildEmail({ name: 'x' }, [opp({ response_deadline: soon(20) })]).html;
    expect(calm).not.toMatch(/days left/);                // no pill when not urgent
  });

  it('no set_aside_code → "Full & open", never a fabricated set-aside', () => {
    const { html } = buildEmail({ name: 'x' }, [opp({ set_aside_code: '' })]);
    expect(html).toContain('Full &amp; open');
  });

  it('caps the card list at 25 and notes the remainder', () => {
    const { html } = buildEmail({ name: 'x' }, Array.from({ length: 30 }, () => opp()));
    expect(html).toContain('+ 5 more');
  });

  it('text fallback lists each opp with agency/naics/set-aside/notice/due', () => {
    const { text } = buildEmail({ name: 'x' }, [opp({ set_aside_code: '8A', notice_type: 'Sources Sought' })]);
    expect(text).toContain('• Test Opportunity');
    expect(text).toContain('Dept of Defense');
    expect(text).toContain('NAICS 541519');
    expect(text).toContain('8(a)');
    expect(text).toContain('Sources Sought');
  });
});
