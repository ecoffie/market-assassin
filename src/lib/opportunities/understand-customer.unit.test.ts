import { describe, it, expect } from 'vitest';
import {
  buildEmphasizeBullets,
  statedFocusFromText,
} from './understand-customer';

describe('statedFocusFromText', () => {
  it('pulls distinctive tokens from a cybersecurity title', () => {
    const focus = statedFocusFromText(
      'Cybersecurity Assessment and Continuous Monitoring Support',
      null,
    );
    expect(focus).toContain('cybersecurity');
    expect(focus).toContain('monitoring');
    expect(focus.every((t) => t !== 'and' && t !== 'the')).toBe(true);
  });
});

describe('buildEmphasizeBullets', () => {
  it('returns overlap bullets when agency research shares notice wording', () => {
    const bullets = buildEmphasizeBullets({
      opportunityText: 'cybersecurity continuous monitoring zero trust assessment',
      painPoints: [
        'Aging cybersecurity infrastructure and lack of continuous monitoring capability',
        'Unrelated facilities maintenance backlog across regional campuses',
      ],
      priorities: ['Expand zero trust architecture adoption across enterprise networks'],
    });
    expect(bullets.length).toBeGreaterThanOrEqual(1);
    expect(bullets.some((b) => /cybersecurity|monitoring|zero/i.test(b))).toBe(true);
    expect(bullets.every((b) => !/facilities maintenance/i.test(b))).toBe(true);
  });

  it('returns empty when there is no wording overlap (honest miss)', () => {
    const bullets = buildEmphasizeBullets({
      opportunityText: 'janitorial floor waxing custodial services',
      painPoints: ['Cybersecurity workforce shortage'],
      priorities: ['Zero trust network modernization'],
    });
    expect(bullets).toEqual([]);
  });
});
