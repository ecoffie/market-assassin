import { ImageResponse } from 'next/og';
import { getRollupBySlug, getRollupOrSingleBySlug } from '@/lib/bigquery/recipients';
import { formatCompanyName as fmtCompanyName } from '@/lib/format-name';
import { formatMoneyCompact as fmtMoney } from '@/lib/format-money';

export const runtime = 'nodejs';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export const alt = 'Federal contractor profile on Mindy';

// Per-contractor share/SEO card — so a link to /contractors/<slug> previews the
// firm's name + total obligated + award/agency counts instead of the generic
// site card. Reuses the page's cache-first resolver (no self-fetch). Mirrors the
// shared/opp opengraph-image template.
export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  let name = 'Federal Contractor';
  let money = 'Federal contract profile';
  let stats = '';

  try {
    const r = (await getRollupBySlug(slug)) ?? (await getRollupOrSingleBySlug(slug, true));
    if (r) {
      name = fmtCompanyName(r.rollup_name).slice(0, 64);
      const tot = Number(r.total_obligated || 0);
      if (tot > 0) money = `${fmtMoney(tot)} in federal contracts`;
      const awards = Number(r.award_count || 0);
      const agencies = Number(r.distinct_agency_count || 0);
      stats = [
        awards ? `${awards.toLocaleString()} awards` : '',
        agencies ? `${agencies} ${agencies === 1 ? 'agency' : 'agencies'}` : '',
      ].filter(Boolean).join('  •  ');
    }
  } catch { /* fall back to generic copy */ }

  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: 'linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%)', padding: 64 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ width: 56, height: 56, borderRadius: 14, background: 'linear-gradient(135deg, #7c3aed, #10b981)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: 32, fontWeight: 700 }}>M</div>
          <div style={{ color: '#a78bfa', fontSize: 26, fontWeight: 600 }}>Federal Contractor · Mindy</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', flex: 1 }}>
          <div style={{ color: '#34d399', fontSize: 30, fontWeight: 600, marginBottom: 16 }}>{money}</div>
          <div style={{ color: 'white', fontSize: 60, fontWeight: 700, lineHeight: 1.1 }}>{name}</div>
          {stats ? <div style={{ color: '#94a3b8', fontSize: 26, marginTop: 22 }}>{stats}</div> : null}
        </div>
        <div style={{ color: '#cbd5e1', fontSize: 26, display: 'flex' }}>Award history, NAICS &amp; YoY trends → <span style={{ color: '#10b981', fontWeight: 600, marginLeft: 8 }}>getmindy.ai</span></div>
      </div>
    ),
    { ...size },
  );
}
