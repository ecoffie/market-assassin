import { describe, expect, it } from 'vitest';
import { annotateIgnoredParams, closestParam, describeUnrecognized, partitionToolArgs } from './unknown-params';

describe('closestParam', () => {
  it('suggests the key a wrong name contains or nearly spells', () => {
    expect(closestParam('company_name', ['company', 'uei', 'award_limit'])).toBe('company');
    expect(closestParam('solicitation', ['solicitation_number', 'notice_id'])).toBe('solicitation_number');
    expect(closestParam('nacis', ['naics', 'state'])).toBe('naics');
    expect(closestParam('UEI', ['company', 'uei'])).toBe('uei');
  });
  it('suggests nothing rather than something unrelated', () => {
    expect(closestParam('banana', ['company', 'uei', 'award_limit'])).toBeNull();
    expect(closestParam('', ['company'])).toBeNull();
    expect(closestParam('id', ['company'])).toBeNull();
  });
});

describe('partitionToolArgs', () => {
  it('gives the tool only declared keys and names the rest', () => {
    const r = partitionToolArgs({ company: 'A', company_name: 'B', banana: 1 }, ['company', 'uei']);
    expect(r.known).toEqual({ company: 'A' });
    expect(r.unrecognized).toEqual([
      { name: 'company_name', did_you_mean: 'company' },
      { name: 'banana', did_you_mean: null },
    ]);
  });
  it('a clean or absent argument object has nothing to report', () => {
    expect(partitionToolArgs({ company: 'A' }, ['company'])).toEqual({ known: { company: 'A' }, unrecognized: [] });
    expect(partitionToolArgs(undefined, ['company'])).toEqual({ known: {}, unrecognized: [] });
  });
});

it('describeUnrecognized reads as the correction the caller needs', () => {
  expect(describeUnrecognized([{ name: 'company_name', did_you_mean: 'company' }]))
    .toBe('Unrecognized parameter company_name. Did you mean company?');
  expect(describeUnrecognized([{ name: 'banana', did_you_mean: null }])).toBe('Unrecognized parameter banana.');
});

describe('annotateIgnoredParams', () => {
  it('returns the same object when nothing was ignored', () => {
    const result = { a: 1 };
    expect(annotateIgnoredParams(result, [])).toBe(result);
  });
  it('adds to _meta without mutating the result', () => {
    const result = { a: 1, _meta: { grounded: true } };
    const out = annotateIgnoredParams(result, [{ name: 'x', did_you_mean: null }]);
    expect(out._meta).toEqual({ grounded: true, ignored_parameters: [{ name: 'x', did_you_mean: null }] });
    expect(result._meta).toEqual({ grounded: true });
  });
});
