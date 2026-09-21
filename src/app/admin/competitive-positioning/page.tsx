'use client';

/**
 * Competitive positioning 2×2 — the Steve Jobs iPhone-2007 slide, for Mindy.
 *
 * Demo-day visual (Eric, Jun 26). NON-PRICE axes by design — we don't win on price,
 * we win like the iPhone did: SMART (all-in-one) × EASY TO USE. Competitors cram
 * the weak quadrants; Mindy is alone top-right (all-in-one AND simple).
 *   X: Single-purpose → All-in-one   ·   Y: Complicated → Easy to use
 *
 * Pure static visual — screen-share or screenshot for the deck.
 * Route: /admin/competitive-positioning
 */

interface Player {
  name: string;
  /** completeness / all-in-one 0-100 (left → right) */
  x: number;
  /** ease of use 0-100 (bottom → top) */
  y: number;
  weakness: string;
  tone: 'mindy' | 'enterprise' | 'free' | 'point';
  size?: 'lg' | 'md' | 'sm';
}

const PLAYERS: Player[] = [
  { name: 'Mindy', x: 88, y: 88, weakness: 'All-in-one — and simple as a chat', tone: 'mindy', size: 'lg' },

  // Powerful but COMPLICATED — the enterprise cluster (bottom-right).
  { name: 'Unanet', x: 84, y: 10, weakness: 'ERP/CRM — broad, but implementation-heavy', tone: 'enterprise', size: 'md' },
  { name: 'GovWin IQ (Deltek)', x: 80, y: 16, weakness: 'Deep data, but analyst-complex + sales-gated', tone: 'enterprise', size: 'md' },
  { name: 'Bloomberg Gov', x: 64, y: 22, weakness: 'Broad, but built for analysts', tone: 'enterprise', size: 'sm' },
  { name: 'GovDash', x: 76, y: 46, weakness: 'Capable AI suite — but enterprise / sales-gated', tone: 'enterprise', size: 'md' },

  // Easy but SINGLE-PURPOSE (top-left) — point tools.
  { name: 'ChatGPT', x: 24, y: 84, weakness: 'Easy, but one trick — knows no GovCon data', tone: 'point', size: 'sm' },
  { name: 'EZGovOpps', x: 34, y: 58, weakness: 'Opportunity search — stops at discovery', tone: 'point', size: 'sm' },
  { name: 'BidSpeed', x: 46, y: 50, weakness: 'Bid intel only — partial workflow', tone: 'point', size: 'sm' },

  // Single-purpose AND clunky (bottom-left) — the free gov sites.
  { name: 'SAM.gov', x: 18, y: 36, weakness: 'Raw open opps — clunky, no intelligence', tone: 'free', size: 'sm' },
  { name: 'USASpending.gov', x: 13, y: 28, weakness: 'Backward-looking — analyst-only, no workflow', tone: 'free', size: 'sm' },
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
  { gap: 'Powerful but complicated', who: 'GovWin · Bloomberg · Unanet · GovDash', mindy: 'Same depth — but you just ask a question. No analyst training, no sales-gated onboarding.' },
  { gap: 'Easy but single-purpose', who: 'ChatGPT · EZGovOpps · BidSpeed', mindy: 'One tool for the whole journey — discover, analyze, track, and draft — grounded in real GovCon data.' },
  { gap: 'Free but raw', who: 'SAM.gov · USASpending.gov', mindy: 'Turns the raw government data into answers — joined, scored, and explained across one market.' },
];

