import { ImageResponse } from 'next/og';
import { buildOppShareMeta, fetchOppShareRow, isNoticeId, type OppShareMeta } from '@/lib/opportunities/share-metadata';

export const runtime = 'nodejs';

/**
 * GET /opportunity-map/og/<notice_id> — the 1200×630 share card for `/opportunity-map?opp=<id>`.
 *
 * Deliberately NOT under /api/: robots.txt disallows /api/, and Twitterbot honours robots.txt, so an
 * /api/ image would silently fall back to a text-only X card. The OPPORTUNITY is the hero; Mindy is a
 * small attribution in the footer. Every line is a verified sam_opportunities field or absent — see
 * src/lib/opportunities/share-metadata.ts. Reads Supabase directly (a self-fetch to our own API during
 * OG render returned 500 — the shared/opp card's documented lesson).
 */
const W = 1200;
const H = 630;

function titleSize(t: string): number {
  const n = t.length;
  if (n <= 40) return 68;
  if (n <= 70) return 58;
  if (n <= 110) return 48;
  if (n <= 160) return 40;
  return 34;
}

function clip(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const sp = cut.lastIndexOf(' ');
  return `${(sp > max * 0.6 ? cut.slice(0, sp) : cut).trimEnd()}…`;
}

function Fact({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', marginRight: 48, maxWidth: 420 }}>
      <div style={{ color: '#94a3b8', fontSize: 18, fontWeight: 600, letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 6 }}>{label}</div>
      <div style={{ color: accent || '#f8fafc', fontSize: 28, fontWeight: 700 }}>{value}</div>
    </div>
  );
}

function Card({ meta }: { meta: OppShareMeta | null }) {
  const c = meta?.card;
  const title = clip(c?.title || 'Federal government opportunity', 200);
  const status = c?.closed ? (c.noticeType && /award/i.test(c.noticeType) ? 'AWARD NOTICE' : 'CLOSED') : null;
  return (
    <div style={{ width: W, height: H, display: 'flex', flexDirection: 'column', background: '#0b1220', padding: '56px 64px 44px' }}>
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <div style={{ display: 'flex', background: '#10b981', color: '#04241a', fontSize: 22, fontWeight: 800, letterSpacing: 3, padding: '8px 16px', borderRadius: 8 }}>
          GOVERNMENT OPPORTUNITY
        </div>
        {status ? (
          <div style={{ display: 'flex', marginLeft: 14, border: '2px solid #f59e0b', color: '#fbbf24', fontSize: 20, fontWeight: 800, letterSpacing: 2, padding: '6px 14px', borderRadius: 8 }}>
            {status}
          </div>
        ) : null}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, justifyContent: 'center' }}>
        <div style={{ color: '#ffffff', fontSize: titleSize(title), fontWeight: 800, lineHeight: 1.12, display: 'flex' }}>{title}</div>
        {c?.buyer ? <div style={{ color: '#cbd5e1', fontSize: 30, fontWeight: 600, marginTop: 22, display: 'flex' }}>{clip(c.buyer, 70)}</div> : null}
      </div>

      {c && (c.location || c.deadline || c.solicitation) ? (
        <div style={{ display: 'flex', borderTop: '2px solid #1e293b', paddingTop: 22 }}>
          {c.deadline ? <Fact label={c.deadlineLabel || 'Responses due'} value={c.deadline} accent={c.closed ? '#94a3b8' : '#34d399'} /> : null}
          {c.location ? <Fact label="Place of performance" value={clip(c.location, 34)} /> : null}
          {c.solicitation ? <Fact label="Solicitation" value={clip(c.solicitation, 28)} /> : null}
        </div>
      ) : null}

      <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', marginTop: 18 }}>
        <div style={{ width: 26, height: 26, borderRadius: 7, background: 'linear-gradient(135deg, #7c3aed, #10b981)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: 16, fontWeight: 800 }}>M</div>
        <div style={{ color: '#64748b', fontSize: 20, marginLeft: 10, display: 'flex' }}>via Mindy · getmindy.ai</div>
      </div>
    </div>
  );
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let meta: OppShareMeta | null = null;
  if (isNoticeId(id)) {
    try {
      const row = await fetchOppShareRow(id);
      if (row) meta = buildOppShareMeta(row);
    } catch (e) {
      // A DB failure renders the generic card (never an error image in someone's feed), but is logged.
      console.error('[opportunity-map/og] share row read failed', id, e);
    }
  }
  return new ImageResponse(<Card meta={meta} />, {
    width: W,
    height: H,
    headers: {
      // Deadline status flips from "due" to "closed", so keep the edge cache short-ish.
      'cache-control': meta ? 'public, max-age=600, s-maxage=3600, stale-while-revalidate=86400' : 'public, max-age=300',
    },
  });
}
