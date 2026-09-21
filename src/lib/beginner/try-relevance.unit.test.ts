/**
 * Drives the FROZEN /try regression set (./__fixtures__/try-relevance-cases).
 *
 * The corpus for each case is exactly that case's include+exclude records —
 * all of them REAL rows measured in the live cache on 2026-09-21 — and the
 * SAM stub returns the WHOLE corpus for any keyword. That is deliberate: the
 * live tool merges a title-ILIKE pass with a body-FTS pass, so a body-only
 * hit like "BPA setup - Office Supplies FY26" genuinely arrives for the
 * keyword "garbage". Classifying what the query returned IS the job.
 */
import { describe, expect, it } from 'vitest';
import {
  ELIGIBILITY_CASES,
  TRY_RELEVANCE_CASES,
  type CaseRecord,
} from './__fixtures__/try-relevance-cases';
import { searchBeginnerHiddenMarket, toHiddenMarketLandingView } from './hidden-market';
import { extractBusinessActivity } from './activity';
import { translateOpportunity } from './translate-opportunity';
import { noticeStage } from './labels';
import { keywordCandidates } from '@/lib/market/keyword-sanitize';
import type { CompanyKeywordsToolResult } from '@/mcp/tools/company-keywords';
import type { SamSearchItem } from './types';

const NOW = Date.parse('2026-09-21T12:00:00Z');

function toItem(rec: CaseRecord, i: number): SamSearchItem {
  return {
    title: rec.title,
    agency: 'TEST AGENCY',
    naics: rec.naics,
    set_aside: rec.setAside,
    type: rec.type,
    deadline: '2026-10-15T17:00:00Z',
    solicitation: `CASE-${i}`,
    link: `https://sam.gov/workspace/contract/opp/${String(i).padStart(32, '0')}/view`,
  };
}

/**
 * Lexical stand-in for derive_company_keywords. The real tool ranks by
 * embedding; extraction deliberately does not depend on that order (it put
 * "drones" ahead of "lidar"), so a deterministic stub is the honest fixture.
 */
function deriveStub(description: string): CompanyKeywordsToolResult {
  const keywords = keywordCandidates(description).slice(1);
  return {
    keywords,
    _meta: {
      grounded: keywords.length > 0,
      degraded: false,
      ranked: false,
      keyword_count: keywords.length,
      input_chars: description.length,
    },
  };
}

describe('/try relevance — frozen regression set (2026-09-21)', () => {
  for (const c of TRY_RELEVANCE_CASES) {
    describe(`${c.id}: ${JSON.stringify(c.input)}`, () => {
      const corpus = [...c.include, ...c.exclude].map(toItem);

      it('extracts the business activity, not the company context', () => {
        const activity = extractBusinessActivity(c.input, deriveStub(c.input).keywords);
        expect(activity.head).toBe(c.expectHead);
        expect(activity.confidence).toBe(c.expectConfidence);
        // Context words can never be the thing we search.
        for (const word of activity.context) {
          expect(activity.terms.join(' ')).not.toContain(word);
        }
      });

      it('classifies every record the way the freeze says', async () => {
        const result = await searchBeginnerHiddenMarket(
          { description: c.input, nowMs: NOW },
          {
            deriveKeywords: async () => deriveStub(c.input),
            searchSam: async () => ({ ok: true, count: corpus.length, items: corpus }),
          },
        );
        const view = toHiddenMarketLandingView(result, { nowMs: NOW });
        expect(view.outcome).toBe(c.expectOutcome);

        const directTitles = result.direct.items.map((i) => i.title);
        const relatedTitles = result.related.map((i) => i.title);

        // Known relevant positives — the guard against "fix" == "return nothing".
        for (const rec of c.include) {
          expect(directTitles, `INCLUDE missing from direct: ${rec.title} — ${rec.why}`).toContain(
            rec.title,
          );
        }
        for (const rec of c.exclude) {
          expect(directTitles, `EXCLUDE leaked into direct: ${rec.title} — ${rec.why}`).not.toContain(
            rec.title,
          );
          if (rec.group === 'none') {
            expect(relatedTitles, `must not be shown at all: ${rec.title} — ${rec.why}`).not.toContain(
              rec.title,
            );
          }
        }
      });
    });
  }

  it('a genuinely multi-service business keeps BOTH of its markets', async () => {
    const c = TRY_RELEVANCE_CASES.find((x) => x.id === 'multi-service');
    expect(c).toBeTruthy();
    const corpus = [...c!.include, ...c!.exclude].map(toItem);
    const result = await searchBeginnerHiddenMarket(
      { description: c!.input, nowMs: NOW },
      {
        deriveKeywords: async () => deriveStub(c!.input),
        searchSam: async () => ({ ok: true, count: corpus.length, items: corpus }),
      },
    );
    const sectors = new Set(result.direct.items.map((i) => (i.naics || '').slice(0, 2)));
    // Cleaning (56) and construction (23) — two unrelated sectors, both correct.
    expect(sectors.size).toBeGreaterThanOrEqual(2);
  });

  it('never searches a context word, across the whole set', () => {
    const banned = /^(person|people|company|business|government|contract|contracts|small|help)$/;
    for (const c of TRY_RELEVANCE_CASES) {
      const head = extractBusinessActivity(c.input, deriveStub(c.input).keywords).head;
      if (head) expect(head, `${c.id} searched a context word`).not.toMatch(banned);
    }
  });
});

