/**
 * /opportunity/[slug] — public, indexable landing page for one SAM notice:
 * open, closed (labelled "Closed — responses were due <date>", with related
 * open notices + an alerts CTA) or awarded. Phase 1 of Mindy's programmatic-SEO layer (own the index, like
 * HigherGov: a page per opportunity + "Similar Opportunities" cross-linking).
 *
 * ISR-only (no build prerender — 34k+ opps). Each page reads one row + a
 * NAICS-matched similar set, then edge-caches. Thin opps (no real body) 404 and
 * are kept out of the sitemap — Google penalizes thin pages.
 *
 * Keyword targets per page:
 *   - "<title> government contract"
 *   - "<solicitation number>"
 *   - "<naics> opportunity <agency>"
 *
 * Data discipline (rule #1): every field from sam_opportunities. No fabrication.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import MemberAwareCta from '@/components/MemberAwareCta';
import {
  opportunityStatusLabel,
  getOpportunityBySlug,
  getRelatedOpenOpportunities,
  type SeoOpportunity,
} from '@/lib/seo/opportunities';
import { buildOpportunityTitles } from '@/lib/seo/opportunity-title';

/** The row facts the status banner is built from (shared by metadata and the page). */
function statusOf(opp: SeoOpportunity) {
  return opportunityStatusLabel({
    notice_type: opp.noticeType,
    response_deadline: opp.responseDeadline,
    active: opp.active,
    awardee_name: opp.awardeeName,
    award_date: opp.awardDate,
  });
}

export const dynamicParams = true;
export const revalidate = 86400; // 1d — opps change (deadlines, amendments)

export async function generateStaticParams() {
  return []; // ISR-only; pages render on first crawl, then cache
}

const SITE_URL = 'https://getmindy.ai';

function clampDesc(s: string, n = 158): string {
  const clean = s.replace(/\s+/g, ' ').trim();
  return clean.length > n ? `${clean.slice(0, n - 3).trimEnd()}...` : clean;
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return isNaN(d.getTime())
    ? '—'
    : d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const opp = await getOpportunityBySlug(slug);
  if (!opp) {
    return {
      title: 'Opportunity not found | Mindy',
      description: 'This federal contract opportunity is no longer active or was not found.',
    };
  }
  const agency = opp.department || opp.subTier || 'a federal agency';
  const { status, label } = statusOf(opp);
  // Never describe a closed or awarded notice as something you can still respond to.
  const statusSentence =
    status === 'open'
      ? (opp.responseDeadline ? `. Responses due ${fmtDate(opp.responseDeadline)}.` : '. ') +
        ` Track it and draft your response with Mindy.`
      : `. ${label}. See related open opportunities and get alerts with Mindy.`;
  const desc = clampDesc(
    `${opp.title} — federal contract ${status === 'open' ? 'opportunity' : 'notice'} from ${agency}` +
      (opp.solicitationNumber ? ` (Solicitation ${opp.solicitationNumber})` : '') +
      statusSentence,
  );
  const url = `${SITE_URL}/opportunity/${slug}`;
  // Titles repeat across notices ("53--GASKET"), so the solicitation number (else agency) is in the title.
  const { title, ogTitle } = buildOpportunityTitles({ ...opp, status });
  return {
    title,
    description: desc,
    alternates: { canonical: url },
    openGraph: { title: ogTitle, description: desc, type: 'article', url },
    keywords: [
      `${opp.title.toLowerCase()} government contract`,
      opp.solicitationNumber ? `${opp.solicitationNumber} solicitation` : 'federal solicitation',
      opp.naicsCode ? `naics ${opp.naicsCode} opportunity` : 'federal opportunity',
      `${agency.toLowerCase()} contract opportunity`,
      'federal contract opportunity',
      'sam.gov opportunity',
      'mindy opportunity',
    ].filter(Boolean) as string[],
  };
}

function jsonLdFor(opp: SeoOpportunity, slug: string) {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'GovernmentService',
        name: opp.title,
        serviceType: 'Federal Contract Opportunity',
        provider: {
          '@type': 'GovernmentOrganization',
          name: opp.department || opp.subTier || 'U.S. Federal Government',
        },
        description: clampDesc(opp.description || opp.title, 300),
        url: `${SITE_URL}/opportunity/${slug}`,
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: SITE_URL },
          { '@type': 'ListItem', position: 2, name: 'Opportunities', item: `${SITE_URL}/opportunity-hunter` },
          { '@type': 'ListItem', position: 3, name: opp.title, item: `${SITE_URL}/opportunity/${slug}` },
        ],
      },
    ],
  };
}

