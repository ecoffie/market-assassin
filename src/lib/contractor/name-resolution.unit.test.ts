import { describe, it, expect } from 'vitest';
import { classifyNameHits, type AwardNameCandidate } from './name-resolution';

const TANAQ: AwardNameCandidate[] = [
  { name: 'TANAQ SUPPORT SERVICES, LLC', uei: 'UM53UXL5QNF5', total_obligated: 261_903_825.7, award_count: 54 },
  { name: 'TANAQ MANAGEMENT SERVICES LLC', uei: 'WJ21VL51LDV4', total_obligated: 136_848_342.61, award_count: 20 },
  { name: 'TANAQ GOVERNMENT SERVICES LLC', uei: 'TGV000000001', total_obligated: 95_200_000, award_count: 154 },
];

describe('classifyNameHits', () => {
  it('does not pick the first or largest of a family', () => {
    const r = classifyNameHits('Tanaq', TANAQ, 13);
    expect(r.status).toBe('ambiguous');
    if (r.status !== 'ambiguous') return;
    expect(r.match_count).toBe(13);
    expect(r.candidates[0].uei).toBe('UM53UXL5QNF5');
    expect(r.note).toMatch(/will not pick one/);
    expect(r.note).not.toMatch(/couldn't find/i);
  });

  it('a sole hit is unique without being a guess among many', () => {
    const r = classifyNameHits('Leidos', [TANAQ[0]], 1);
    expect(r.status).toBe('unique');
    if (r.status !== 'unique') return;
    expect(r.match).toBe('sole_hit');
    expect(r.uei).toBe('UM53UXL5QNF5');
  });

  it('one exact legal stem among longer names is that entity, not the largest', () => {
    const smaller = { name: 'TANAQ SUPPORT SERVICES, LLC', uei: 'UM53UXL5QNF5', total_obligated: 1, award_count: 54 };
    const larger = { name: 'TANAQ SUPPORT SERVICES GLOBAL LLC', uei: 'OTHER', total_obligated: 9_000_000, award_count: 80 };
    const r = classifyNameHits('Tanaq Support Services', [larger, smaller], 2);
    expect(r.status).toBe('unique');
    if (r.status !== 'unique') return;
    expect(r.uei).toBe('UM53UXL5QNF5');
    expect(r.match).toBe('exact_stem');
  });

  it('two exact stems stay ambiguous', () => {
    const a = { name: 'TANAQ SUPPORT SERVICES, LLC', uei: 'A', total_obligated: 1, award_count: 1 };
    const b = { name: 'TANAQ SUPPORT SERVICES LLC', uei: 'B', total_obligated: 2, award_count: 1 };
    const r = classifyNameHits('Tanaq Support Services', [a, b], 2);
    expect(r.status).toBe('ambiguous');
  });

  it('a truncated list is not uniquely resolved by a visible exact stem', () => {
    const r = classifyNameHits('Tanaq Support Services', [TANAQ[0]], 4);
    expect(r.status).toBe('ambiguous');
    if (r.status !== 'ambiguous') return;
    expect(r.truncated).toBe(true);
    expect(r.match_count).toBe(4);
  });

  it('zero rows are none in this dataset, not a missing-contractor sentence', () => {
    const r = classifyNameHits('Tanaq Global Solutions LLC', [], 0);
    expect(r.status).toBe('none');
  });
});
