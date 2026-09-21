import { describe, expect, it } from 'vitest';
import {
  CONTEXT_TERMS,
  activitySegments,
  extractBusinessActivity,
  isContextWord,
  stripContext,
} from './activity';
import { matchTerm, scoreOpportunity, stripBuyerNames } from './relevance';
import type { SamSearchItem } from './types';

function item(over: Partial<SamSearchItem> = {}): SamSearchItem {
  return {
    title: 'Trash and Garbage Removal Services',
    agency: 'A',
    naics: '562998',
    set_aside: null,
    type: 'Solicitation',
    deadline: '2026-10-15T17:00:00Z',
    solicitation: 'S-1',
    link: 'https://sam.gov/workspace/contract/opp/00000000000000000000000000000001/view',
    ...over,
  };
}

describe('context vs activity', () => {
  it('treats headcount, the org and the act of contracting as context', () => {
    for (const w of ['person', 'people', 'company', 'business', 'government', 'contracts', 'help']) {
      expect(isContextWord(w), w).toBe(true);
    }
    // …and never the trade itself.
    for (const w of ['garbage', 'roofing', 'cater', 'guard', 'landscaping', 'staffing']) {
      expect(CONTEXT_TERMS.has(w), w).toBe(false);
    }
  });

  it('strips context out of a derived phrase instead of searching it', () => {
    expect(stripContext('person garbage')).toBe('garbage');
    expect(stripContext('government contracts')).toBe('');
  });

  it('never builds a phrase across a word it dropped', () => {
    // "commercial cleaning AND small construction" must not yield "cleaning small".
    expect(activitySegments('commercial cleaning and small construction jobs')).toEqual([
      ['commercial', 'cleaning'],
      ['small', 'construction'],
    ]);
    const a = extractBusinessActivity('I do commercial cleaning and small construction jobs');
    expect(a.terms).not.toContain('cleaning small');
  });

  it('falls back down the ladder rather than inventing a market', () => {
    expect(extractBusinessActivity('I help businesses').head).toBeNull();
    expect(extractBusinessActivity('I do stuff').confidence).toBe('none');
    // A broad word the user actually typed is still searchable — just low confidence.
    expect(extractBusinessActivity('staffing agency')).toMatchObject({
      head: 'staffing',
      confidence: 'low',
      rung: 'generic',
    });
  });
});

describe('word-boundary evidence', () => {
  it('person does not match personnel or personal (the screenshot bug)', () => {
    expect(matchTerm('RFI - DCSA Personnel Security Alert Management', 'person')).toBeNull();
    expect(matchTerm('FY26 NPTU Personal Alert Safety System (PASS)', 'person')).toBeNull();
    expect(matchTerm('IT MANAGER - PERSONAL SERVICES CONTRACTORS', 'person')).toBeNull();
  });

  it('expanding the user word is exact; shortening it is only adjacent', () => {
    expect(matchTerm('SOLICITATION FOR CATERING SERVICES', 'cater')).toBe('exact');
    expect(matchTerm('Interior Cleaning Service', 'clean')).toBe('exact');
    expect(matchTerm('USDA-ARS Tifton Roofing Remodel', 'roofing')).toBe('exact');
    expect(matchTerm('Z--REPLACE ROOF SURFACES', 'roofing')).toBe('shortened');
    expect(matchTerm('Bucket truck Lease', 'trucking')).toBe('shortened');
  });

  it('a multi-word term needs every token', () => {
    expect(matchTerm('IT Support Services Contract (ITSSC) Recompete', 'it support')).toBe('exact');
    expect(matchTerm('Specialized Research Support Services', 'it support')).toBeNull();
  });

  it('guard does not match lifeguard, and the Coast Guard is a buyer not a trade', () => {
    expect(matchTerm('R499--FY26 Lifeguard and Pool Maintenance Services', 'guard')).toBeNull();
    expect(stripBuyerNames('US COAST GUARD TRACEN PETALUMA PROPANE DELIVERY')).not.toMatch(/guard/i);
    expect(matchTerm('US COAST GUARD TRACEN PETALUMA PROPANE DELIVERY', 'guard')).toBeNull();
    expect(matchTerm('WJHTC Armed Security Guard Services', 'security guard')).toBe('exact');
  });
});

describe('scoreOpportunity', () => {
  const garbage = extractBusinessActivity('can a 2 person garbage company do government contracts');

  it('admits a real match whose NAICS we never established', () => {
    const e = scoreOpportunity(item({ naics: null }), { activity: garbage });
    expect(e.tier).toBe('direct');
  });

  it('rejects a body-only hit with nothing in the title', () => {
    const e = scoreOpportunity(item({ title: 'BPA setup - Office Supplies FY26' }), {
      activity: garbage,
    });
    expect(e.tier).toBe('reject');
  });

  it('code overlap alone is adjacent, never a described match', () => {
    const e = scoreOpportunity(item({ title: 'Something unrelated', naics: '562998' }), {
      activity: garbage,
      codes: ['562998'],
    });
    expect(e.tier).toBe('broader');
  });

  it('admits nothing at all when no activity was resolved', () => {
    const none = extractBusinessActivity('I help businesses');
    expect(scoreOpportunity(item(), { activity: none }).tier).toBe('reject');
  });
});
