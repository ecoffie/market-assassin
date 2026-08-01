/**
 * Guards the saved-search alert email (the Target-card format). Asserts the pieces that carry meaning
 * or could mislead: the set-aside chip mapping (never invent a set-aside), the ≤3-day urgency flag,
 * agency title-casing, and that every opportunity renders a card with its labeled fields + a link.
 */
import { describe, it, expect } from 'vitest';
import { buildEmail, agencyCase, SET_ASIDE_CHIP } from './saved-search-email';

const soon = (days: number) => new Date(Date.now() + days * 86400000).toISOString();

describe('agencyCase', () => {
  it('title-cases a raw uppercase SAM agency, keeping of/and/the lowercase', () => {
    expect(agencyCase('DEPT OF DEFENSE')).toBe('Dept of Defense');
    expect(agencyCase('VETERANS AFFAIRS, DEPARTMENT OF')).toBe('Veterans Affairs, Department of');
  });
});

describe('SET_ASIDE_CHIP', () => {
  it('maps real SAM codes to short chip labels', () => {
    expect(SET_ASIDE_CHIP['8A']).toBe('8(a)');
    expect(SET_ASIDE_CHIP.SDVOSBC).toBe('SDVOSB');
    expect(SET_ASIDE_CHIP.WOSB).toBe('WOSB');
  });
});

describe('buildEmail', () => {
  const opp = (over: Record<string, unknown> = {}) => ({
    title: 'Test Opportunity', department: 'DEPT OF DEFENSE', pop_state: 'FL', pop_city: 'jacksonville',
    naics_code: '541519', set_aside_code: '', response_deadline: soon(10), solicitation_number: 'ABC123',
    ui_link: 'https://getmindy.ai/opportunity-map', ...over,
  });

  it('subject counts the matches', () => {
    expect(buildEmail({ name: 'Cyber' }, [opp(), opp()]).subject).toBe('2 new matches for “Cyber”');
    expect(buildEmail({ name: 'Cyber' }, [opp()]).subject).toBe('1 new match for “Cyber”');
  });

  it('renders each opportunity as a card with the labeled fields + a link', () => {
    const { html } = buildEmail({ name: 'Cyber' }, [opp({ set_aside_code: '8A' })]);
    expect(html).toContain('Test Opportunity');
    expect(html).toContain('SET-ASIDE'.toLowerCase() === 'set-aside' ? 'Set-aside' : 'Set-aside'); // label present
    expect(html).toContain('NAICS');
    expect(html).toContain('541519');
    expect(html).toContain('8(a)');                       // chip rendered from the code
    expect(html).toContain('View details');
    expect(html).toContain('https://getmindy.ai/opportunity-map');
  });

  it('a ≤3-day deadline is flagged urgent (red) with a day countdown; a far one is not', () => {
    const urgent = buildEmail({ name: 'x' }, [opp({ response_deadline: soon(2) })]).html;
    expect(urgent).toContain('#dc2626');                  // red used somewhere (strip + DUE)
    expect(urgent).toMatch(/· 2d/);                       // countdown shown
    const calm = buildEmail({ name: 'x' }, [opp({ response_deadline: soon(20) })]).html;
    expect(calm).not.toMatch(/· \d+d/);                   // no countdown when not urgent
  });

  it('no set_aside_code → "Full & open", never a fabricated set-aside', () => {
    const { html } = buildEmail({ name: 'x' }, [opp({ set_aside_code: '' })]);
    expect(html).toContain('Full &amp; open');
  });

  it('caps the card list at 25 and notes the remainder', () => {
    const { html } = buildEmail({ name: 'x' }, Array.from({ length: 30 }, () => opp()));
    expect(html).toContain('+ 5 more');
  });

  it('text fallback lists each opp with agency/naics/set-aside/due', () => {
    const { text } = buildEmail({ name: 'x' }, [opp({ set_aside_code: '8A' })]);
    expect(text).toContain('• Test Opportunity');
    expect(text).toContain('Dept of Defense');
    expect(text).toContain('NAICS 541519');
    expect(text).toContain('8(a)');
  });
});