export default async function OpportunityPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const opp = await getOpportunityBySlug(slug);
  if (!opp) notFound();

  const related = await getRelatedOpenOpportunities(opp);
  const agency = opp.department || opp.subTier || null;
  const { status, label: statusLabel } = statusOf(opp);
  const isOpen = status === 'open';
  const body = (opp.sowText && opp.sowText.length > opp.description.length ? opp.sowText : opp.description) || '';

  return (
    <main className="bg-white">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLdFor(opp, slug)) }}
      />

      <div className="max-w-4xl mx-auto px-4 py-10">
        {/* Breadcrumb */}
        <nav className="text-xs text-(--mp-muted) mb-4">
          <Link href="/" className="hover:text-(--mp-muted)">Home</Link>
          <span className="mx-1.5">/</span>
          <Link href="/opportunity-hunter" className="hover:text-(--mp-muted)">Opportunities</Link>
          <span className="mx-1.5">/</span>
          <span className="text-(--mp-muted)">{opp.noticeType || 'Opportunity'}</span>
        </nav>

        {/* Status — `active` in SAM data does not mean open; say what this notice is.
            Every clause comes from the row (deadline, archived flag, named awardee). */}
        {isOpen ? (
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-(--mp-muted)" data-opportunity-status={status}>
            {statusLabel}
          </p>
        ) : (
          <div
            className="mb-4 rounded-lg border border-(--mp-line) bg-(--mp-wash) px-4 py-3"
            role="status"
            data-opportunity-status={status}
          >
            <p className="text-sm font-semibold text-(--mp-ink)">{statusLabel}</p>
            <p className="mt-0.5 text-xs text-(--mp-muted)">
              {status === 'closed'
                ? 'This solicitation is no longer accepting responses. It is kept here as a record.'
                : 'This is an award notice, not an open solicitation.'}
              {related && ' Related open opportunities are listed below.'}
            </p>
          </div>
        )}
        {/* Header */}
        <h1 className="text-2xl md:text-3xl font-bold text-(--mp-ink) leading-tight font-(family-name:--mp-font-serif)">{opp.title}</h1>
        <p className="text-sm text-(--mp-muted) mt-2">
          {agency && <span className="font-medium text-(--mp-body)">{agency}</span>}
          {opp.office && <span> · {opp.office}</span>}
        </p>

        {/* Fact strip */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-6">
          {[
            ['Notice type', opp.noticeType],
            ['Solicitation #', opp.solicitationNumber],
            ['NAICS', opp.naicsCode],
            ['PSC', opp.pscCode],
            ['Set-aside', opp.setAsideDescription],
            ['Posted', fmtDate(opp.postedDate)],
            ['Response due', fmtDate(opp.responseDeadline)],
            ['Place of performance', [opp.popCity, opp.popState].filter(Boolean).join(', ') || null],
          ]
            .filter(([, v]) => v)
            .map(([label, value]) => (
              <div key={label as string} className="bg-(--mp-wash) border border-(--mp-hair) rounded-lg p-3">
                <div className="text-[11px] uppercase tracking-wide text-(--mp-muted) font-semibold">{label}</div>
                <div className="text-sm text-(--mp-ink) mt-0.5 break-words">{value}</div>
              </div>
            ))}
        </div>

        {/* AI analysis — unique, data-grounded content (Phase 4 enrichment) */}
        {opp.seoSummary && (
          <section className="mt-8">
            <h2 className="text-lg font-semibold text-(--mp-ink) mb-2">What this opportunity is</h2>
            <p className="text-(--mp-body) leading-relaxed">{opp.seoSummary}</p>
            <p className="text-xs text-(--mp-muted) mt-2">Analysis by Mindy, grounded in the SAM.gov notice.</p>
          </section>
        )}

        {/* Body / description */}
        <section className="mt-8">
          <h2 className="text-lg font-semibold text-(--mp-ink) mb-2">Description</h2>
          <div className="prose prose-sm max-w-none text-(--mp-body) whitespace-pre-wrap leading-relaxed">
            {body.slice(0, 6000)}
            {body.length > 6000 && '…'}
          </div>
          <p className="text-xs text-(--mp-muted) mt-3">Source: SAM.gov, as posted. Verify the current solicitation before responding.</p>
        </section>

        {/* CTA — the Mindy pitch. A closed/awarded notice cannot be pursued: offer alerts for
            the buyer's NEXT notice instead of "track this". */}
        {!isOpen ? (
        <div className="mt-8 border border-(--mp-line) rounded-lg p-6 bg-(--mp-wash)">
          <h2 className="text-lg font-bold text-(--mp-ink)">
            Get alerts when {agency ? agency : 'this agency'} posts the next one
          </h2>
          <p className="text-sm text-(--mp-muted) mt-1">
            Mindy watches SAM.gov every day and emails you new notices that match what you sell
            {opp.naicsCode ? ` — like NAICS ${opp.naicsCode}` : ''}. Free daily alerts.
          </p>
          <div className="mt-4">
            <MemberAwareCta appearance="public" memberHref="/app?panel=alerts" memberLabel="Set up alerts in Mindy →">
              <Link
                href="/app/signup"
                className="inline-block bg-(--mp-navy) hover:bg-(--mp-navy-hover) text-white font-semibold rounded-lg px-5 py-2.5 text-sm"
              >
                Get free alerts →
              </Link>
            </MemberAwareCta>
          </div>
          {opp.uiLink && (
            <a href={opp.uiLink} target="_blank" rel="noopener noreferrer" className="inline-block text-xs text-(--mp-navy) hover:underline mt-3">
              View the original notice on SAM.gov ↗
            </a>
          )}
        </div>
        ) : (
        <div className="mt-8 border border-(--mp-line) rounded-lg p-6 bg-(--mp-wash)">
          <h2 className="text-lg font-bold text-(--mp-ink)">Pursue this opportunity with Mindy</h2>
          <p className="text-sm text-(--mp-muted) mt-1">
            See who holds it now, who else is bidding, and draft your response — grounded in real
            government data, not generic AI.
          </p>
          <div className="mt-4">
            <MemberAwareCta appearance="public" memberHref="/app" memberLabel="Open in Mindy →">
              <Link
                href="/app"
                className="inline-block bg-(--mp-navy) hover:bg-(--mp-navy-hover) text-white font-semibold rounded-lg px-5 py-2.5 text-sm"
              >
                Track this free in Mindy →
              </Link>
            </MemberAwareCta>
          </div>
          {opp.uiLink && (
            <a href={opp.uiLink} target="_blank" rel="noopener noreferrer" className="inline-block text-xs text-(--mp-navy) hover:underline mt-3">
              View the original notice on SAM.gov ↗
            </a>
          )}
        </div>
        )}

        {/* Related OPEN opportunities — the internal-link web; scoped in the query (NAICS, then
            department), open-only, so a closed page never links another closed notice as live. */}
        {related && (
          <section className="mt-10">
            <h2 className="text-lg font-semibold text-(--mp-ink) mb-3">
              {related.scope === 'naics'
                ? `Open opportunities in NAICS ${opp.naicsCode}`
                : `Open opportunities from ${opp.department}`}
            </h2>
            <div className="grid md:grid-cols-2 gap-3">
              {related.items.map((s) => (
                <Link
                  key={s.slug}
                  href={`/opportunity/${s.slug}`}
                  className="block border border-(--mp-hair) rounded-lg p-4 hover:border-(--mp-navy) hover:bg-(--mp-navy-wash) transition-colors"
                >
                  <div className="text-sm font-medium text-(--mp-ink) line-clamp-2">{s.title}</div>
                  <div className="text-xs text-(--mp-muted) mt-1">
                    {[s.department, s.noticeType].filter(Boolean).join(' · ')}
                    {s.responseDeadline && ` · due ${fmtDate(s.responseDeadline)}`}
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* Cross-links to the broader SEO web */}
        <nav className="mt-10 pt-6 border-t border-(--mp-hair) text-sm text-(--mp-muted) flex flex-wrap gap-x-4 gap-y-1">
          {opp.naicsCode && (
            <Link href={`/naics/${opp.naicsCode}`} className="text-(--mp-navy) hover:underline">
              More NAICS {opp.naicsCode} opportunities →
            </Link>
          )}
          <Link href="/opportunity-hunter" className="text-(--mp-navy) hover:underline">Browse all opportunities →</Link>
          <Link href="/forecasts" className="text-(--mp-navy) hover:underline">Agency forecasts →</Link>
        </nav>
      </div>
    </main>
  );
}
