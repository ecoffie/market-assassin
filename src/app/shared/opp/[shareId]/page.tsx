import type { Metadata } from 'next';
import SharedOpportunityClient from './SharedOpportunityClient';

// Dynamic link-preview (OpenGraph) — the viral payload. When someone shares a
// /shared/opp link in iMessage / Slack / LinkedIn, the recipient sees a card
// ABOUT THE OPPORTUNITY ("Eric shared a $4.2M Roofing contract"), not a generic
// Mindy card. Specificity is what drives the click (Fireflies/Loom playbook).
// Eric 2026-06-05.
export async function generateMetadata(
  { params }: { params: Promise<{ shareId: string }> },
): Promise<Metadata> {
  const { shareId } = await params;
  const base = process.env.NEXT_PUBLIC_APP_URL || 'https://getmindy.ai';

  try {
    const res = await fetch(`${base}/api/share/opportunity?shareId=${shareId}`, {
      next: { revalidate: 300 },
    });
    const json = await res.json();
    if (!json?.success || !json.opportunity) return fallbackMeta(base);

    const o = json.opportunity;
    const agency = o.agency || o.department || 'a federal agency';
    const sharer = json.sharedBy ? `${json.sharedBy.split('@')[0]} shared` : 'Shared';
    // e.g. "$4.2M · Sources Sought · due Jun 5"
    const bits = [
      o.value ? formatValue(o.value) : null,
      o.notice_type,
      o.response_deadline ? `due ${fmtDate(o.response_deadline)}` : null,
      o.naics_code ? `NAICS ${o.naics_code}` : null,
    ].filter(Boolean);

    const title = `${o.title} — ${agency}`;
    const description = `${sharer} this federal opportunity via Mindy${bits.length ? `. ${bits.join(' · ')}` : ''}. See your fit + find more like it.`;
    // OG image route reads the opp directly from Supabase by shareId.
    const ogImage = `${base}/shared/opp/${shareId}/opengraph-image`;

    return {
      title,
      description,
      openGraph: {
        title,
        description,
        url: `${base}/shared/opp/${shareId}`,
        siteName: 'Mindy',
        type: 'website',
        images: [{ url: ogImage, width: 1200, height: 630, alt: title }],
      },
      twitter: {
        card: 'summary_large_image',
        title,
        description,
        images: [ogImage],
      },
    };
  } catch {
    return fallbackMeta(base);
  }
}

function fallbackMeta(base: string): Metadata {
  return {
    title: 'A federal opportunity shared via Mindy',
    description: 'See your fit on this federal opportunity and find more like it — Mindy scores 24,000+ daily.',
    openGraph: {
      title: 'A federal opportunity shared via Mindy',
      description: 'See your fit and find more like it — Mindy scores 24,000+ federal opportunities daily.',
      url: `${base}`,
      siteName: 'Mindy',
      images: [{ url: `${base}/opengraph-image`, width: 1200, height: 630 }],
    },
    twitter: { card: 'summary_large_image' },
  };
}

function formatValue(v: number | string): string {
  const n = typeof v === 'string' ? parseFloat(v.replace(/[^0-9.]/g, '')) : v;
  if (!Number.isFinite(n) || n <= 0) return '';
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${Math.round(n / 1e3)}K`;
  return `$${n}`;
}

function fmtDate(d: string): string {
  try {
    return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch {
    return d;
  }
}

export default function Page() {
  return <SharedOpportunityClient />;
}
