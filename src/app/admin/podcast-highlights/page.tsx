'use client';

/**
 * Podcast Highlight Notes QA — review key_lessons before enabling
 * guest quotes on Today's Intel Mindy Insight.
 *
 * /admin/podcast-highlights
 */

import { useCallback, useEffect, useState } from 'react';

type Tab = 'overview' | 'browse' | 'preview';

interface StatsPayload {
  featureFlag: { enableEnv: boolean; rolloutPercent: number; liveForAnyUser: boolean };
  totals: { extracted: number; withGuest: number; withLessons: number; pending: number; failed: number };
  quality: {
    lessonTiers: { good: number; weak: number; reject: number };
    goodPercent: number;
    recommendation: string;
    totalLessons: number;
    episodesWithGood: number;
    episodesWithOnlyWeak: number;
  };
}

interface LessonRow {
  text: string;
  tier: 'good' | 'weak' | 'reject';
  reasons: string[];
  charCount: number;
  cardPreview: string;
}

interface EpisodeSample {
  episodeNumber: number | null;
  episodeTitle: string;
  episodeUrl: string | null;
  guestName: string | null;
  guestCompany: string | null;
  naicsMentioned: string[];
  summary: string | null;
  bestTier: string;
  wouldShowOnCard: string | null;
  relevanceScore: number | null;
  matchTier: 'primary' | 'sector' | 'tangential' | 'unrelated' | null;
  matchedNaics: string[];
  relevanceReasons: string[];
  userSectors: string[];
  lessons: LessonRow[];
}

interface PreviewRow {
  seed: number;
  withQualityGate: boolean;
  insight: {
    quote: string;
    attribution: string;
    guestName: string | null;
    episodeNumber: number | null;
  } | null;
}

const TIER_STYLES: Record<string, string> = {
  good: 'bg-emerald-900/40 text-emerald-300 border-emerald-700',
  weak: 'bg-amber-900/40 text-amber-300 border-amber-700',
  reject: 'bg-rose-900/40 text-rose-300 border-rose-700',
};

const MATCH_STYLES: Record<string, string> = {
  primary: 'bg-emerald-900/50 text-emerald-200 border-emerald-600',
  sector: 'bg-blue-900/40 text-blue-200 border-blue-700',
  tangential: 'bg-amber-900/40 text-amber-200 border-amber-600',
  unrelated: 'bg-slate-800 text-slate-400 border-slate-600',
};