export default function CompetitivePositioningPage() {
  return (
    <div className="min-h-dvh bg-ground-deep px-6 py-8 text-slate-100">
      <div className="mx-auto max-w-5xl">
        <header className="mb-6">
          <h1 className="text-2xl font-black">Why Mindy — the GovCon tool landscape</h1>
          <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-faint">Static positioning deck · competitor figures as of Jun 2026 (verify before citing externally)</p>
          <p className="mt-1 text-sm text-muted">
            Everyone else forces a trade-off: powerful but complicated, or simple but single-purpose. Mindy is the only one in the winning corner — <span className="font-semibold text-emerald-300">all-in-one AND simple</span>.
          </p>
        </header>

        {/* ── 2×2 ─────────────────────────────────────────────────────────── */}
        <div className="relative mx-auto aspect-square w-full max-w-3xl rounded-2xl border border-surface bg-gradient-to-br from-slate-900 to-slate-950 p-4">
          {/* winning-quadrant glow (top-right) */}
          <div className="pointer-events-none absolute right-4 top-4 h-1/2 w-1/2 rounded-tr-2xl bg-emerald-500/5" />

          {/* axes */}
          <div className="pointer-events-none absolute inset-x-4 top-1/2 h-px -translate-y-1/2 bg-input/70" />
          <div className="pointer-events-none absolute inset-y-4 left-1/2 w-px -translate-x-1/2 bg-input/70" />

          {/* axis labels */}
          <span className="absolute left-1/2 top-2 -translate-x-1/2 text-xs font-semibold uppercase tracking-wider text-muted">Easy to use</span>
          <span className="absolute bottom-2 left-1/2 -translate-x-1/2 text-xs font-semibold uppercase tracking-wider text-muted">Complicated</span>
          <span className="absolute left-2 top-1/2 -translate-y-1/2 -rotate-90 text-xs font-semibold uppercase tracking-wider text-muted">Single-purpose</span>
          <span className="absolute right-2 top-1/2 -translate-y-1/2 rotate-90 text-xs font-semibold uppercase tracking-wider text-muted">All-in-one</span>

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
                <div className={`mt-1 max-w-[150px] text-center text-[10px] leading-tight ${p.tone === 'mindy' ? 'text-emerald-200' : 'text-muted'}`}>
                  {p.weakness}
                </div>
              </div>
            );
          })}
        </div>

        {/* ── how Mindy solves each gap ───────────────────────────────────── */}
        <div className="mt-8">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-muted">How Mindy solves each gap</h2>
          <div className="grid gap-3 sm:grid-cols-3">
            {SOLVES.map((s) => (
              <div key={s.gap} className="rounded-xl border border-surface bg-ground/60 p-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-rose-300/80">{s.gap}</p>
                <p className="mt-0.5 text-[11px] text-faint">{s.who}</p>
                <p className="mt-2 text-sm text-slate-200"><span className="font-semibold text-emerald-300">Mindy →</span> {s.mindy}</p>
              </div>
            ))}
          </div>
          <p className="mt-4 text-[11px] text-faint">
            Note: Govology is training/education, not an operating platform — different category, intentionally off the map.
          </p>
        </div>

        {/* ── vs GovDash — the only real contractor-side AI competitor ─────── */}
        <div className="mt-8 rounded-xl border border-rose-500/20 bg-gradient-to-br from-slate-900 to-slate-950 p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm font-bold uppercase tracking-wider text-ink-soft">The one to know: GovDash</h2>
            <span className="text-[11px] text-faint">YC · ~$42M raised · enterprise / sales-gated</span>
          </div>
          <p className="mt-2 text-sm text-muted">
            The closest AI-native competitor — strong, funded, built for proposal shops and primes. We don&rsquo;t out-enterprise a $42M company; we win the lane they price out of, on things they can&rsquo;t copy.
          </p>

          {/* The frame: in the AI era, software is replicable — the moat is brand. */}
          <div className="mt-4 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-center">
            <p className="text-[11px] uppercase tracking-wider text-emerald-300/80">In the AI era, anyone can replicate the software</p>
            <p className="mt-0.5 text-lg font-black text-white">The moat is <span className="text-emerald-300">Brand · Attention · Distribution</span></p>
            <p className="text-[12px] text-muted">…and that&rsquo;s exactly what GovCon Giants is. A $42M feature factory can&rsquo;t buy it.</p>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/5 p-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-emerald-300">The moat: Brand · Attention · Distribution</p>
              <ul className="mt-1.5 space-y-1 text-[13px] text-slate-200">
                <li>• 8 yrs of teaching + 743 interviews — Mindy <span className="font-semibold">teaches</span> while it works</li>
                <li>• The GovCon Giants audience — distribution money can&rsquo;t buy fast</li>
                <li>• The coach brand, not just a workflow tool</li>
              </ul>
            </div>
            <div className="rounded-lg border border-hairline/50 bg-surface/30 p-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted">Live demo contrast (true today)</p>
              <ul className="mt-1.5 space-y-1 text-[13px] text-ink-soft">
                <li>• <span className="font-semibold">Arrives full</span> — GovDash makes you upload your company first; Mindy already knows your market at login</li>
                <li>• <span className="font-semibold">Self-serve</span> — sign up &amp; go vs &ldquo;submit a form&rdquo; + onboarding</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
