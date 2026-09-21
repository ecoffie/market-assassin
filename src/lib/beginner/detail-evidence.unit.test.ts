import { describe, expect, it } from 'vitest';
import {
  DETAIL_EVIDENCE_MAX_HITS,
  findDetailEvidence,
  findTermInText,
  usableDetailTerms,
} from './detail-evidence';
import { searchBeginnerHiddenMarket, toHiddenMarketLandingView } from './hidden-market';
import type { CompanyKeywordsToolResult } from '@/mcp/tools/company-keywords';
import type { SamSearchItem } from './types';

/** Verbatim from the live cache, 2026-09-21. */
const PSW_DESCRIPTION =
  'Grounds maintenance at the Office building grounds. The purpose of this contract is to have ' +
  'frequent mowing, weeding, and general lawn maintenance year-round at the Institute of Pacific ' +
  'Islands Forestry, Hilo, Hawaii.';
/** Also verbatim: the wildcard that pulled 23 unrelated VA notices in. */
const VA_SOW =
  'Statement of work for duct replacement at the VA Medical Center. Contractor shall provide ' +
  'staff licenses for medical staff (e.g., medical doctor, physician assistant, nurse) and a ' +
  'staffing plan for the duration.';

function item(over: Partial<SamSearchItem> = {}): SamSearchItem {
  return {
    notice_id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    title: 'PSW Landscaping Hilo, Hawaii',
    agency: 'AGRICULTURE, DEPARTMENT OF',
    naics: '561730',
    set_aside: null,
    type: 'Combined Synopsis/Solicitation',
    deadline: '2026-10-15T17:00:00Z',
    solicitation: 'PSW-1',
    link: 'https://sam.gov/workspace/contract/opp/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/view',
    ...over,
  };
}

describe('detail evidence — an exact-token miss is not market absence', () => {
  it('requires a DISTINCTIVE term: a wildcard may not roam a 48KB SOW', () => {
    // A title is ~8 words, so "medical" is mostly self-limiting there. A
    // description is thousands, where it matched VA duct work, bed-bug pest
    // control and radiopharmaceuticals — 23 listings, none of them staffing.
    expect(usableDetailTerms(['medical staffing', 'medical'])).toEqual(['medical staffing']);
    expect(usableDetailTerms(['lawn mowing', 'lawn'])).toEqual(['lawn mowing', 'lawn']);
  });

  it('a multi-word term must be a PHRASE, not two words in the same document', () => {
    expect(findTermInText(VA_SOW, 'medical staffing')).toBe(-1);
    expect(findTermInText('VA or DoD medical staffing contracts', 'medical staffing')).toBeGreaterThan(-1);
  });

  it('proves the user’s own word in the notice’s own text, and quotes it', async () => {
    const hits = await findDetailEvidence([item()], ['lawn mowing', 'mowing'], {
      fetchNoticeText: async () => [
        { notice_id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', description: PSW_DESCRIPTION, sow_text: null },
      ],
    });
    expect(hits).toHaveLength(1);
    expect(hits[0].passage).toContain('mowing');
    expect(hits[0].passage).toContain('lawn maintenance');
  });

  it('a missing description yields NO claim — absent text is not absent work', async () => {
    const hits = await findDetailEvidence([item()], ['lawn mowing'], {
      fetchNoticeText: async () => [
        { notice_id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', description: null, sow_text: null },
      ],
    });
    expect(hits).toEqual([]);
  });

  it('fails soft: a read error is no evidence, never an error state', async () => {
    const hits = await findDetailEvidence([item()], ['lawn mowing'], {
      fetchNoticeText: async () => {
        throw new Error('boom');
      },
    }).catch(() => 'threw');
    expect(hits).toBe('threw');
  });

  it('a rescue may add a few adjacent listings, never take over the page', async () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      item({
        notice_id: String(i).padStart(32, 'b'),
        solicitation: `S-${i}`,
        link: `https://sam.gov/workspace/contract/opp/${String(i).padStart(32, 'b')}/view`,
      }),
    );
    const hits = await findDetailEvidence(many, ['lawn mowing'], {
      fetchNoticeText: async (ids) =>
        ids.map((notice_id) => ({ notice_id, description: PSW_DESCRIPTION, sow_text: null })),
    });
    expect(hits.length).toBeLessThanOrEqual(DETAIL_EVIDENCE_MAX_HITS);
  });
});

describe('zero results never read as market absence', () => {
  function derive(keywords: string[]): CompanyKeywordsToolResult {
    return {
      keywords,
      _meta: { grounded: keywords.length > 0, degraded: false, ranked: false, keyword_count: keywords.length, input_chars: 20 },
    };
  }

  it('names the words searched and says the limit is the SEARCH, not the market', async () => {
    const result = await searchBeginnerHiddenMarket(
      { description: 'we mow lawns' },
      {
        deriveKeywords: async () => derive(['mow lawns']),
        searchSam: async () => ({ ok: true, count: 0, items: [] }),
        fetchNoticeText: async () => [],
      },
    );
    const view = toHiddenMarketLandingView(result);
    const blob = `${view.message ?? ''} ${view.reveal?.explanation ?? ''}`;
    expect(blob).toMatch(/not a sign that nothing is open|not a reading of the market/i);
    expect(blob).not.toMatch(/nothing matching is open/i);
    expect(blob).not.toMatch(/the open market is small/i);
    expect(blob).not.toMatch(/0 current opportunit/i);
  });

  it('a thin RESULT is never reported as a thin MARKET', async () => {
    const result = await searchBeginnerHiddenMarket(
      { description: 'can a 2 person garbage company do government contracts' },
      {
        deriveKeywords: async () => derive(['garbage']),
        searchSam: async () => ({
          ok: true,
          count: 1,
          items: [item({ title: 'Trash and Garbage Removal Services', naics: '562998', notice_id: 'c'.repeat(32), link: 'https://sam.gov/workspace/contract/opp/cccccccccccccccccccccccccccccccc/view' })],
        }),
      },
    );
    // The garbage hauler saw "the open market is small right now" while ~20
    // open refuse / solid-waste notices existed under words they didn't type.
    expect(result.reveal.explanation).not.toMatch(/market is small/i);
    expect(result.reveal.explanation).toMatch(/title names/i);
    expect(result.reveal.searchedTerms).toContain('garbage');
  });
});
