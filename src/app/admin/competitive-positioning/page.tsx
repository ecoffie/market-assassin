'use client';

/**
 * Competitive positioning 2×2 — the Steve Jobs iPhone-2007 slide, for Mindy.
 *
 * Demo-day visual (Eric, Jun 26): competitors crammed in the weak quadrants,
 * Mindy ALONE in the winning corner. Axes: Completeness (single-purpose → all-in-
 * one) × Price (expensive → affordable). Winning quadrant = top-right (affordable
 * AND complete), the empty spot nobody else occupies — same as iPhone's top-right.
 *
 * Pure static visual (no data fetch) — screen-share it or screenshot for the deck.
 * Route: /admin/competitive-positioning
 */

interface Player {
  name: string;
  /** completeness 0-100 (left → right) */
  x: number;
  /** affordability 0-100 (bottom → top) */
  y: number;
  weakness: string;
  tone: 'mindy' | 'enterprise' | 'free' | 'point';
  size?: 'lg' | 'md' | 'sm';
}

const PLAYERS: Player[] = [
  { name: 'Mindy', x: 86, y: 86, weakness: 'All-in-one GovCon intelligence + AI — $149/mo', tone: 'mindy', size: 'lg' },
  // Complicated AND pricey — the enterprise quadrant (bottom-right).
  { name: 'GovWin IQ (Deltek)', x: 84, y: 10, weakness: '$$$$ enterprise (~$20K+/yr) · complex · sales-gated', tone: 'enterprise', size: 'md' },
  { name: 'Bloomberg Gov', x: 66, y: 17, weakness: 'Pricey (~$5K+/yr) · heavy · built for analysts', tone: 'enterprise', size: 'md' },
  { name: 'HigherGov', x: 52, y: 44, weakness: 'Cheaper, but narrower — data without the AI workflow', tone: 'point', size: 'sm' },
  // Cheap but limited (top-left) — the free gov sites + a point AI tool.
  { name: 'SAM.gov', x: 19, y: 82, weakness: 'Free, but raw — open opps only, no intelligence', tone: 'free', size: 'sm' },
  { name: 'USASpending.gov', x: 13, y: 73, weakness: 'Free, but backward-looking — past awards, no forward signal', tone: 'free', size: 'sm' },
  { name: 'ChatGPT', x: 33, y: 64, weakness: 'Cheap, but one trick — drafts text, knows no GovCon data', tone: 'point', size: 'sm' },
];

const TONE: Record<Player['tone'], { bg: string; ring: string; text: string }> = {
  mindy: { bg: 'bg-emerald-500', ring: 'ring-emerald-300/60', text: 'text-white' },
  enterprise: { bg: 'bg-rose-500/80', ring: 'ring-rose-300/30', text: 'text-white' },
  free: { bg: 'bg-slate-600', ring: 'ring-slate-400/30', text: 'text-white' },
  point: { bg: 'bg-amber-500/80', ring: 'ring-amber-300/30', text: 'text-white' },
};

const SIZE: Record<NonNullable<Player['size']>, string> = {
  lg: 'w-28 h-28 text-base',
  md: 'w-24 h-24 text-[12px]',
  sm: 'w-20 h-20 text-[11px]',
};

const SOLVES = [
  { gap: 'Pricey & complicated', who: 'GovWin · Bloomberg Gov', mindy: 'Enterprise-grade intel at $149/mo — no sales call, set up in minutes.' },
  { gap: 'Free but limited', who: 'SAM.gov · USASpending.gov', mindy: 'Joins, scores & enriches the raw gov data into ONE market view (599K-record Data Core).' },
  { gap: 'One-trick AI', who: 'ChatGPT', mindy: 'Drafts grounded in YOUR vault + live SAM/USASpending + a winning-proposal corpus — not generic text.' },
];

export default function CompetitivePositioningPage() {
  return (
    <div className="min-h-dvh bg-slate-950 px-6 py-8 text-slate-100">
      <div className="mx-auto max-w-5xl">
        <header className="mb-6">
          <h1 className="text-2xl font-black">Why Mindy — the GovCon tool landscape</h1>
          <p className="mt-1 text-sm text-slate-400">
            Everyone else forces a trade-off: powerful but pricey &amp; complex, or cheap but limited. Mindy is the only one in the winning corner — <span className="font-semibold text-emerald-300">complete AND affordable</span>.
          </p>
        </header>

        {/* ── 2×2 ─────────────────────────────────────────────────────────── */}
        <div className="relative mx-auto aspect-square w-full max-w-3xl rounded-2xl border border-slate-800 bg-gradient-to-br from-slate-900 to-slate-950 p-4">
          {/* winning-quadrant glow (top-right) */}
          <div className="pointer-events-none absolute right-4 top-4 h-1/2 w-1/2 rounded-tr-2xl bg-emerald-500/5" />

          {/* axes */}
          <div className="pointer-events-none absolute inset-x-4 top-1/2 h-px -translate-y-1/2 bg-slate-700/70" />
          <div className="pointer-events-none absolute inset-y-4 left-1/2 w-px -translate-x-1/2 bg-slate-700/70" />

          {/* axis labels */}
          <span className="absolute left-1/2 top-2 -translate-x-1/2 text-xs font-semibold uppercase tracking-wider text-slate-400">Affordable</span>
          <span className="absolute bottom-2 left-1/2 -translate-x-1/2 text-xs font-semibold uppercase tracking-wider text-slate-400">Expensive</span>
          <span className="absolute left-2 top-1/2 -translate-y-1/2 -rotate-90 text-xs font-semibold uppercase tracking-wider text-slate-400">Single-purpose</span>
          <span className="absolute right-2 top-1/2 -translate-y-1/2 rotate-90 text-xs font-semibold uppercase tracking-wider text-slate-400">All-in-one</span>

          {/* players */}
          {PLAYERS.map((p) => {
            const tone = TONE[p.tone];
            const size = SIZE[p.size || 'sm'];
            return (
              <div
                key={p.name}
                className="absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center"
                style={{ left: `${4 + (p.x / 100) * 92}%`, top: `${4 + ((100 - p.y) / 100) * 92}%` }}
              >
                <div
                  className={`flex ${size} items-center justify-center rounded-full ${tone.bg} ${tone.text} text-center font-bold leading-tight ring-4 ${tone.ring} ${p.tone === 'mindy' ? 'shadow-2xl shadow-emerald-500/40' : 'shadow-lg'} px-2`}
                >
                  {p.name}
                </div>
                <div className={`mt-1 max-w-[150px] text-center text-[10px] leading-tight ${p.tone === 'mindy' ? 'text-emerald-200' : 'text-slate-400'}`}>
                  {p.weakness}
                </div>
              </div>
            );
          })}
        </div>

        {/* ── how Mindy solves each gap ───────────────────────────────────── */}
        <div className="mt-8">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-slate-400">How Mindy solves each gap</h2>
          <div className="grid gap-3 sm:grid-cols-3">
            {SOLVES.map((s) => (
              <div key={s.gap} className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-rose-300/80">{s.gap}</p>
                <p className="mt-0.5 text-[11px] text-slate-500">{s.who}</p>
                <p className="mt-2 text-sm text-slate-200"><span className="font-semibold text-emerald-300">Mindy →</span> {s.mindy}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
