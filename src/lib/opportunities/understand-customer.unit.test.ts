import { describe, it, expect } from 'vitest';
import {
  buildEmphasizeBullets,
  buildUnderstandNext,
  statedFocusFromText,
  UNDERSTAND_CAI_NEXT_PROMPT,
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
  it('returns suggestion-status bullets when agency research shares notice wording', () => {
    const bullets = buildEmphasizeBullets({
      opportunityText: 'cybersecurity continuous monitoring zero trust assessment',
      painPoints: [
        'Aging cybersecurity infrastructure and lack of continuous monitoring capability',
        'Unrelated facilities maintenance backlog across regional campuses',
      ],
      priorities: ['Expand zero trust architecture adoption across enterprise networks'],
    });
    expect(bullets.length).toBeGreaterThanOrEqual(1);
    expect(bullets.some((b) => /Suggest emphasizing|not a buyer fact/i.test(b))).toBe(true);
    expect(bullets.every((b) => !/actually cares|they are looking for/i.test(b))).toBe(true);
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

describe('buildUnderstandNext', () => {
  it('ends UNDERSTAND with CURRENT INTELLIGENCE ask — not set-aside-first', () => {
    const next = buildUnderstandNext();
    expect(next).toHaveLength(1);
    expect(next[0].prompt).toBe(UNDERSTAND_CAI_NEXT_PROMPT);
    expect(next[0].requires_confirmation).toBe(true);
    expect(next[0].tool).toBe('get_current_acquisition_intelligence');
    expect(next[0].prompt.toLowerCase()).not.toMatch(/set-aside|8\(a\)|sdvosb|hubzone|wosb/);
    expect(next[0].prompt.toLowerCase()).toMatch(/changed|buying/);
  });
});
