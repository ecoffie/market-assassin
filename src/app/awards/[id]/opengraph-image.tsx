import { ImageResponse } from 'next/og';
import { getAwardById } from '@/lib/bigquery/awards';
import { formatCompanyName as fmtCompanyName } from '@/lib/format-name';
import { formatMoneyCompact as fmtMoney } from '@/lib/format-money';

export const runtime = 'nodejs';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export const alt = 'Federal contract award on Mindy';

// Per-award share/SEO card — a link to /awards/<id> previews the contract number,
// recipient, amount, and buyer instead of the generic site card. Reuses the
// page's getAwardById resolver. Mirrors the shared/opp opengraph-image template.
export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let headline = 'Federal Contract Award';
  let amount = '';
  let sub = '';
  try {
    const award = await getAwardById(decodeURIComponent(id));
    if (award) {
      const recipient = fmtCompanyName(award.recipient_name);
      const contractNo = award.piid || award.award_id;
      headline = (contractNo ? `Contract ${contractNo} — ${recipient}` : recipient).slice(0, 90);
      const amt = Number(award.obligation_amount);
      if (amt > 0) amount = `${fmtMoney(amt)} awarded`;
      sub = [award.awarding_agency, award.naics_description].filter(Boolean).map(String).join('  •  ').slice(0, 96);
    }
  } catch { /* fall back to generic copy */ }

  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: 'linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%)', padding: 64 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ width: 56, height: 56, borderRadius: 14, background: 'linear-gradient(135deg, #7c3aed, #10b981)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: 32, fontWeight: 700 }}>M</div>
          <div style={{ color: '#a78bfa', fontSize: 26, fontWeight: 600 }}>Federal Contract Award · Mindy</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', flex: 1 }}>
          {amount ? <div style={{ color: '#34d399', fontSize: 32, fontWeight: 600, marginBottom: 16 }}>{amount}</div> : null}
          <div style={{ color: 'white', fontSize: 50, fontWeight: 700, lineHeight: 1.15 }}>{headline}</div>
          {sub ? <div style={{ color: '#94a3b8', fontSize: 24, marginTop: 22 }}>{sub}</div> : null}
        </div>
        <div style={{ color: '#cbd5e1', fontSize: 26, display: 'flex' }}>Incumbent intel, period of performance &amp; recompete → <span style={{ color: '#10b981', fontWeight: 600, marginLeft: 8 }}>getmindy.ai</span></div>
      </div>
    ),
    { ...size },
  );
}
