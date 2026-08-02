/**
 * /market-explorer — the Market Explorer HUB.
 *
 * A reference/research surface (browse who's buying + who's winning, USASpending-style),
 * reached from the opportunity-map left rail BELOW Favorites — NOT a daily bid-hunting tool
 * (Eric 2026-08-02: "may never get used … should not be in the target cards"). It does NOT
 * rebuild any drill-down page; it's the ENTRY POINT that routes into the existing, now-restyled
 * pages: /agencies/[slug] · /naics/[code] · /contractors/[slug].
 *
 * STATIC + fast: built entirely from the curated AGENCIES_SEO (49) + NAICS_TOP_100 (100) data
 * that already power the /agencies and /naics indexes — no cold BQ scans on the hub itself (the
 * detail pages do the live queries). New-map light design (white / #2563eb blue / Inter).
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { AGENCIES_SEO } from '@/data/agencies-seo';
import { NAICS_TOP_100 } from '@/data/naics-top100';

export const revalidate = 604800; // 7d — static curated data

export const metadata: Metadata = {
  title: 'Market Explorer — Federal Buyers & Winners | Mindy',
  description: 'Browse who buys and who wins across the federal market — by agency, NAICS, or firm. Spending, top contractors, and set-aside accessibility, grounded in real award data.',
  alternates: { canonical: 'https://getmindy.ai/market-explorer' },
};

function agencySlug(a: { slug: string }) { return a.slug; }
function fmtB(n: number | null): string { return n ? `$${n.toLocaleString()}B` : '—'; }
function fmtV(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(0)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(0)}M`;
  return `$${(n / 1e3).toFixed(0)}K`;
}

export default function MarketExplorerHub() {
  // Top agencies by FY26 budget (the ones with a real figure), top NAICS by tracked value.
  const topAgencies = [...AGENCIES_SEO]
    .filter((a) => a.fy26BudgetB)
    .sort((a, b) => (b.fy26BudgetB ?? 0) - (a.fy26BudgetB ?? 0))
    .slice(0, 12);
  const topNaics = [...NAICS_TOP_100].sort((a, b) => b.totalValue - a.totalValue).slice(0, 12);

  return (
    <main className="min-h-screen bg-[#f5f8fb] text-[#111c26]" style={{ fontFamily: 'Inter, system-ui, sans-serif' }}>
      {/* header */}
      <div className="border-b border-[#e6ebf0] bg-white">
        <div className="max-w-5xl mx-auto px-6 py-5">
          <p className="text-[12px] font-semibold text-[#6b7787] uppercase tracking-wide">Market Explorer · reference</p>
          <h1 className="mt-1 text-[26px] md:text-[30px] font-extrabold tracking-[-0.02em]">Who&apos;s buying &amp; winning in the federal market</h1>
          <p className="mt-1.5 text-[15px] text-[#3a4a5c] max-w-2xl">
            Browse by agency, NAICS, or firm — spending, top contractors, and set-aside accessibility, grounded in real award data.
          </p>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-8 flex flex-col gap-8">
        {/* three entry points */}
        <div className="grid md:grid-cols-3 gap-4">
          <Link href="/agencies" className="rounded-[14px] border border-[#e6ebf0] bg-white p-5 hover:border-[#c4cfda] hover:shadow-[0_3px_12px_-4px_rgba(16,24,40,.14)] transition">
            <div className="w-[40px] h-[40px] rounded-[11px] flex items-center justify-center text-white mb-3" style={{ background: 'linear-gradient(135deg,#1e3a8a,#2563eb)' }}>
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 21h18M5 21V7l7-4 7 4v14M9 9h.01M9 13h.01M9 17h.01M15 9h.01M15 13h.01M15 17h.01" /></svg>
            </div>
            <p className="font-extrabold text-[16px]">Buying agencies</p>
            <p className="mt-1 text-[13px] text-[#6b7787]">49 federal buyers — spending, sub-agencies, and the firms they buy from.</p>
          </Link>
          <Link href="/naics" className="rounded-[14px] border border-[#e6ebf0] bg-white p-5 hover:border-[#c4cfda] hover:shadow-[0_3px_12px_-4px_rgba(16,24,40,.14)] transition">
            <div className="w-[40px] h-[40px] rounded-[11px] flex items-center justify-center text-white mb-3" style={{ background: 'linear-gradient(135deg,#6d28d9,#8b5cf6)' }}>
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 3v18h18M7 16l4-4 3 3 5-6" /></svg>
            </div>
            <p className="font-extrabold text-[16px]">Markets (NAICS)</p>
            <p className="mt-1 text-[13px] text-[#6b7787]">Market size, who buys, who wins, and how accessible each code is to small business.</p>
          </Link>
          <Link href="/contractors" className="rounded-[14px] border border-[#e6ebf0] bg-white p-5 hover:border-[#c4cfda] hover:shadow-[0_3px_12px_-4px_rgba(16,24,40,.14)] transition">
            <div className="w-[40px] h-[40px] rounded-[11px] flex items-center justify-center text-white mb-3" style={{ background: 'linear-gradient(135deg,#0f766e,#14b8a6)' }}>
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" /></svg>
            </div>
            <p className="font-extrabold text-[16px]">Winning firms</p>
            <p className="mt-1 text-[13px] text-[#6b7787]">The contractors already winning — award history, top agencies, and NAICS mix.</p>
          </Link>
        </div>

        {/* top agencies */}
        <section>
          <div className="flex items-baseline justify-between mb-3">
            <h2 className="text-[18px] font-extrabold">Top buying agencies</h2>
            <Link href="/agencies" className="text-[13px] font-bold text-[#2563eb] hover:underline">All 49 →</Link>
          </div>
          <div className="grid sm:grid-cols-2 gap-2">
            {topAgencies.map((a) => (
              <Link key={a.slug} href={`/agencies/${agencySlug(a)}`}
                className="flex items-center justify-between gap-3 rounded-[11px] border border-[#e6ebf0] bg-white px-4 py-3 hover:border-[#c4cfda] transition">
                <span className="min-w-0">
                  <span className="block font-bold text-[14px] truncate">{a.name}</span>
                  <span className="block text-[12px] text-[#6b7787]">{a.abbreviation}</span>
                </span>
                <span className="flex-none font-extrabold text-[14px] text-[#2563eb]">{fmtB(a.fy26BudgetB)}</span>
              </Link>
            ))}
          </div>
        </section>

        {/* top markets */}
        <section>
          <div className="flex items-baseline justify-between mb-3">
            <h2 className="text-[18px] font-extrabold">Top markets (NAICS)</h2>
            <Link href="/naics" className="text-[13px] font-bold text-[#2563eb] hover:underline">All 100 →</Link>
          </div>
          <div className="grid sm:grid-cols-2 gap-2">
            {topNaics.map((n) => (
              <Link key={n.code} href={`/naics/${n.code}`}
                className="flex items-center justify-between gap-3 rounded-[11px] border border-[#e6ebf0] bg-white px-4 py-3 hover:border-[#c4cfda] transition">
                <span className="min-w-0">
                  <span className="block font-bold text-[14px] truncate">
                    <span className="font-mono text-[#2563eb]">{n.code}</span> · {n.title}
                  </span>
                  <span className="block text-[12px] text-[#6b7787]">{n.contractorCount.toLocaleString()} contractors</span>
                </span>
                <span className="flex-none font-extrabold text-[14px] text-[#137a41]">{fmtV(n.totalValue)}</span>
              </Link>
            ))}
          </div>
        </section>

        <p className="text-center text-[12px] text-[#8595a6] py-4">
          Reference data from federal award records. <Link href="/opportunity-map" className="text-[#2563eb] hover:underline">← Back to the map</Link>
        </p>
      </div>
    </main>
  );
}
