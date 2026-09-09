#!/usr/bin/env npx tsx
/**
 * Live acceptance fixtures for the beginner translation seam.
 *
 * Does NOT assert a fixed result count. Prints truthful resolution + up to
 * three beginner cards per description. Exits 1 only if the pipeline errors
 * or no fixture yields a working SAM link (known-positive gate).
 *
 * Usage: npx tsx scripts/verify-beginner-translation.ts
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';
import { searchBeginnerOpportunities } from '../src/lib/beginner/search';
import type { BeginnerOpportunityCard } from '../src/lib/beginner/types';

const FIXTURES = [
  'I clean office buildings',
  'I provide IT support and cybersecurity',
  'I provide temporary staffing',
  'I do lawn care and grounds maintenance',
  'I provide catering and food service',
];

function cardSummary(card: BeginnerOpportunityCard) {
  return {
    title: card.title,
    noticeLabel: card.noticeLabel,
    setAsideLabel: card.setAsideLabel,
    audienceLabel: card.audienceLabel,
    dueLabel: card.dueLabel,
    amountLabel: card.amountLabel,
    pscLabel: card.pscLabel,
    plainMeaning: card.plainMeaning,
    nextStep: card.nextStep,
    referenceNumber: card.referenceNumber,
    samUrl: card.samUrl,
    raw: {
      type: card.raw.type,
      set_aside: card.raw.set_aside,
      deadline: card.raw.deadline,
      amount: card.raw.amount,
      psc_description: card.raw.psc_description,
    },
  };
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
  const uniq = (rows: { [k: string]: string | null }[] | null, key: string) =>
    [...new Set((rows || []).map((r) => r[key]).filter((v): v is string => !!v))].sort();
  return {
    set_aside_codes: uniq(codes.data as { set_aside_code: string | null }[] | null, 'set_aside_code'),
    notice_types: uniq(types.data as { notice_type: string | null }[] | null, 'notice_type'),
    set_aside_descriptions: uniq(
      descs.data as { set_aside_description: string | null }[] | null,
      'set_aside_description',
    ).slice(0, 40),
  };
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
    const result = await searchBeginnerOpportunities({ description, limit: 8 });
    const cards =
      result.outcome.kind === 'results' ? result.outcome.cards.slice(0, 3) : [];
    const count = result.outcome.kind === 'results' ? result.outcome.count : 0;
    for (const c of cards) {
      if (c.samUrl && /^https?:\/\//.test(c.samUrl)) workingSam += 1;
    }
    console.log(JSON.stringify({
      input: description,
      resolutionState: result.resolution.state,
      searchKeyword: result.resolution.searchKeyword,
      contextLabel: result.resolution.contextLabel,
      structured: result.resolution.state === 'structured',
      primaryNaics: result.resolution.primaryNaics,
      psc: result.resolution.psc,
      keywords: result.resolution.keywords,
      naicsCodes: result.resolution.naicsCodes,
      outcome: result.outcome.kind,
      outcomeMessage: result.outcome.kind === 'results' ? undefined : result.outcome.message,
      groundedCount: count,
      cards: cards.map(cardSummary),
    }, null, 2));
    console.log('');
  }

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
