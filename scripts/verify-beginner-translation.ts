#!/usr/bin/env npx tsx
/**
 * Live acceptance fixtures for the beginner hidden-market reveal.
 *
 * Does NOT assert that every business has a big hidden market. Prints
 * truthful A/B counts + revealState. Exits 1 on pipeline error, jargon
 * leak, an uncovered card that is also in the direct set, or no working
 * SAM URL across fixtures.
 *
 * Usage: npx tsx scripts/verify-beginner-translation.ts
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';
import {
  searchBeginnerHiddenMarket,
  toHiddenMarketLandingView,
} from '../src/lib/beginner/hidden-market';
import { opportunityKey } from '../src/lib/beginner/opportunity-key';
import type { PublicBeginnerCard } from '../src/lib/beginner/landing';
import type { SamSearchItem } from '../src/lib/beginner/types';

const FIXTURES = [
  'I clean office buildings',
  'I provide IT support and cybersecurity',
  'I provide temporary staffing',
  'I do lawn care and grounds maintenance',
  'I provide catering and food service',
];

const VAGUE = 'I help businesses';

function noticeFromUrl(url: string | null): string | null {
  if (!url) return null;
  const m = url.match(/\/(?:opp|opportunity)\/([0-9a-f]{32})\b/i);
  return m ? m[1].toLowerCase() : null;
}

function cardIds(cards: PublicBeginnerCard[]): string[] {
  return cards
    .map((c) => noticeFromUrl(c.samUrl) || c.referenceNumber || c.samUrl)
    .filter((x): x is string => Boolean(x));
}

async function sampleDistinct() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  const db = createClient(url, key, { auth: { persistSession: false } });
  const [codes, types, descs] = await Promise.all([
    db.from('sam_opportunities').select('set_aside_code').eq('active', true).limit(1000),
    db.from('sam_opportunities').select('notice_type').eq('active', true).limit(1000),
    db.from('sam_opportunities').select('set_aside_description').eq('active', true).limit(1000),
  ]);
  const uniq = (rows: { [k: string]: string | null }[] | null, col: string) =>
    [...new Set((rows || []).map((r) => r[col]).filter((v): v is string => !!v))].sort();
  return {
    set_aside_codes: uniq(codes.data as { set_aside_code: string | null }[] | null, 'set_aside_code'),
    notice_types: uniq(types.data as { notice_type: string | null }[] | null, 'notice_type'),
    set_aside_descriptions: uniq(
      descs.data as { set_aside_description: string | null }[] | null,
      'set_aside_description',
    ).slice(0, 40),
  };
}

function keysOf(items: SamSearchItem[]): string[] {
  return items.map(opportunityKey).filter((k): k is string => Boolean(k));
}

async function main() {
  const distinct = await sampleDistinct();
  if (distinct) {
    console.log('--- live distinct (sample of 1000 active rows, not a census) ---');
    console.log('set_aside_code:', distinct.set_aside_codes.join(', ') || '(none in sample)');
    console.log('notice_type:', distinct.notice_types.join(', ') || '(none in sample)');
    console.log('set_aside_description sample:', distinct.set_aside_descriptions.join(' | '));
    console.log('');
  }

  let workingSam = 0;
  for (const description of FIXTURES) {
    const result = await searchBeginnerHiddenMarket({ description });
    const view = toHiddenMarketLandingView(result);
    const generated = JSON.stringify({
      explanation: view.reveal?.explanation,
      translatedTerms: view.reveal?.translatedTerms,
      limitations: view.reveal?.limitations,
      message: view.message,
      directCards: view.directCards.map((c) => ({
        title: c.title,
        noticeLabel: c.noticeLabel,
        audienceLabel: c.audienceLabel,
        dueLabel: c.dueLabel,
        amountLabel: c.amountLabel,
        plainMeaning: c.plainMeaning,
        nextStep: c.nextStep,
        searchContext: c.searchContext,
      })),
      uncoveredCards: view.uncoveredCards.map((c) => ({
        title: c.title,
        noticeLabel: c.noticeLabel,
        audienceLabel: c.audienceLabel,
        dueLabel: c.dueLabel,
        amountLabel: c.amountLabel,
        plainMeaning: c.plainMeaning,
        nextStep: c.nextStep,
        searchContext: c.searchContext,
      })),
    });
    if (/\bNAICS\b|\bPSC\b|\bFPDS\b|\bDoDAAC\b|\bset-aside code\b/i.test(generated)) {
      console.error('FAIL: public landing copy leaked GovCon jargon for', description);
      process.exit(1);
    }
    if (/\$[\d,]+\s*(million|billion|M|B)?/i.test(generated) && /totalMarket|federal market/i.test(generated)) {
      console.error('FAIL: dollar market-size leaked for', description);
      process.exit(1);
    }

    const directIds = new Set(cardIds(view.directCards));
    const uncoveredIds = cardIds(view.uncoveredCards);
    const overlap = uncoveredIds.filter((id) => directIds.has(id));
    if (overlap.length > 0) {
      console.error('FAIL: uncovered card also in direct set for', description, overlap);
      process.exit(1);
    }

    const directKeys = new Set(keysOf(result.direct.items));
    const uncoveredKeys = keysOf(result.netNewItems);
    const keyOverlap = uncoveredKeys.filter((k) => directKeys.has(k));
    if (keyOverlap.length > 0) {
      console.error('FAIL: net-new key also in direct set for', description, keyOverlap);
      process.exit(1);
    }

    for (const c of [...view.directCards, ...view.uncoveredCards]) {
      if (c.samUrl && /^https?:\/\//.test(c.samUrl)) workingSam += 1;
    }

    console.log(
      JSON.stringify(
        {
          input: description,
          classificationPath: view.classificationPath,
          directKeyword: result.directKeyword,
          expandedKeyword: result.expandedKeyword,
          directCount: result.reveal.directMatchCount,
          expandedCount: result.reveal.expandedMatchCount,
          totalUniqueCount:
            result.reveal.totalUniqueCount == null ? 'n/a — not dedup-able' : result.reveal.totalUniqueCount,
          revealState: result.reveal.revealState,
          translatedTerms: result.reveal.translatedTerms || [],
          agencies: result.reveal.agencies || null,
          cardsDirect: view.directCards.length,
          cardsUncovered: view.uncoveredCards.length,
          uncoveredNotInDirect: uncoveredIds.length === 0 || overlap.length === 0,
          explanation: result.reveal.explanation,
        },
        null,
        2,
      ),
    );
    console.log('');
  }

  let vagueSearches = 0;
  const vague = await searchBeginnerHiddenMarket(
    { description: VAGUE },
    {
      searchSam: async () => {
        vagueSearches += 1;
        return { ok: true, count: 0, items: [] };
      },
    },
  );
  // Live path still hits real tools for classify; searchSam override only if injected.
  // Default live: classification should be need_followup and skip expanded search.
  if (vague.resolution.state !== 'need_followup') {
    console.log(
      JSON.stringify(
        {
          input: VAGUE,
          note: 'live classification was not follow-up — recorded, not a forced fail',
          classificationPath: vague.resolution.state,
          expandedKeyword: vague.expandedKeyword,
          revealState: vague.reveal.revealState,
        },
        null,
        2,
      ),
    );
  } else {
    console.log(
      JSON.stringify(
        {
          input: VAGUE,
          classificationPath: vague.resolution.state,
          expandedKeyword: vague.expandedKeyword,
          searches: vagueSearches,
          revealState: vague.reveal.revealState,
        },
        null,
        2,
      ),
    );
  }
  if (vague.resolution.state === 'need_followup' && vague.expandedKeyword) {
    console.error('FAIL: vague input fabricated an expanded population');
    process.exit(1);
  }
  console.log('');

  if (workingSam < 1) {
    console.error('FAIL: no fixture produced a working SAM URL (known-positive gate)');
    process.exit(1);
  }
  console.log(`OK: ${workingSam} beginner card(s) carried a SAM URL`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
