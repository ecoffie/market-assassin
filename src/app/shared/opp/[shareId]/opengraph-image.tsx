import { ImageResponse } from 'next/og';

export const runtime = 'nodejs';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export const alt = 'A federal opportunity shared via Mindy';

// Dynamic share-preview image. Reads the opportunity headline from query params
// (?title/?agency/?meta) that generateMetadata appends — so we do NOT fetch
// inside image generation (a self-referential fetch to our own API during the
// OG render was the 500). No custom fontFamily — Satori uses its default.
export default async function Image({
  searchParams,
}: {
  searchParams?: Promise<{ title?: string; agency?: string; meta?: string }>;
}) {
  const sp = (await searchParams) || {};
  const title = (sp.title || 'A federal opportunity').slice(0, 110);
  const agency = (sp.agency || 'Federal opportunity').slice(0, 70);
  const meta = (sp.meta || '').slice(0, 90);

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
