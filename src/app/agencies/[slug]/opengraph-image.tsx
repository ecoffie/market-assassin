import { ImageResponse } from 'next/og';
import { getAgencyBySlug } from '@/data/agencies-seo';

export const runtime = 'nodejs';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export const alt = 'Federal agency buying profile on Mindy';

// Per-agency share/SEO card — a link to /agencies/<slug> previews the agency's
// name + annual contract spend instead of the generic site card. getAgencyBySlug
// is a fast in-memory lookup. Mirrors the shared/opp opengraph-image template.
export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  let name = 'Federal Agency';
  let spend = 'A federal buyer worth tracking';
  try {
    const agency = getAgencyBySlug(slug);
    if (agency) {
      name = String(agency.name).slice(0, 70);
      if (agency.fy26BudgetB) spend = `$${agency.fy26BudgetB.toLocaleString()}B/yr in federal contracts`;
    }
  } catch { /* fall back to generic copy */ }

  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: 'linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%)', padding: 64 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ width: 56, height: 56, borderRadius: 14, background: 'linear-gradient(135deg, #7c3aed, #10b981)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: 32, fontWeight: 700 }}>M</div>
          <div style={{ color: '#a78bfa', fontSize: 26, fontWeight: 600 }}>Federal Agency · Mindy</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', flex: 1 }}>
          <div style={{ color: '#34d399', fontSize: 30, fontWeight: 600, marginBottom: 16 }}>{spend}</div>
          <div style={{ color: 'white', fontSize: 58, fontWeight: 700, lineHeight: 1.1 }}>{name}</div>
          <div style={{ color: '#94a3b8', fontSize: 26, marginTop: 22 }}>What they buy, who sells to them &amp; how to win</div>
        </div>
        <div style={{ color: '#cbd5e1', fontSize: 26, display: 'flex' }}>Forecasts, set-asides &amp; decision-makers → <span style={{ color: '#10b981', fontWeight: 600, marginLeft: 8 }}>getmindy.ai</span></div>
      </div>
    ),
    { ...size },
  );
}