export default function PodcastHighlightsAdminPage() {
  const [password, setPassword] = useState('');
  const [authenticated, setAuthenticated] = useState(false);
  const [authError, setAuthError] = useState('');
  const [tab, setTab] = useState<Tab>('overview');

  const [stats, setStats] = useState<StatsPayload | null>(null);
  const [naics, setNaics] = useState('236220');
  const [showTangential, setShowTangential] = useState(false);
  const [sortHint, setSortHint] = useState<string | null>(null);
  const [episodes, setEpisodes] = useState<EpisodeSample[]>([]);
  const [loadingSample, setLoadingSample] = useState(false);
  const [previews, setPreviews] = useState<PreviewRow[]>([]);
  const [loadingPreview, setLoadingPreview] = useState(false);

  const apiBase = '/api/admin/podcast-highlights';

  const loadStats = useCallback(async () => {
    const res = await fetch(`${apiBase}?op=stats&password=${encodeURIComponent(password)}`);
    if (res.status === 401) { setAuthenticated(false); return null; }
    const data = await res.json();
    if (data.success) {
      setStats(data);
      return data;
    }
    return null;
  }, [password]);

  const loadSample = useCallback(async (random = false) => {
    setLoadingSample(true);
    try {
      const params = new URLSearchParams({
        op: 'sample',
        password,
        naics: naics.trim(),
        limit: '30',
      });
      if (random) params.set('random', '1');
      if (showTangential) params.set('tangential', '1');
      const res = await fetch(`${apiBase}?${params}`);
      const data = await res.json();
      if (data.success) {
        setEpisodes(data.episodes);
        setSortHint(data.sortedBy === 'relevance_score_desc'
          ? `Sorted by industry fit (min score ${data.minRelevanceShown || 0})`
          : random ? 'Random sample — not NAICS-sorted' : null);
      }
    } finally {
      setLoadingSample(false);
    }
  }, [password, naics, showTangential]);

  const loadPreview = useCallback(async () => {
    setLoadingPreview(true);
    try {
      const params = new URLSearchParams({
        op: 'preview',
        password,
        naics: naics.trim(),
      });
      const res = await fetch(`${apiBase}?${params}`);
      const data = await res.json();
      if (data.success) setPreviews(data.previews);
    } finally {
      setLoadingPreview(false);
    }
  }, [password, naics]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    const data = await loadStats();
    if (!data) {
      setAuthError('Wrong password or could not load stats');
      return;
    }
    setAuthenticated(true);
  };

  useEffect(() => {
    if (!authenticated || tab !== 'browse' || episodes.length) return;
    void loadSample(true);
  }, [authenticated, tab, episodes.length, loadSample]);

  if (!authenticated) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
        <form onSubmit={handleLogin} className="bg-slate-900 border border-slate-800 rounded-lg p-6 w-full max-w-md">
          <h1 className="text-xl font-semibold text-white mb-1">Podcast Highlight QA</h1>
          <p className="text-sm text-slate-400 mb-5">
            Review <code className="text-purple-300">key_lessons</code> quality before enabling guest quotes on Today&apos;s Intel.
            Production is <strong className="text-amber-300">OFF</strong> until you set <code className="text-slate-300">ENABLE_PODCAST_INSIGHTS=true</code>.
          </p>
          <label className="block text-sm text-slate-300 mb-1">Admin password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded text-white text-sm focus:border-emerald-500 focus:outline-none mb-3"
            autoFocus
          />
          {authError && <p className="text-rose-400 text-sm mb-3">{authError}</p>}
          <button type="submit" className="w-full px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium rounded">
            Review highlights
          </button>
        </form>
      </div>
    );
  }

  const q = stats?.quality;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-4 md:p-8 max-w-6xl mx-auto">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-white">Podcast Highlight Notes — Quality Review</h1>
        <p className="text-slate-400 text-sm mt-1">
          Founders-style guest takeaways from <code className="text-purple-300">podcast_episode_metadata.key_lessons</code>.
          Today&apos;s Intel integration is gated off until you approve quality here.
        </p>
        {stats && (
          <div className={`mt-3 text-sm px-3 py-2 rounded border ${stats.featureFlag.enableEnv ? 'border-emerald-700 bg-emerald-950/50 text-emerald-200' : 'border-amber-700 bg-amber-950/50 text-amber-200'}`}>
            Feature flag: {stats.featureFlag.enableEnv
              ? `ON (${stats.featureFlag.rolloutPercent}% rollout)`
              : 'OFF — users still see briefing AI / deterministic insights only'}
          </div>
        )}
      </header>

      <div className="flex gap-2 mb-6 flex-wrap">
        {(['overview', 'browse', 'preview'] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`px-4 py-2 rounded text-sm font-medium ${tab === t ? 'bg-purple-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}
          >
            {t === 'overview' ? 'Overview' : t === 'browse' ? 'Browse episodes' : 'Mindy preview'}
          </button>
        ))}
        <button type="button" onClick={() => void loadStats()} className="px-3 py-2 text-sm text-slate-400 hover:text-white ml-auto">
          Refresh stats
        </button>
      </div>

      {tab === 'overview' && stats && q && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              ['Extracted', stats.totals.extracted],
              ['With guest', stats.totals.withGuest],
              ['Has lessons', stats.totals.withLessons],
              ['Pending extract', stats.totals.pending],
            ].map(([label, val]) => (
              <div key={String(label)} className="bg-slate-900 border border-slate-800 rounded-lg p-4">
                <div className="text-2xl font-bold text-white">{val}</div>
                <div className="text-xs text-slate-400">{label}</div>
              </div>
            ))}
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-lg p-5">
            <h2 className="text-lg font-semibold mb-3">Lesson quality (all extracted episodes)</h2>
            <div className="flex gap-4 flex-wrap mb-4">
              <span className={`px-3 py-1 rounded border text-sm ${TIER_STYLES.good}`}>Good: {q.lessonTiers.good}</span>
              <span className={`px-3 py-1 rounded border text-sm ${TIER_STYLES.weak}`}>Weak: {q.lessonTiers.weak}</span>
              <span className={`px-3 py-1 rounded border text-sm ${TIER_STYLES.reject}`}>Reject: {q.lessonTiers.reject}</span>
              <span className="text-slate-300 text-sm self-center">
                <strong className="text-white">{q.goodPercent}%</strong> of {q.totalLessons} lessons rated good
              </span>
            </div>
            <p className="text-sm text-slate-300 leading-relaxed border-l-2 border-purple-500 pl-4">
              {stats.quality.recommendation}
            </p>
            <p className="text-xs text-slate-500 mt-3">
              Episodes with at least one &quot;good&quot; lesson: {q.episodesWithGood} · only weak: {q.episodesWithOnlyWeak}
            </p>
          </div>

          <div className="bg-slate-900/50 border border-dashed border-slate-700 rounded-lg p-4 text-sm text-slate-400">
            <strong className="text-slate-200">Ship checklist:</strong>
            <ol className="list-decimal ml-5 mt-2 space-y-1">
              <li>Browse tab — load your NAICS; list is sorted by <strong>industry fit</strong> (tangential CMMC-in-construction drops)</li>
              <li>Preview tab — confirm Mindy card picks look punchy (quality gate on)</li>
              <li>If weak % is high, re-run <code>node scripts/extract-podcast-metadata.js --force</code> on thin episodes</li>
              <li>Enable: <code>ENABLE_PODCAST_INSIGHTS=true</code> + <code>PODCAST_INSIGHTS_ROLLOUT_PERCENT=5</code> in Vercel</li>
            </ol>
          </div>
        </div>
      )}

      {tab === 'browse' && (
        <div>
          <div className="flex flex-wrap gap-2 mb-4 items-end">
            <div>
              <label className="text-xs text-slate-400 block mb-1">Filter NAICS (comma-separated)</label>
              <input
                value={naics}
                onChange={(e) => setNaics(e.target.value)}
                className="px-3 py-2 bg-slate-800 border border-slate-700 rounded text-white text-sm w-64"
                placeholder="236220, 237310"
              />
            </div>
            <label className="flex items-center gap-2 text-xs text-slate-400 pb-2">
              <input
                type="checkbox"
                checked={showTangential}
                onChange={(e) => setShowTangential(e.target.checked)}
                className="rounded"
              />
              Show tangential matches (&lt;22% fit)
            </label>
            <button
              type="button"
              onClick={() => void loadSample(false)}
              disabled={loadingSample}
              className="px-4 py-2 bg-purple-600 hover:bg-purple-500 rounded text-sm disabled:opacity-50"
            >
              {loadingSample ? 'Loading…' : 'Load by NAICS (sorted by fit)'}
            </button>
            <button
              type="button"
              onClick={() => void loadSample(true)}
              disabled={loadingSample}
              className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded text-sm disabled:opacity-50"
            >
              Random 30
            </button>
          </div>
          {sortHint && (
            <p className="text-xs text-purple-300 mb-3">{sortHint}</p>
          )}

          <div className="space-y-4">
            {episodes.map((ep) => (
              <article key={`${ep.episodeNumber}-${ep.episodeTitle}`} className="bg-slate-900 border border-slate-800 rounded-lg p-4">
                <div className="flex flex-wrap justify-between gap-2 mb-2">
                  <div>
                    {ep.relevanceScore != null && (
                      <span className={`text-xs px-2 py-0.5 rounded border mr-2 ${MATCH_STYLES[ep.matchTier || 'tangential'] || MATCH_STYLES.tangential}`}>
                        {ep.relevanceScore}% fit · {ep.matchTier}
                      </span>
                    )}
                    <span className={`text-xs px-2 py-0.5 rounded border mr-2 ${TIER_STYLES[ep.bestTier] || TIER_STYLES.weak}`}>
                      lesson {ep.bestTier}
                    </span>
                    <span className="text-white font-medium">
                      Ep {ep.episodeNumber ?? '?'} — {ep.guestName}
                      {ep.guestCompany ? ` (${ep.guestCompany})` : ''}
                    </span>
                  </div>
                  {ep.episodeUrl && (
                    <a href={ep.episodeUrl} target="_blank" rel="noreferrer" className="text-xs text-purple-400 hover:underline">
                      Listen ↗
                    </a>
                  )}
                </div>
                {ep.summary && <p className="text-sm text-slate-400 mb-3">{ep.summary}</p>}
                {ep.matchedNaics?.length > 0 && (
                  <p className="text-xs text-emerald-500/90 mb-1">Matches your profile: {ep.matchedNaics.join(', ')}</p>
                )}
                {ep.naicsMentioned?.length > 0 && (
                  <p className="text-xs text-slate-500 mb-2">All NAICS in episode: {ep.naicsMentioned.join(', ')}</p>
                )}
                {ep.relevanceReasons?.length > 0 && (
                  <p className="text-xs text-slate-500 mb-2">{ep.relevanceReasons.join(' · ')}</p>
                )}
                {ep.wouldShowOnCard && (
                  <div className="mb-3 p-3 rounded bg-gradient-to-r from-slate-800 to-purple-950 border border-purple-800/50">
                    <div className="text-[10px] uppercase tracking-wider text-purple-300 mb-1">Would show on Mindy card</div>
                    <p className="text-white font-serif italic">&ldquo;{ep.wouldShowOnCard}&rdquo;</p>
                  </div>
                )}
                <ul className="space-y-2">
                  {ep.lessons.map((l, i) => (
                    <li key={i} className="text-sm border-l-2 border-slate-700 pl-3">
                      <span className={`text-xs px-1.5 py-0.5 rounded border mr-2 ${TIER_STYLES[l.tier]}`}>{l.tier}</span>
                      <span className="text-slate-200">{l.text}</span>
                      {l.reasons.length > 0 && (
                        <span className="block text-xs text-slate-500 mt-0.5">{l.reasons.join(' · ')}</span>
                      )}
                    </li>
                  ))}
                </ul>
              </article>
            ))}
            {!loadingSample && episodes.length === 0 && (
              <p className="text-slate-500">No episodes — try another NAICS or Random 30.</p>
            )}
          </div>
        </div>
      )}

      {tab === 'preview' && (
        <div>
          <div className="flex flex-wrap gap-2 mb-4 items-end">
            <div>
              <label className="text-xs text-slate-400 block mb-1">Your NAICS profile (simulated)</label>
              <input
                value={naics}
                onChange={(e) => setNaics(e.target.value)}
                className="px-3 py-2 bg-slate-800 border border-slate-700 rounded text-white text-sm w-64"
              />
            </div>
            <button
              type="button"
              onClick={() => void loadPreview()}
              disabled={loadingPreview}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 rounded text-sm disabled:opacity-50"
            >
              {loadingPreview ? 'Running…' : 'Simulate 5 daily picks'}
            </button>
          </div>
          <p className="text-xs text-slate-500 mb-4">
            Compare <strong>ungated</strong> (fit score only) vs <strong>production</strong> (≥36% industry fit + targeted lesson gate).
          </p>
          <div className="grid md:grid-cols-2 gap-3">
            {previews.map((p, i) => (
              <div
                key={i}
                className={`p-4 rounded-lg border ${p.withQualityGate ? 'border-emerald-800 bg-emerald-950/30' : 'border-slate-700 bg-slate-900'}`}
              >
                <div className="text-xs text-slate-400 mb-2">
                  seed {p.seed} · {p.withQualityGate ? 'production (quality gate)' : 'no gate'}
                </div>
                {p.insight ? (
                  <>
                    <p className="text-white font-serif italic text-lg leading-snug">&ldquo;{p.insight.quote}&rdquo;</p>
                    <p className="text-xs text-purple-300 mt-2">{p.insight.attribution}</p>
                  </>
                ) : (
                  <p className="text-slate-500 text-sm">No match — quality gate may have filtered everything.</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
