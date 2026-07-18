/**
 * /up-for-grabs — federal contracts expiring soon (recompete windows opening). The proven
 * "did you see this $X contract coming up for grabs" teaser format (news-as-source).
 *
 * PUBLIC-SAFE: this is snapshot data from the public API (who holds it now, ceiling, expiry).
 * It is NOT the moat — the moat is the TRACKED DIFFERENCE over time (what slipped/grew), which
 * lives in recompete_changes and is NEVER surfaced here. Reads cheap via the shared
 * queryExpiringContracts (same lib the in-app panel + MCP use). Grounded, citable.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import ShareButton from '@/components/ShareButton';
import { queryExpiringContracts, type ExpiringContract } from '@/lib/recompete/query';
import { formatCompanyName as fmtName } from '@/lib/format-name';
import { formatMoneyCompact as fmtMoney } from '@/lib/format-money';

const SITE_URL = 'https://getmindy.ai';
export const revalidate = 86400; // 1d — the expiry window shifts slowly

export const metadata: Metadata = {
  title: 'Up For Grabs — Federal Contracts Expiring Soon | Mindy',
  description:
    'The biggest federal contracts expiring soon — the incumbent, the ceiling, and when the recompete window opens. Real, verifiable data on the work about to come up for grabs, straight from USASpending.',
  alternates: { canonical: `${SITE_URL}/up-for-grabs` },
  openGraph: {
    title: 'Up For Grabs — Federal Contracts Expiring Soon',
    description: 'The biggest federal contracts about to come up for grabs — incumbent, ceiling, and recompete timing. Real and verifiable.',
    url: `${SITE_URL}/up-for-grabs`,
    type: 'website',
    siteName: 'Mindy',
  },
  twitter: { card: 'summary_large_image', title: 'Up For Grabs — Federal Contracts Expiring Soon', description: 'The biggest federal contracts about to come up for grabs. Real and verifiable.' },
};

function monthsUntil(dateStr: string | null): number {
  if (!dateStr) return 0;
  const end = new Date(dateStr);
  const now = new Date();
  const m = (end.getFullYear() - now.getFullYear()) * 12 + (end.getMonth() - now.getMonth());
  return Math.max(0, m);
}

function fmtDate(d: string | null): string {
  if (!d) return '';
  try {
    return new Date(d).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
  } catch {
    return d;
  }
}

const LIKELIHOOD: Record<string, { label: string; cls: string }> = {
  high: { label: 'Likely recompete', cls: 'bg-emerald-400/10 text-emerald-300' },
  medium: { label: 'Possible recompete', cls: 'bg-amber-400/10 text-amber-300' },
  low: { label: 'Uncertain', cls: 'bg-slate-700/40 text-slate-400' },
};

function sizeOf(c: ExpiringContract): number {
  return Number(c.potential_total_value ?? c.total_obligation ?? 0);
}

export default async function UpForGrabsPage() {
  // Biggest contracts expiring within 12 months. minValue keeps it to real, sizable work;
  // then sort by ceiling so the headliners lead. Snapshot only — no history.
  const { contracts } = await queryExpiringContracts({ monthsWindow: 12, minValue: 10_000_000, limit: 200 }).catch(() => ({ contracts: [] as ExpiringContract[] }));
  const top = [...contracts].sort((a, b) => sizeOf(b) - sizeOf(a)).slice(0, 40);
  const total = top.reduce((s, c) => s + sizeOf(c), 0);

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: 'Federal Contracts Up For Grabs',
    description: 'The biggest federal contracts expiring soon.',
    numberOfItems: top.length,
    itemListElement: top.slice(0, 25).map((c, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      item: { '@type': 'GovernmentService', name: `${fmtMoney(sizeOf(c))} — ${fmtName(c.incumbent_name || '')}`, url: `${SITE_URL}/awards/${c.contract_id}` },
    })),
  };

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <div className="mx-auto max-w-5xl px-6 pt-6 text-sm text-slate-400">
        <Link href="/" className="hover:text-purple-400">Home</Link>
        <span className="mx-2">/</span>
        <Link href="/discover" className="hover:text-purple-400">Discover</Link>
        <span className="mx-2">/</span>
        <span className="text-slate-300">Up For Grabs</span>
      </div>

      {/* Hero */}
      <section className="mx-auto max-w-5xl px-6 pt-6 pb-8">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-purple-400">Discover · Expiring soon</p>
        <h1 className="mt-3 text-4xl md:text-5xl font-bold tracking-tight">⏳ Up for grabs</h1>
        <p className="mt-4 max-w-2xl text-lg text-slate-300">
          The government has to re-buy this work. Here are the biggest federal contracts expiring soon — the
          incumbent holding it now, the ceiling, and when the recompete window opens. Every one is real.
        </p>
        {top.length > 0 && (
          <div className="mt-6 flex flex-wrap items-center gap-6">
            <div>
              <div className="text-3xl font-extrabold text-purple-300 tabular-nums">{fmtMoney(total)}</div>
              <div className="text-xs uppercase tracking-wider text-slate-500">Coming up for grabs · top {top.length}, next 12 months</div>
            </div>
            <ShareButton url={`${SITE_URL}/up-for-grabs`} title="Federal contracts up for grabs — the biggest recompetes coming soon" />
          </div>
        )}
      </section>

      {top.length === 0 ? (
        <section className="mx-auto max-w-5xl px-6 pb-16">
          <div className="rounded-xl border border-slate-800 bg-slate-900 p-8 text-slate-400">Loading the latest expiring contracts…</div>
        </section>
      ) : (
        <section className="mx-auto max-w-5xl px-6 pb-10">
          <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 divide-y divide-slate-800">
            {top.map((c) => {
              const m = monthsUntil(c.period_of_performance_current_end);
              const like = c.recompete_likelihood ? LIKELIHOOD[c.recompete_likelihood] : null;
              return (
                <Link key={c.contract_id} href={`/awards/${c.contract_id}`} className="group flex items-center gap-4 px-5 py-4 hover:bg-slate-800/50 transition-colors">
                  <div className="w-24 shrink-0 text-2xl font-extrabold tabular-nums text-purple-300">{fmtMoney(sizeOf(c))}</div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold text-white">{fmtName(c.incumbent_name || 'Unknown incumbent')}</div>
                    <div className="truncate text-sm text-slate-400">
                      {c.awarding_agency}{c.naics_description ? ` · ${c.naics_description}` : ''}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                      <span className={`rounded px-2 py-0.5 font-semibold ${m <= 6 ? 'bg-rose-400/10 text-rose-300' : 'bg-slate-700/40 text-slate-300'}`}>
                        {m <= 0 ? 'Expiring now' : `Expires in ${m} mo · ${fmtDate(c.period_of_performance_current_end)}`}
                      </span>
                      {like && <span className={`rounded px-2 py-0.5 font-semibold ${like.cls}`}>{like.label}</span>}
                      {c.set_aside_type && <span className="rounded px-2 py-0.5 bg-slate-800 text-slate-400">{c.set_aside_type}</span>}
                    </div>
                  </div>
                  <span className="hidden sm:inline-block shrink-0 text-xs font-semibold text-purple-400 group-hover:text-purple-300">See the record →</span>
                </Link>
              );
            })}
          </div>
          <p className="mt-4 text-xs text-slate-500">
            Source: USAspending.gov — current contract data. A recompete typically posts 6–18 months before a
            contract ends; expiry dates are as reported. Click any row for the official record.
          </p>
        </section>
      )}

      {/* CTA */}
      <section className="mx-auto max-w-5xl px-6 pb-16">
        <div className="rounded-2xl border border-purple-500/30 bg-gradient-to-br from-purple-900/40 to-slate-900 p-8 text-center">
          <h2 className="text-2xl font-bold">This is a snapshot. Mindy tracks 129,000+ recompetes — and tells you 12 months early.</h2>
          <p className="mt-3 mb-6 max-w-2xl mx-auto text-slate-300">
            Get alerts the moment a contract in your market is about to come up for grabs, with the incumbent and
            the whole history. Start free.
          </p>
          <Link href="/signup" className="inline-flex rounded-xl bg-purple-600 px-6 py-3 font-semibold text-white hover:bg-purple-500 shadow-lg shadow-purple-500/20">
            Start free →
          </Link>
        </div>
      </section>
    </main>
  );
}
