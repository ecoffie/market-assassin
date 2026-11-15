import { describe, it, expect } from 'vitest';
import { openLeadFrom, openSoonPenalty, OPEN_LEAD_DAYS, OPEN_SOON_DAYS, OPEN_SOON_PENALTY } from './open-relevance';

/** Lead-time window + soon demotion (Eric 2026-11-15: "people need at least 5 to 7 days minimum"; dev only). */
const NOW = new Date('2026-11-15T00:00:00Z');
const at = (days: number) => ({ response_deadline: new Date(NOW.getTime() + days * 86_400_000).toISOString() });
describe('deadline window', () => {
  it('the lead window starts 7 days out', () => {
    expect(OPEN_LEAD_DAYS).toBe(7);
    expect(openLeadFrom(NOW)).toBe('2026-11-22T00:00:00.000Z');
  });
  it('a bid closing in under 5 days is demoted half a tier; 5+ days is not; a missing deadline is not', () => {
    expect(OPEN_SOON_DAYS).toBe(5);
    expect(openSoonPenalty(at(1), NOW)).toBe(OPEN_SOON_PENALTY);
    expect(openSoonPenalty(at(4.9), NOW)).toBe(OPEN_SOON_PENALTY);
    expect(openSoonPenalty(at(5), NOW)).toBe(0);
    expect(openSoonPenalty(at(30), NOW)).toBe(0);
    expect(openSoonPenalty({ response_deadline: null }, NOW)).toBe(0);
  });
  it('demotion never drops a DIRECT bid below RELATED (tier 0 + 0.5 < tier 1)', () => {
    expect(0 + OPEN_SOON_PENALTY).toBeLessThan(1);
  });
});
