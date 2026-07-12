import { NextRequest, NextResponse } from 'next/server';
import { getVocabularyForCodes } from '@/lib/market/vocabulary';

/**
 * GET /api/app/naics-vocabulary?codes=561730,238220
 *
 * The real buyer VOCABULARY for a set of NAICS codes — the words federal buyers
 * actually use in award text for those codes (mined from real awards, TF-IDF
 * ranked; see naics_vocabulary + scripts/build-naics-vocabulary.ts). Powers the
 * onboarding "buyers also say …" keyword suggestions: one-tap real capability
 * words, grounded in data instead of the user guessing.
 *
 * Read-only, no auth: returns no user data — only public buyer-vocabulary terms
 * keyed by code (same posture as /api/app/keyword-coverage). Fails soft to an
 * empty list; the caller treats suggestions as optional and never blocks on them.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const codes = (request.nextUrl.searchParams.get('codes') || '')
    .split(',').map((c) => c.trim()).filter(Boolean);
  if (codes.length === 0) {
    return NextResponse.json({ terms: [] });
  }

  // Merged, weight-ranked vocabulary across the whole profile. Cap at 12 —
  // suggestions, not an exhaustive dump; the top terms are the distinctive ones.
  const vocab = await getVocabularyForCodes(codes, { limit: 12 }).catch(() => []);
  return NextResponse.json({
    terms: vocab.map((t) => ({ term: t.term, weight: t.weight })),
  });
}