describe('/try eligibility + notice stage (2026-09-21)', () => {
  for (const c of ELIGIBILITY_CASES) {
    it(`${c.id}: ${c.why}`, () => {
      const card = translateOpportunity(toItem(c.record, 1), {
        nowMs: NOW,
        eligibility: { established: false },
      });
      expect(card.audienceLabel).toContain(c.expectAudienceContains);
      expect(card.audienceLabel).not.toContain(c.expectAudienceExcludes);
      expect(card.stage).toBe(c.expectStage);
    });
  }

  it('a market-research response date is never worded as a bid deadline', () => {
    const rfi = translateOpportunity(
      toItem(
        { title: 'RFI - something', naics: null, type: 'Sources Sought', setAside: null, why: '' },
        2,
      ),
      { nowMs: NOW },
    );
    expect(rfi.dueLabel).toMatch(/^Response/);
    expect(rfi.dueLabel).not.toMatch(/^Bid/);
    expect(noticeStage('Sources Sought')).toBe('market_research');
  });

  it('counts carry their stage mix instead of one blurred "opportunities" number', async () => {
    const mixed: SamSearchItem[] = [
      { title: 'Trash and Garbage Removal Services', agency: 'A', naics: '562998', set_aside: null, type: 'Solicitation', deadline: '2026-10-15T17:00:00Z', solicitation: 'M1', link: 'https://sam.gov/workspace/contract/opp/00000000000000000000000000000001/view' },
      { title: 'Garbage Collection RFI', agency: 'B', naics: '562111', set_aside: null, type: 'Sources Sought', deadline: '2026-10-16T17:00:00Z', solicitation: 'M2', link: 'https://sam.gov/workspace/contract/opp/00000000000000000000000000000002/view' },
      { title: 'Garbage Hauling - upcoming', agency: 'C', naics: '562111', set_aside: null, type: 'Presolicitation', deadline: '2026-10-17T17:00:00Z', solicitation: 'M3', link: 'https://sam.gov/workspace/contract/opp/00000000000000000000000000000003/view' },
    ];
    const result = await searchBeginnerHiddenMarket(
      { description: 'can a 2 person garbage company do government contracts', nowMs: NOW },
      {
        deriveKeywords: async () => deriveStub('garbage'),
        searchSam: async () => ({ ok: true, count: mixed.length, items: mixed }),
      },
    );
    expect(result.reveal.stages).toMatchObject({
      open_bid: 1,
      market_research: 1,
      upcoming: 1,
      total: 3,
    });
    expect(result.reveal.stageSummary).toBe(
      '1 open to bid now, 1 market research notice (not a bid) and 1 coming soon',
    );
    // The plural bug that shipped in the same response as the false positives.
    expect(result.reveal.explanation).not.toContain('opportunitys');
  });

  it('counts distinct notices, not duplicate rows', async () => {
    const dupe: SamSearchItem = {
      title: 'Trash and Garbage Removal Services',
      agency: 'A',
      naics: '562998',
      set_aside: null,
      type: 'Solicitation',
      deadline: '2026-10-15T17:00:00Z',
      solicitation: 'DUP-1',
      link: 'https://sam.gov/workspace/contract/opp/00000000000000000000000000000009/view',
    };
    const result = await searchBeginnerHiddenMarket(
      { description: 'garbage hauling', nowMs: NOW },
      {
        deriveKeywords: async () => deriveStub('garbage hauling'),
        searchSam: async () => ({ ok: true, count: 3, items: [dupe, { ...dupe }, { ...dupe }] }),
      },
    );
    expect(result.reveal.directMatchCount).toBe(1);
  });
});
