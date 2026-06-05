import { ImageResponse } from 'next/og';

export const runtime = 'nodejs';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export const alt = 'A federal opportunity shared via Mindy';

// Dynamic share-preview image: the opportunity headline + agency on Mindy's
// brand card. This is what shows in iMessage/Slack/LinkedIn when a user shares.
export default async function Image({ params }: { params: { shareId: string } }) {
  const base = process.env.NEXT_PUBLIC_APP_URL || 'https://getmindy.ai';
  let title = 'A federal opportunity';
  let agency = '';
  let meta = '';
  try {
    const res = await fetch(`${base}/api/share/opportunity?shareId=${params.shareId}`, { next: { revalidate: 300 } });
    const json = await res.json();
    if (json?.success && json.opportunity) {
      const o = json.opportunity;
      title = (o.title || title).slice(0, 110);
      agency = (o.agency || o.department || '').slice(0, 70);
      const bits = [o.notice_type, o.set_aside, o.naics_code ? `NAICS ${o.naics_code}` : ''].filter(Boolean);
      meta = bits.join('  •  ');
    }
  } catch { /* fall back to generic copy */ }

  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: 'linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%)', padding: 64, fontFamily: 'sans-serif' }}>
        {/* brand row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ width: 56, height: 56, borderRadius: 14, background: 'linear-gradient(135deg, #7c3aed, #10b981)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: 32, fontWeight: 700 }}>M</div>
          <div style={{ color: '#a78bfa', fontSize: 26, fontWeight: 600 }}>Shared via Mindy</div>
        </div>
        {/* opportunity */}
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', flex: 1 }}>
          <div style={{ color: '#94a3b8', fontSize: 24, marginBottom: 14 }}>{agency || 'Federal opportunity'}</div>
          <div style={{ color: 'white', fontSize: 52, fontWeight: 700, lineHeight: 1.15 }}>{title}</div>
          {meta ? <div style={{ color: '#34d399', fontSize: 24, marginTop: 20 }}>{meta}</div> : null}
        </div>
        {/* footer CTA */}
        <div style={{ color: '#cbd5e1', fontSize: 26 }}>See your fit + find more like it → <span style={{ color: '#10b981', fontWeight: 600 }}>getmindy.ai</span></div>
      </div>
    ),
    { ...size },
  );
}
