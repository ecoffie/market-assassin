import { ImageResponse } from 'next/og';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export const alt = 'A federal opportunity shared via Mindy';

// Dynamic share-preview image. Reads the opportunity DIRECTLY from Supabase by
// shareId (NOT via a self-fetch to our own API — that self-referential fetch
// during OG render returned 500). No custom fontFamily (Satori default).
export default async function Image({ params }: { params: Promise<{ shareId: string }> }) {
  const { shareId } = await params;
  let title = 'A federal opportunity';
  let agency = 'Federal opportunity';
  let meta = '';

  try {
    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const { data } = await sb
      .from('opportunity_shares')
      .select('opportunity_data')
      .eq('share_id', shareId)
      .maybeSingle();
    const o = (data?.opportunity_data || {}) as Record<string, unknown>;
    if (o.title) title = String(o.title).slice(0, 110);
    agency = String(o.agency || o.department || 'Federal opportunity').slice(0, 70);
    const bits = [o.notice_type, o.set_aside, o.naics_code ? `NAICS ${o.naics_code}` : '']
      .filter(Boolean).map(String);
    meta = bits.join('  •  ').slice(0, 90);
  } catch { /* fall back to generic copy */ }

  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: 'linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%)', padding: 64 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ width: 56, height: 56, borderRadius: 14, background: 'linear-gradient(135deg, #7c3aed, #10b981)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: 32, fontWeight: 700 }}>M</div>
          <div style={{ color: '#a78bfa', fontSize: 26, fontWeight: 600 }}>Shared via Mindy</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', flex: 1 }}>
          <div style={{ color: '#94a3b8', fontSize: 24, marginBottom: 14 }}>{agency}</div>
          <div style={{ color: 'white', fontSize: 52, fontWeight: 700, lineHeight: 1.15 }}>{title}</div>
          {meta ? <div style={{ color: '#34d399', fontSize: 24, marginTop: 20 }}>{meta}</div> : null}
        </div>
        <div style={{ color: '#cbd5e1', fontSize: 26, display: 'flex' }}>See your fit + find more like it → <span style={{ color: '#10b981', fontWeight: 600, marginLeft: 8 }}>getmindy.ai</span></div>
      </div>
    ),
    { ...size },
  );
}
