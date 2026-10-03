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
import { contractScope } from '@/lib/discover/scope';
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
  high: { label: 'Likely recompete', cls: 'bg-(--mp-ok-bg) text-(--mp-ok)' },
  medium: { label: 'Possible recompete', cls: 'bg-(--mp-warn-bg) text-(--mp-warn)' },
  low: { label: 'Uncertain', cls: 'bg-(--mp-wash) text-(--mp-muted)' },
};

function sizeOf(c: ExpiringContract): number {
  return Number(c.potential_total_value ?? c.total_obligation ?? 0);
}

export default async function UpForGrabsPage() {
  // The BIGGEST contracts across the whole 12-month window (orderBy:'value' — not the
  // soonest-200, which were all "expiring now"). Then spread them: cap ~8 per 2-month
  // bucket so the list shows a timeline, not a pile of same-month expirations. Snapshot
  // only — no history.
  const { contracts } = await queryExpiringContracts({ monthsWindow: 12, minValue: 10_000_000, limit: 200, orderBy: 'value' }).catch(() => ({ contracts: [] as ExpiringContract[] }));
  const perBucket = new Map<number, number>();
  const spread: ExpiringContract[] = [];
  for (const c of [...contracts].sort((a, b) => sizeOf(b) - sizeOf(a))) {
    const bucket = Math.min(5, Math.floor(monthsUntil(c.period_of_performance_current_end) / 2)); // 0..5 over 12mo
    const n = perBucket.get(bucket) ?? 0;
    if (n >= 8) continue;
    perBucket.set(bucket, n + 1);
    spread.push(c);
    if (spread.length >= 40) break;
  }
  // Display as a timeline: soonest → furthest, so the countdown badges vary.
  const top = spread.sort((a, b) => monthsUntil(a.period_of_performance_current_end) - monthsUntil(b.period_of_performance_current_end));
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
      item: { '@type': 'GovernmentService', name: `${fmtMoney(sizeOf(c))} — ${fmtName(c.incumbent_name || '')}`, url: `https://www.usaspending.gov/award/${c.contract_id}` },
    })),
  };

  return (
    <main className="bg-(--mp-paper) text-(--mp-ink)">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <div className="mx-auto max-w-5xl px-6 pt-6 text-sm text-(--mp-muted)">
        <Link href="/" className="hover:text-(--mp-navy-hover)">Home</Link>
        <span className="mx-2">/</span>
        <Link href="/discover" className="hover:text-(--mp-navy-hover)">Discover</Link>
        <span className="mx-2">/</span>
        <span className="text-(--mp-body)">Up For Grabs</span>
      </div>

      {/* Hero */}
      <section className="mx-auto max-w-5xl px-6 pt-6 pb-8">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-(--mp-accent)">Discover · Expiring soon</p>
        <h1 className="mt-3 text-4xl md:text-5xl font-bold tracking-tight font-(family-name:--mp-font-serif)">⏳ Up for grabs</h1>
        <p className="mt-4 max-w-2xl text-lg text-(--mp-body)">
          The government has to re-buy this work. Here are the biggest federal contracts expiring soon — the
          incumbent holding it now, the ceiling, and when the recompete window opens. Every one is real.
        </p>
        {top.length > 0 && (
          <div className="mt-6 flex flex-wrap items-center gap-6">
            <div>
              <div className="text-3xl font-semibold font-(family-name:--mp-font-mono) text-(--mp-ink) tabular-nums">{fmtMoney(total)}</div>
              <div className="text-xs uppercase tracking-wider text-(--mp-muted)">Coming up for grabs · top {top.length}, next 12 months</div>
            </div>
            <ShareButton appearance="public" url={`${SITE_URL}/up-for-grabs`} title="Federal contracts up for grabs — the biggest recompetes coming soon" />
          </div>
        )}
      </section>

      {top.length === 0 ? (
        <section className="mx-auto max-w-5xl px-6 pb-16">
          <div className="rounded-none border border-(--mp-line) bg-(--mp-surface) p-8 text-(--mp-muted)">Loading the latest expiring contracts…</div>
        </section>
      ) : (
        <section className="mx-auto max-w-5xl px-6 pb-10">
          <div className="overflow-hidden rounded-none border border-(--mp-line) bg-(--mp-surface) divide-y divide-(--mp-line)">
            {top.map((c) => {
              const m = monthsUntil(c.period_of_performance_current_end);
              const like = c.recompete_likelihood ? LIKELIHOOD[c.recompete_likelihood] : null;
              return (
                <a key={c.contract_id} href={`https://www.usaspending.gov/award/${c.contract_id}`} target="_blank" rel="noopener noreferrer" className="group flex items-center gap-4 px-5 py-4 hover:bg-(--mp-wash) transition-colors">
                  <div className="w-24 shrink-0 text-2xl font-semibold font-(family-name:--mp-font-mono) tabular-nums text-(--mp-ink)">{fmtMoney(sizeOf(c))}</div>
                  <div className="min-w-0 flex-1">
                    {/* Lead with WHAT the contract is for, not who holds it — people care about the work. */}
                    <div className="truncate font-semibold text-(--mp-ink)">{contractScope(c)}</div>
                    <div className="truncate text-sm text-(--mp-muted)">
                      {c.awarding_agency}{c.incumbent_name ? ` · held by ${fmtName(c.incumbent_name)}` : ''}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                      <span className={`rounded-[6px] px-2 py-0.5 font-semibold ${m <= 6 ? 'bg-(--mp-warn-bg) text-(--mp-warn)' : 'bg-(--mp-wash) text-(--mp-body)'}`}>
                        {m <= 0 ? 'Expiring now' : `Expires in ${m} mo · ${fmtDate(c.period_of_performance_current_end)}`}
                      </span>
                      {like && <span className={`rounded-[6px] px-2 py-0.5 font-semibold ${like.cls}`}>{like.label}</span>}
                      {c.set_aside_type && <span className="rounded-[6px] px-2 py-0.5 bg-(--mp-wash) text-(--mp-muted)">{c.set_aside_type}</span>}
                    </div>
                  </div>
                  <span className="hidden sm:inline-block shrink-0 text-xs font-semibold text-(--mp-navy) group-hover:text-(--mp-navy-hover)">Official record →</span>
                </a>
              );
            })}
          </div>
          <p className="mt-4 text-xs text-(--mp-muted)">
            Source: USAspending.gov — current contract data. A recompete typically posts 6–18 months before a
            contract ends; expiry dates are as reported. Click any row for the official record.
          </p>
        </section>
      )}

      {/* CTA */}
      <section className="mx-auto max-w-5xl px-6 pb-16">
        <div className="rounded-none border border-(--mp-line) p-8 text-center bg-(--mp-wash)">
          <h2 className="text-2xl font-bold font-(family-name:--mp-font-serif)">This is a snapshot. Mindy tracks 129,000+ recompetes — and tells you 12 months early.</h2>
          <p className="mt-3 mb-6 max-w-2xl mx-auto text-(--mp-body)">
            Get alerts the moment a contract in your market is about to come up for grabs, with the incumbent and
            the whole history. Start free.
          </p>
          <Link href="/signup" className="inline-flex rounded-none bg-(--mp-navy) px-6 py-3 font-semibold text-white hover:bg-(--mp-navy-hover)">
            Start free →
          </Link>
        </div>
      </section>
    </main>
  );
}
