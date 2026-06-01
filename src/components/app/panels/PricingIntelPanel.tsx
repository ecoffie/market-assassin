'use client';

/**
 * Pricing Intel Panel — Estimating section
 *
 * Standalone landing page for the new Estimating sidebar group. Wraps
 * /api/app/pricing-intel (which itself wraps fetchPricingIntel from
 * src/lib/utils/calc-rates.ts) so we don't have to re-run the full
 * /api/reports/generate-all path that builds 10 reports.
 *
 * Pro-gated. Free users see an upgrade teaser instead of data.
 *
 * Data shape (PricingIntelData):
 *   - laborCategories[] — top 25 categories with median / p25 / p75
 *   - businessSizeComparison — small vs large median + gap%
 *   - rateDistribution[] — bucketed counts (e.g. $50-75/hr: 14 records)
 *   - priceToWinGuidance — aggressive/competitive/premium rate targets
 *   - topVendors[] — 10 vendors with avg rate + small/large flag
 *
 * v1 just shows tables. Phase 2 will add Recharts histograms.
 */
import { useCallback, useEffect, useState } from 'react';
import type { AppTier } from '../UnifiedSidebar';
import { useAppTracker } from '../track';
import { useToast } from '../Toast';

interface LaborCategory {
  category: string;
  recordCount: number;
  median: number;
  percentile25: number;
  percentile75: number;
  min: number;
  max: number;
  avg: number;
  nextYearMedian: number | null;
}

interface PricingData {
  laborCategories: LaborCategory[];
  businessSizeComparison: {
    smallBusiness: { median: number; count: number; avg: number };
    largeBusiness: { median: number; count: number; avg: number };
    gapPercent: number;
  };
  rateDistribution: Array<{ range: string; count: number }>;
  priceToWinGuidance: {
    aggressiveRate: number;
    competitiveRate: number;
    premiumRate: number;
  };
  topVendors: Array<{
    name: string;
    avgRate: number;
    recordCount: number;
    businessSize: string;
  }>;
  naicsCode: string;
  naicsDescription: string;
  totalRecordsAnalyzed: number;
}

interface Props {
  email: string | null;
  tier: AppTier;
}

const fmtMoney = (n: number) => `$${n.toFixed(2)}`;

