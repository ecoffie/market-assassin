/**
 * Dashboard insight card: podcast-guest quotes are never selected or shown (Eric, 2026-11-27: "remove podcast quotes
 * from dashboard insight too"). The podcast candidate is dropped at selection, not only hidden; a podcast insight
 * cached or snapshotted before the change is replaced, never served; the card still gets the next valid insight.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PROFILE_LESS_QUOTES, STATIC_FALLBACK_QUOTE } from '@/lib/dashboard/insight-selection';

const h = vi.hoisted(() => ({
  cached: null as Record<string, unknown> | null,
  upserts: [] as Array<Record<string, unknown>>,
  podcast: vi.fn(async () => ({ quote: 'A guest said this.', format: 'sentence', attribution: 'Guest, Episode 900', relevanceScore: 0.99, matchTier: 'exact', source: 'podcast_guest' })),
  snapshot: null as { data: Record<string, unknown>; savedAt: string } | null,
  outage: false,
}));

vi.mock('@/lib/api-auth', () => ({ verifyUserOwnsEmail: vi.fn(async (_r: unknown, email: string) => ({ authenticated: true, email })) }));
vi.mock('@/lib/app/workspace', () => ({ resolveActiveWorkspace: vi.fn(async () => ({ workspaceId: null, asClient: false })), clientNotificationEmail: () => '' }));
vi.mock('@/lib/llm/usage-cost', () => ({ recordLlmUsage: vi.fn(async () => {}) }));
// If anything still reached the podcast library, this spy would see it.
vi.mock('@/lib/rag/podcast-insights', () => ({ getPodcastInsightForProfile: h.podcast, podcastInsightFeatureEnabled: () => true }));
vi.mock('@/lib/resilience/last-good', async (orig) => ({
  ...(await orig<typeof import('@/lib/resilience/last-good')>()),
  saveSnapshot: vi.fn(async () => {}),
  readSnapshot: vi.fn(async () => h.snapshot),
}));
vi.mock('@supabase/supabase-js', () => {
  const make = (table: string) => {
    const q: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'gte', 'lte', 'lt', 'gt', 'order', 'limit', 'in', 'neq', 'not', 'or', 'ilike', 'is']) q[m] = () => q;
    q.maybeSingle = async () => {
      if (h.outage) throw new Error('fetch failed');
      if (table === 'dashboard_insights') return { data: h.cached, error: null };
      if (table === 'user_notification_settings') return { data: { naics_codes: ['561720'], agencies: [] }, error: null };
      return { data: null, error: null };
    };
    q.single = q.maybeSingle;
    q.upsert = async (row: Record<string, unknown>) => { h.upserts.push(row); return { error: null }; };
    q.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(res);
    return q;
  };
  return { createClient: () => ({ from: (t: string) => make(t) }) };
});

const req = (qs = '') => new NextRequest(`https://getmindy.ai/api/app/dashboard/insight?email=pat@example.com&localDate=2026-11-27${qs}`);

beforeEach(() => {
  h.cached = null; h.upserts.length = 0; h.podcast.mockClear(); h.snapshot = null; h.outage = false;
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://x.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'srk';
  delete process.env.OPENAI_API_KEY;
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

async function get(qs = '') {
  const { GET } = await import('./route');
  const res = await GET(req(qs));
  return { status: res.status, body: await res.json() as { insight?: { source: string; quote: string; mode?: string; attribution?: string } } };
}

describe('dashboard insight: no podcast quotes', () => {
  it('never selects a podcast-guest insight: the podcast library is not called and the card gets the next valid insight', async () => {
    const { status, body } = await get();
    expect(status).toBe(200);
    expect(h.podcast).not.toHaveBeenCalled();
    expect(body.insight?.source).not.toBe('podcast_guest');
    expect(body.insight?.mode).not.toBe('lesson');
    expect(body.insight?.quote).toBeTruthy(); // never an empty card
    expect(JSON.stringify(body)).not.toMatch(/podcast|episode/i);
  });

  it('a podcast insight cached earlier today is replaced (and the cached row overwritten), never served', async () => {
    h.cached = { quote: 'A guest said this.', quote_format: 'sentence', source: 'podcast_guest', attribution: 'Guest, Episode 900', theme_index: 1, insight_date: '2026-11-27' };
    const { body } = await get();
    expect(body.insight?.source).not.toBe('podcast_guest');
    expect(body.insight?.quote).not.toBe('A guest said this.');
    expect(h.upserts.at(-1)?.source).not.toBe('podcast_guest');
  });

  it('a non-podcast cached insight is still served from the cache', async () => {
    h.cached = { quote: '12 new janitorial notices this week.', quote_format: 'stat', source: 'deterministic_data', attribution: null, theme_index: 1, insight_date: '2026-11-27' };
    const { body } = await get();
    expect(body.insight).toMatchObject({ source: 'deterministic_data', quote: '12 new janitorial notices this week.' });
    expect((body as { cached?: boolean }).cached).toBe(true);
  });

  it('during an outage, a podcast insight snapshotted earlier is not served', async () => {
    h.outage = true;
    h.snapshot = { data: { success: true, insight: { source: 'podcast_guest', quote: 'A guest said this.' } }, savedAt: '2026-11-27T10:00:00Z' };
    const { status, body } = await get();
    expect(JSON.stringify(body)).not.toContain('A guest said this.');
    expect(status).toBe(500);
  });

  it('during an outage, a non-podcast snapshot is still served (the degraded path keeps working)', async () => {
    h.outage = true;
    h.snapshot = { data: { success: true, insight: { source: 'ai_briefing', quote: 'Market pulse.' } }, savedAt: '2026-11-27T10:00:00Z' };
    const { status, body } = await get();
    expect(status).toBe(200);
    expect(body.insight?.quote).toBe('Market pulse.');
  });

  it('no general line on the card states a figure: the static fallback and the profile-less lines carry no number or percentage', async () => {
    for (const q of [STATIC_FALLBACK_QUOTE, ...PROFILE_LESS_QUOTES.map((x) => x.quote)]) {
      expect(q).not.toMatch(/\d|%|percent|\$/i);
      expect(q).not.toMatch(/[\u2013\u2014]/);
    }
    const src = readFileSync(join(process.cwd(), 'src/app/api/app/dashboard/insight/route.ts'), 'utf8');
    expect(src).not.toMatch(/67% faster|\$183B|40% of FY26|3,000\+ new/);
  });

  it('a general line is labelled as such (fallback), never as the customer\'s own data', async () => {
    // No briefing and no alert matches in this harness: the card gets a general line.
    const { body } = await get();
    expect(body.insight?.source).toBe('fallback');
    expect([STATIC_FALLBACK_QUOTE, ...PROFILE_LESS_QUOTES.map((x) => x.quote)]).toContain(body.insight?.quote);
  });
});
