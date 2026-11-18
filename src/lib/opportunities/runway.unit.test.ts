import { describe, expect, it } from 'vitest';
import { runwayLabel } from './runway';
import { deriveSolicitationStatus } from '@/lib/sam/resolve-solicitation';

const NOW = new Date('2026-11-18T12:00:00Z');

describe('runwayLabel — a missing deadline is not automatically open', () => {
  it('an award or justification with no deadline is not labelled open', () => {
    expect(runwayLabel(null, NOW, 'Award Notice')).toBe('Not open for responses — no deadline');
    expect(runwayLabel(null, NOW, 'Justification')).toBe('Not open for responses — no deadline');
  });

  it('a sources-sought notice with no deadline keeps the respondable badge', () => {
    expect(runwayLabel(null, NOW, 'Sources Sought')).toBe('🟢 Open — no deadline');
  });

  it('a past deadline stays closed even when the caller passes no notice type', () => {
    expect(runwayLabel('2026-01-01T00:00:00Z', NOW)).toBe('⛔ Closed');
  });
});

describe('#1557 solicitation status is unchanged', () => {
  it('active=true and no deadline is still open', () => {
    expect(deriveSolicitationStatus({
      active: true,
      response_deadline: null,
      archive_date: null,
    }, NOW)).toBe('open');
  });

  it('active=true and a past deadline is closed', () => {
    expect(deriveSolicitationStatus({
      active: true,
      response_deadline: '2026-01-01T00:00:00Z',
      archive_date: null,
    }, NOW)).toBe('closed');
  });
});
