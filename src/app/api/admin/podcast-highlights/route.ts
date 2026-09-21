/**
 * Podcast highlight notes QA API — review key_lessons quality before
 * enabling ENABLE_PODCAST_INSIGHTS on Today's Intel.
 *
 *   ?op=stats&password=...
 *   ?op=sample&password=...&naics=541512&limit=30
 *   ?op=preview&password=...&naics=541512,236220  — what Mindy would pick
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  assessEpisodeLessons,
  assessHighlightQuality,
  type HighlightQualityTier,
} from '@/lib/rag/podcast-highlight-quality';
import { getPodcastInsightForProfile } from '@/lib/rag/podcast-insights';
import { isPodcastInsightEnabled } from '@/lib/rag/podcast-insights-flag';
import {
  filterByRelevance,
  RELEVANCE_THRESHOLDS,
  sortEpisodesByRelevance,
  type PodcastRelevanceResult,
} from '@/lib/rag/podcast-naics-relevance';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _supabase: any = null;
function getSupabase() {
  if (!_supabase) {
    _supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
  }
  return _supabase;
}

function unauthorized() {
  return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
}

function checkPassword(request: NextRequest): boolean {
  const password = request.nextUrl.searchParams.get('password');
  return password === (process.env.ADMIN_PASSWORD);
}

interface EpisodeRow {
  episode_number: number | null;
  episode_title: string;
  episode_url: string | null;
  guest_name: string | null;
  guest_company: string | null;
  naics_mentioned: string[] | null;
  topics: string[] | null;
  transcript_keywords: string[] | null;
  personas: string[] | null;
  business_type: string | null;
  key_lessons: string[] | null;
  summary_2sent: string | null;
  extraction_status: string;
}

function tierCounts(rows: EpisodeRow[]) {
  const lessonTiers: Record<HighlightQualityTier, number> = { good: 0, weak: 0, reject: 0 };
  let episodesWithGood = 0;
  let episodesWithOnlyWeak = 0;
  let episodesNoLessons = 0;
  let totalLessons = 0;

  for (const row of rows) {
    const lessons = row.key_lessons || [];
    if (!lessons.length) {
      episodesNoLessons++;
      continue;
    }
    const { lessons: assessed, bestTier } = assessEpisodeLessons(lessons, !!row.guest_name);
    totalLessons += assessed.length;
    for (const a of assessed) lessonTiers[a.quality.tier]++;
    if (bestTier === 'good') episodesWithGood++;
    else if (bestTier === 'weak') episodesWithOnlyWeak++;
    else episodesNoLessons++;
  }

  return {
    lessonTiers,
    totalLessons,
    episodesWithGood,
    episodesWithOnlyWeak,
    episodesNoUsable: rows.length - episodesWithGood - episodesWithOnlyWeak,
    episodesNoLessons,
  };
}

async function handleStats() {
  const sb = getSupabase();
  const { data: all, error } = await sb
    .from('podcast_episode_metadata')
    .select(
      'episode_number, episode_title, guest_name, guest_company, naics_mentioned, key_lessons, summary_2sent, extraction_status, episode_url'
    )
    .eq('extraction_status', 'extracted');

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  const rows = (all || []) as EpisodeRow[];
  const withGuest = rows.filter((r) => r.guest_name);
  const withLessons = withGuest.filter((r) => (r.key_lessons || []).length > 0);
  const counts = tierCounts(withLessons);

  const pending = await sb
    .from('podcast_episode_metadata')
    .select('id', { count: 'exact', head: true })
    .eq('extraction_status', 'pending');
  const failed = await sb
    .from('podcast_episode_metadata')
    .select('id', { count: 'exact', head: true })
    .eq('extraction_status', 'failed');

  const goodPct = counts.totalLessons
    ? Math.round((counts.lessonTiers.good / counts.totalLessons) * 100)
    : 0;

  return NextResponse.json({
    success: true,
    featureFlag: {
      enableEnv: process.env.ENABLE_PODCAST_INSIGHTS === 'true',
      rolloutPercent: parseInt(process.env.PODCAST_INSIGHTS_ROLLOUT_PERCENT || '0', 10),
      liveForAnyUser: isPodcastInsightEnabled('preview@govcongiants.com'),
    },
    totals: {
      extracted: rows.length,
      withGuest: withGuest.length,
      withLessons: withLessons.length,
      pending: pending.count ?? 0,
      failed: failed.count ?? 0,
    },
    quality: {
      ...counts,
      goodPercent: goodPct,
      recommendation:
        goodPct >= 55
          ? 'Quality looks shippable — try preview for your NAICS, then ENABLE_PODCAST_INSIGHTS=true at 5% rollout.'
          : goodPct >= 35
            ? 'Mixed quality — filter weak lessons or re-run extract-podcast-metadata.js --force on thin episodes.'
            : 'Quality too thin for production — improve extraction prompt or add highlight_quotes pass before enabling.',
    },
  });
}

async function handleSample(
  naicsParam: string,
  limit: number,
  random: boolean,
  showTangential: boolean,
) {
  const sb = getSupabase();
  const naicsList = naicsParam
    .split(/[,\s]+/)
    .map((c) => c.replace(/\D/g, '').slice(0, 6))
    .filter((c) => c.length === 6);

  const cols =
    'episode_number, episode_title, episode_url, guest_name, guest_company, naics_mentioned, topics, transcript_keywords, personas, business_type, key_lessons, summary_2sent, extraction_status';

  let query = sb
    .from('podcast_episode_metadata')
    .select(cols)
    .eq('extraction_status', 'extracted')
    .not('guest_name', 'is', null);

  if (naicsList.length) {
    query = query.overlaps('naics_mentioned', naicsList);
  }

  const { data, error } = await query.limit(random ? 250 : 150);
  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  let rows = (data || []) as EpisodeRow[];

  let ranked: ReturnType<typeof sortEpisodesByRelevance<EpisodeRow>> | null = null;

  if (naicsList.length && !random) {
    ranked = sortEpisodesByRelevance(rows, naicsList);
    const minScore = showTangential ? 0 : RELEVANCE_THRESHOLDS.admin;
    ranked = filterByRelevance(ranked, minScore).slice(0, limit);
  } else if (random && rows.length > limit) {
    for (let i = rows.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [rows[i], rows[j]] = [rows[j], rows[i]];
    }
    rows = rows.slice(0, limit);
  } else {
    rows = rows.slice(0, limit);
  }

  const sourceRows = ranked ?? rows;

  const episodes = sourceRows.map((row) => {
    const rel: PodcastRelevanceResult | null =
      'relevance' in row ? (row as EpisodeRow & { relevance: PodcastRelevanceResult }).relevance : null;
    const { lessons, bestTier } = assessEpisodeLessons(row.key_lessons || [], !!row.guest_name);
    const topLesson = lessons.find((l) => l.quality.tier === 'good') || lessons[0];
    return {
      episodeNumber: row.episode_number,
      episodeTitle: row.episode_title,
      episodeUrl: row.episode_url,
      guestName: row.guest_name,
      guestCompany: row.guest_company,
      naicsMentioned: row.naics_mentioned || [],
      summary: row.summary_2sent,
      bestTier,
      wouldShowOnCard: topLesson?.quality.cardPreview || null,
      relevanceScore: rel?.relevanceScore ?? null,
      matchTier: rel?.matchTier ?? null,
      matchedNaics: rel?.matchedNaics ?? [],
      relevanceReasons: rel?.reasons ?? [],
      userSectors: rel?.userSectorLabels ?? [],
      lessons: lessons.map((l) => ({
        text: l.text,
        tier: l.quality.tier,
        reasons: l.quality.reasons,
        charCount: l.quality.charCount,
        cardPreview: l.quality.cardPreview,
      })),
    };
  });

  return NextResponse.json({
    success: true,
    naicsFilter: naicsList,
    sortedBy: naicsList.length && !random ? 'relevance_score_desc' : random ? 'random' : 'database',
    minRelevanceShown: naicsList.length && !random && !showTangential ? RELEVANCE_THRESHOLDS.admin : 0,
    count: episodes.length,
    episodes,
  });
}

async function handlePreview(naicsParam: string) {
  const naicsList = naicsParam
    .split(/[,\s]+/)
    .map((c) => c.replace(/\D/g, '').slice(0, 6))
    .filter((c) => c.length >= 4);

  if (!naicsList.length) {
    return NextResponse.json({ success: false, error: 'naics param required' }, { status: 400 });
  }

  const today = new Date().toISOString().split('T')[0];
  const previews: Array<{
    seed: number;
    withQualityGate: boolean;
    insight: Awaited<ReturnType<typeof getPodcastInsightForProfile>>;
  }> = [];

  for (let seed = 0; seed < 5; seed++) {
    previews.push({
      seed,
      withQualityGate: false,
      insight: await getPodcastInsightForProfile({
        naicsCodes: naicsList,
        today,
        rotateSeed: seed,
        recentQuotes: [],
        qualityGate: false,
      }),
    });
    previews.push({
      seed,
      withQualityGate: true,
      insight: await getPodcastInsightForProfile({
        naicsCodes: naicsList,
        today,
        rotateSeed: seed,
        recentQuotes: [],
        qualityGate: true,
      }),
    });
  }

  return NextResponse.json({
    success: true,
    naics: naicsList,
    previews,
    note:
      'Production = ≥36% industry fit + lessonPassesProductionGate. Ungated = fit score only (may include generic networking lines).',
  });
}

export async function GET(request: NextRequest) {
  if (!checkPassword(request)) return unauthorized();

  const op = request.nextUrl.searchParams.get('op') || 'stats';

  if (op === 'stats') return handleStats();

  if (op === 'sample') {
    const naics = request.nextUrl.searchParams.get('naics') || '';
    const limit = Math.min(parseInt(request.nextUrl.searchParams.get('limit') || '25', 10) || 25, 80);
    const random = request.nextUrl.searchParams.get('random') === '1';
    const showTangential = request.nextUrl.searchParams.get('tangential') === '1';
    return handleSample(naics, limit, random, showTangential);
  }

  if (op === 'preview') {
    const naics = request.nextUrl.searchParams.get('naics') || '';
    return handlePreview(naics);
  }

  if (op === 'weak-examples') {
    const sb = getSupabase();
    const { data } = await sb
      .from('podcast_episode_metadata')
      .select('guest_name, episode_number, key_lessons')
      .eq('extraction_status', 'extracted')
      .not('guest_name', 'is', null)
      .limit(150);

    const weak: Array<{ episode: number | null; guest: string | null; lesson: string; reasons: string[] }> = [];
    for (const row of data || []) {
      for (const lesson of row.key_lessons || []) {
        const q = assessHighlightQuality(lesson, { hasGuest: !!row.guest_name });
        if (q.tier === 'weak' && weak.length < 40) {
          weak.push({
            episode: row.episode_number,
            guest: row.guest_name,
            lesson,
            reasons: q.reasons,
          });
        }
      }
    }
    return NextResponse.json({ success: true, weak });
  }

  return NextResponse.json({ success: false, error: 'Unknown op' }, { status: 400 });
}