export default function PricingIntelPanel({ email, tier }: Props) {
  const isFree = tier === 'free';
  const track = useAppTracker(email);
  const { showToast } = useToast();

  const [naicsInput, setNaicsInput] = useState('');
  const [data, setData] = useState<PricingData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [upgradeTeaser, setUpgradeTeaser] = useState<{ note: string; sample_categories: string[] } | null>(null);

  // Pre-fill the NAICS input from the user's saved profile so they
  // can run the report on their primary code with a single click.
  useEffect(() => {
    if (!email) return;
    fetch(`/api/app/workspace?email=${encodeURIComponent(email)}`)
      .then(r => r.ok ? r.json() : null)
      .then(profile => {
        const first = profile?.user?.naics_codes?.[0] || profile?.profile?.naics_codes?.[0];
        if (first && !naicsInput) setNaicsInput(String(first));
      })
      .catch(() => { /* profile fetch is best-effort */ });
  // naicsInput intentionally not in deps — we only want this to fire
  // once when email arrives, not every keystroke.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [email]);

  const runQuery = useCallback(async () => {
    if (!email) {
      showToast({ message: 'Sign in before running pricing intel', variant: 'error' });
      return;
    }
    if (!naicsInput.trim()) {
      showToast({ message: 'Enter a NAICS code', variant: 'error' });
      return;
    }

    setLoading(true);
    setError(null);
    setUpgradeTeaser(null);
    setData(null);

    try {
      const res = await fetch(
        `/api/app/pricing-intel?email=${encodeURIComponent(email)}&naics=${encodeURIComponent(naicsInput.trim())}`
      );
      const payload = await res.json().catch(() => null);

      if (res.status === 402 && payload?.upgrade_required) {
        setUpgradeTeaser(payload.teaser);
        return;
      }
      if (!res.ok || !payload?.success) {
        setError(payload?.message || payload?.error || 'Could not load pricing intel');
        return;
      }

      setData(payload.data as PricingData);
      track('tool_use', 'pricing_intel', {
        action: 'query',
        naics: naicsInput.trim(),
        categories_returned: payload.data?.laborCategories?.length || 0,
      });
    } catch (err) {
      console.error('[PricingIntelPanel] error:', err);
      setError('Network error — could not load pricing intel');
    } finally {
      setLoading(false);
    }
  }, [email, naicsInput, showToast, track]);

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Pricing Intel</h1>
        <p className="text-sm text-slate-400 mt-1">
          What the government actually pays for labor in your industry — so you can price a bid to win.
        </p>
      </div>

      {/* Plain-language "what is this / how to use it" panel. Users said
          the tool was confusing — it jumped straight to a NAICS box with
          no explanation of what it does or what the numbers mean. */}
      <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4 text-sm text-slate-300 space-y-2">
        <p>
          <span className="font-semibold text-white">What it does:</span> enter your industry
          code (NAICS) and Mindy pulls real hourly labor rates the government has paid — by job
          title — from awarded contracts (GSA CALC+ data).
        </p>
        <p>
          <span className="font-semibold text-white">How to use it:</span> when you&apos;re building a
          bid, check the rate for each role you&apos;ll staff. The three targets below tell you where
          to land:
        </p>
        <ul className="list-disc list-inside text-slate-400 ml-1">
          <li><span className="text-amber-300 font-medium">Aggressive</span> — price low to win on cost (thin margin).</li>
          <li><span className="text-emerald-300 font-medium">Competitive</span> — the market median; a safe, defensible rate.</li>
          <li><span className="text-purple-300 font-medium">Premium</span> — charge more when you bring differentiated value.</li>
        </ul>
      </div>

      {/* Query bar — NAICS in, "Run" out. Defaults to user's primary
          NAICS from their profile (fetched on mount). */}
      <div className="flex items-center gap-3 bg-slate-900/60 border border-slate-800 rounded-lg p-3">
        <label className="text-sm text-slate-400">NAICS Code:</label>
        <input
          type="text"
          value={naicsInput}
          onChange={(e) => setNaicsInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') runQuery(); }}
          placeholder="541512"
          className="flex-1 max-w-xs rounded bg-slate-950 border border-slate-700 px-3 py-1.5 text-sm text-white outline-none focus:border-emerald-500"
        />
        <button
          type="button"
          onClick={runQuery}
          disabled={loading}
          className="px-4 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 disabled:cursor-not-allowed text-sm font-medium text-white"
        >
          {loading ? 'Running…' : 'Run Pricing Intel'}
        </button>
      </div>

      {/* Free-tier upgrade teaser. Renders only when the API replies
          402, never breaks the page. */}
      {upgradeTeaser && (
        <div className="bg-gradient-to-br from-purple-900/40 to-purple-800/20 border border-purple-500/40 rounded-lg p-5">
          <h3 className="text-lg font-bold text-white mb-2">💵 Pricing Intel is a Mindy Pro feature</h3>
          <p className="text-sm text-slate-300 mb-3">{upgradeTeaser.note}</p>
          <div className="text-xs text-slate-400 mb-4">
            Sample categories Pro would show:
            <ul className="mt-1 list-disc list-inside text-slate-300">
              {upgradeTeaser.sample_categories.map(c => <li key={c}>{c}</li>)}
            </ul>
          </div>
          <a
            href="/market-intelligence"
            className="inline-block px-4 py-2 rounded bg-purple-600 hover:bg-purple-500 text-white text-sm font-medium"
          >
            Upgrade to Mindy Pro
          </a>
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-300">
          {error}
        </div>
      )}

      {/* Empty state when Pro user hasn't run anything yet */}
      {!data && !loading && !error && !upgradeTeaser && !isFree && (
        <div className="rounded-lg border border-slate-800 bg-slate-900/30 p-8 text-center">
          <p className="text-slate-300 mb-1">Enter a NAICS code and click Run to see pricing data.</p>
          <p className="text-xs text-slate-500">Examples: 541512 (Computer Systems Design), 541611 (Management Consulting), 541330 (Engineering Services)</p>
        </div>
      )}

      {data && (
        <>
          {/* Headline stats: 4 cards summarizing the report */}
          <div>
            <h2 className="text-lg font-semibold text-white mb-3">
              {data.naicsCode} — {data.naicsDescription}
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <StatCard
                label="Records analyzed"
                value={data.totalRecordsAnalyzed.toLocaleString()}
                hint={`across ${data.laborCategories.length} labor categories`}
              />
              <StatCard
                label="Competitive bid rate"
                value={fmtMoney(data.priceToWinGuidance.competitiveRate)}
                hint="midpoint price-to-win"
              />
              <StatCard
                label="Small vs. Large gap"
                value={`${data.businessSizeComparison.gapPercent > 0 ? '+' : ''}${data.businessSizeComparison.gapPercent.toFixed(1)}%`}
                hint={data.businessSizeComparison.gapPercent > 0 ? 'small biz wins on rate' : 'large biz wins on rate'}
              />
              <StatCard
                label="Top vendors found"
                value={String(data.topVendors.length)}
                hint="ranked by record count"
              />
            </div>
          </div>

          {/* Price-to-win row — 3 target rates side by side */}
          <div>
          <h3 className="text-sm font-semibold text-white mb-2">
            Your price-to-win targets <span className="font-normal text-slate-500">— blended hourly labor rate</span>
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <RateTile
              label="Aggressive"
              rate={data.priceToWinGuidance.aggressiveRate}
              hint="undercut to win on price"
              tone="amber"
            />
            <RateTile
              label="Competitive"
              rate={data.priceToWinGuidance.competitiveRate}
              hint="market median"
              tone="emerald"
            />
            <RateTile
              label="Premium"
              rate={data.priceToWinGuidance.premiumRate}
              hint="differentiated value"
              tone="purple"
            />
          </div>
          </div>

          {/* Labor categories — the meat of the report. Sortable later. */}
          <div className="rounded-lg border border-slate-800 bg-slate-900/40 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-white">Labor Categories</h3>
              <span className="text-xs text-slate-500">{data.laborCategories.length} shown · sorted by record count</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-900/60 text-xs text-slate-500 uppercase">
                  <tr>
                    <th className="text-left px-4 py-2 font-medium">Category</th>
                    <th className="text-right px-4 py-2 font-medium">Records</th>
                    <th className="text-right px-4 py-2 font-medium">25th %ile</th>
                    <th className="text-right px-4 py-2 font-medium">Median</th>
                    <th className="text-right px-4 py-2 font-medium">75th %ile</th>
                  </tr>
                </thead>
                <tbody className="text-slate-300">
                  {data.laborCategories.map(cat => (
                    <tr key={cat.category} className="border-t border-slate-800/60 hover:bg-slate-800/30">
                      <td className="px-4 py-2 font-medium text-slate-200">{cat.category}</td>
                      <td className="text-right px-4 py-2 text-slate-400">{cat.recordCount.toLocaleString()}</td>
                      <td className="text-right px-4 py-2">{fmtMoney(cat.percentile25)}</td>
                      <td className="text-right px-4 py-2 text-emerald-400 font-semibold">{fmtMoney(cat.median)}</td>
                      <td className="text-right px-4 py-2">{fmtMoney(cat.percentile75)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Top vendors — quick view of who's competing in this NAICS */}
          {data.topVendors.length > 0 && (
            <div className="rounded-lg border border-slate-800 bg-slate-900/40 overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-800">
                <h3 className="text-sm font-semibold text-white">Top Vendors</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-900/60 text-xs text-slate-500 uppercase">
                    <tr>
                      <th className="text-left px-4 py-2 font-medium">Vendor</th>
                      <th className="text-left px-4 py-2 font-medium">Size</th>
                      <th className="text-right px-4 py-2 font-medium">Avg Rate</th>
                      <th className="text-right px-4 py-2 font-medium">Records</th>
                    </tr>
                  </thead>
                  <tbody className="text-slate-300">
                    {data.topVendors.map(v => (
                      <tr key={v.name} className="border-t border-slate-800/60">
                        <td className="px-4 py-2 font-medium text-slate-200">{v.name}</td>
                        <td className="px-4 py-2 text-slate-400">{v.businessSize}</td>
                        <td className="text-right px-4 py-2">{fmtMoney(v.avgRate)}</td>
                        <td className="text-right px-4 py-2 text-slate-400">{v.recordCount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
      <div className="text-xs uppercase tracking-wider text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-bold text-white">{value}</div>
      {hint && <div className="mt-1 text-xs text-slate-500">{hint}</div>}
    </div>
  );
}

function RateTile({
  label,
  rate,
  hint,
  tone,
}: {
  label: string;
  rate: number;
  hint: string;
  tone: 'amber' | 'emerald' | 'purple';
}) {
  // Tone determines accent color only — same shape across all tiles.
  const accent =
    tone === 'amber' ? 'border-amber-500/40 text-amber-400'
    : tone === 'emerald' ? 'border-emerald-500/40 text-emerald-400'
    : 'border-purple-500/40 text-purple-400';
  return (
    <div className={`rounded-lg border bg-slate-900/40 p-4 ${accent.split(' ')[0]}`}>
      <div className={`text-xs font-semibold uppercase tracking-wider ${accent.split(' ')[1]}`}>{label}</div>
      <div className="mt-1 text-3xl font-bold text-white">{fmtMoney(rate)}</div>
      <div className="mt-1 text-xs text-slate-500">{hint}/hr · {hint}</div>
    </div>
  );
}
