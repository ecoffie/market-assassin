/**
 * N-1 (2026-09-27): an agency acronym never becomes a place. "VA medical centers" is the
 * Department of Veterans Affairs, not Virginia. A state code counts only inside an explicit
 * place phrase (address, list of codes, "based in"); full state names are unchanged.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/llm/call-llm', () => ({ callLLM: vi.fn() }));
vi.mock('@/lib/market/semantic-keywords', () => ({ deriveSemanticKeywords: vi.fn() }));
vi.mock('@/lib/market/keyword-coverage', () => ({ queryKeywordCoverage: vi.fn(), deriveCoverageKeywords: vi.fn() }));

import { detectStates } from './profile-from-text';

const s = (t: string) => detectStates(t).sort();

describe('agency acronyms and ordinary words are not places', () => {
  it.each([
    'We provide janitorial services to VA medical centers.',
    'Prime contractor to the VA and DoD for IT modernization.',
    'Department of Veterans Affairs, VA and DoD past performance.',
    'VA Medical Center support, 24/7 IN-house staffing.',
    'Services available IN person OR remotely; OK for small jobs.',
    'Certified HVAC techs; we are OK with MA rates.',
    'Trusted by DLA, GSA, VA, and USACE.',
  ])('%s → no state', (text) => {
    expect(s(text)).toEqual([]);
  });
});

describe('explicit place phrases still resolve', () => {
  it.each([
    ['Headquartered in Norfolk, VA 23511.', ['VA']],
    ['Offices in Norfolk, VA and San Diego, CA.', ['CA', 'VA']],
    ['Serving the DMV: DC, MD, VA.', ['DC', 'MD', 'VA']],
    ['We cover DC/MD/VA.', ['DC', 'MD', 'VA']],
    ['We are based in TX.', ['TX']],
    ['Janitorial for VA medical centers across Virginia.', ['VA']],
    ['Construction in Florida.', ['FL']],
    ['Tampa, FL', ['FL']],
    ['construction Caribbean', ['PR', 'VI']],
  ])('%s → %j', (text, want) => {
    expect(s(text)).toEqual(want);
  });
});
