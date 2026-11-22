/**
 * /forecasts/[id] — one public page per agency procurement forecast (2026-11-17).
 *
 * The URL segment is `<kebab-title>-<row uuid>`; only the uuid resolves the row, and a stale or
 * missing title part 308s to the current slug. Data: `agency_forecasts` via
 * src/lib/seo/forecast-pages.ts — read rules, the thin gate and staleness live there.
 *
 *  - FREE (in the HTML): the published forecast fields. Absent fields read "Not stated".
 *  - BEHIND FREE SIGN-UP: point-of-contact details (never sent to the browser — the page only
 *    knows whether a POC exists), "alert me when this becomes a solicitation", save to pipeline.
 *  - Thin / stale / closed forecasts still render, with `robots: noindex, follow`.
 *  - A read failure throws SeoTemporarilyUnavailableError (5xx, not ISR-cached); 404 only when
 *    the database answered "no such row".
 */
import type { Metadata } from 'next';
import { siteShareImages } from '@/lib/seo/share-image';
import Link from 'next/link';
import { notFound, permanentRedirect } from 'next/navigation';
import MemberAwareCta from '@/components/MemberAwareCta';
import {
  parseForecastSlug,
  getForecastById,
  getMoreForecastsFromAgency,
  forecastAgencyLabel,
  forecastAgencySeo,
  forecastSubAgency,
  forecastValueLabel,
  fiscalPeriodLabel,
  naicsLabel,
  naicsPageExists,
  type ForecastLookup,
} from '@/lib/seo/forecast-pages';

export const dynamicParams = true;
export const revalidate = 86400; // 1d — forecasts are re-synced daily at most

export async function generateStaticParams() {
  return []; // ISR-only; pages render on first crawl, then cache
}

const SITE_URL = 'https://getmindy.ai';
const NOT_STATED = 'Not stated';

type PageProps = { params: Promise<{ id: string }> };

function clampDesc(s: string, n = 158): string {
  const clean = s.replace(/\s+/g, ' ').trim();
  return clean.length > n ? `${clean.slice(0, n - 3).trimEnd()}...` : clean;
}

function fmtDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? null
    : d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
}

async function load(param: string): Promise<ForecastLookup | null> {
  const id = parseForecastSlug(param);
  if (!id) return null;
  return getForecastById(id);
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id: param } = await params;
  const lookup = await load(param);
  if (!lookup) {
    return { title: 'Forecast not found | Mindy', robots: { index: false, follow: true } };
  }
  const { forecast: f, indexability, canonicalSlug } = lookup;
  const agency = forecastAgencyLabel(f.sourceAgency, f.department) || 'Federal';
  const period = fiscalPeriodLabel(f.fiscalYear, f.anticipatedQuarter);
  const suffix = ` — ${agency} Forecast${period ? ` (${period})` : ''} | Mindy`;
  const maxTitle = Math.max(30, 90 - suffix.length);
  const titleStr = `${f.title.length > maxTitle ? `${f.title.slice(0, maxTitle - 1).trimEnd()}…` : f.title}${suffix}`;
  const value = forecastValueLabel(f.valueMin, f.valueMax, f.valueRangeText);
  const facts = [
    period && `anticipated ${period}`,
    f.naicsCode && `NAICS ${f.naicsCode}`,
    value && `est. value ${value}`,
    f.setAside && `set-aside: ${f.setAside}`,
  ].filter(Boolean).join(', ');
  const description = clampDesc(
    `${f.title} — procurement forecast from ${agency}${facts ? ` (${facts})` : ''}. ` +
      `Get alerted when it becomes a solicitation with Mindy.`,
  );
  const url = `${SITE_URL}/forecasts/${canonicalSlug}`;
  return {
    title: titleStr,
    description,
    alternates: { canonical: url },
    openGraph: { title: titleStr, description, type: 'article', url, siteName: 'Mindy', images: siteShareImages() },
    ...(indexability.indexable ? {} : { robots: { index: false, follow: true } }),
  };
}

function Fact({ label, value, children }: { label: string; value?: string | null; children?: React.ReactNode }) {
  return (
    <div className="bg-(--mp-wash) border border-(--mp-hair) rounded-lg p-3">
      <dt className="text-[11px] uppercase tracking-wide text-(--mp-muted) font-semibold">{label}</dt>
      <dd className={`text-sm mt-0.5 break-words ${value || children ? 'text-(--mp-ink)' : 'text-(--mp-muted) italic'}`}>
        {children ?? value ?? NOT_STATED}
      </dd>
    </div>
  );
}

export default async function ForecastDetailPage({ params }: PageProps) {
  const { id: param } = await params;
  const lookup = await load(param);
  if (!lookup) notFound();
  const { forecast: f, indexability } = lookup;
  if (decodeURIComponent(param) !== f.slug) permanentRedirect(`/forecasts/${f.slug}`);

  const more = await getMoreForecastsFromAgency(f);

  const agency = forecastAgencyLabel(f.sourceAgency, f.department);
  const agencySeo = forecastAgencySeo(f.sourceAgency);
  const subAgency = forecastSubAgency(f.bureau);
  const period = fiscalPeriodLabel(f.fiscalYear, f.anticipatedQuarter);
  const value = forecastValueLabel(f.valueMin, f.valueMax, f.valueRangeText);
  const naicsDesc = naicsLabel(f.naicsCode, f.naicsDescription);
  // pop_country defaults to 'USA' at the column level — it is not evidence, so it never renders.
  const place = [f.popCity, f.popState].filter(Boolean).join(', ') || null;
  const stale = indexability.reasons.includes('stale');
  const closedStatus = indexability.reasons.includes('closed-status');

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: SITE_URL },
      { '@type': 'ListItem', position: 2, name: 'Forecasts', item: `${SITE_URL}/forecasts` },
      { '@type': 'ListItem', position: 3, name: f.title, item: `${SITE_URL}/forecasts/${lookup.canonicalSlug}` },
    ],
  };

  return (
    <main className="bg-white">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }} />

      <div className="max-w-4xl mx-auto px-4 py-10">
        <nav className="text-xs text-(--mp-muted) mb-4">
          <Link href="/" className="hover:text-(--mp-navy-hover)">Home</Link>
          <span className="mx-1.5">/</span>
          <Link href="/forecasts" className="hover:text-(--mp-navy-hover)">Forecasts</Link>
          {agency && (
            <>
              <span className="mx-1.5">/</span>
              <span>{agency}</span>
            </>
          )}
        </nav>

        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-(--mp-muted)">
          {closedStatus
            ? `Agency forecast · marked ${f.status} by the publisher`
            : stale
              ? 'Agency forecast · anticipated date has passed'
              : 'Agency procurement forecast · not yet a solicitation'}
        </p>
        <h1 className="text-2xl md:text-3xl font-bold text-(--mp-ink) leading-tight font-(family-name:--mp-font-serif)">{f.title}</h1>
        <p className="text-sm text-(--mp-muted) mt-2">
          {agency && <span className="font-medium text-(--mp-body)">{agency}</span>}
          {subAgency && <span> · {subAgency}</span>}
          {f.contractingOffice && <span> · {f.contractingOffice}</span>}
        </p>

        {stale && !closedStatus && (
          <p className="mt-4 rounded-lg border border-(--mp-line) bg-(--mp-wash) p-3 text-sm text-(--mp-body)">
            The anticipated date on this forecast has passed. The requirement may since have been
            solicited, awarded, delayed or dropped — check the agency&apos;s current forecast before relying on it.
          </p>
        )}

        <dl className="grid grid-cols-2 md:grid-cols-3 gap-3 mt-6">
          <Fact label="Agency" value={agency} />
          <Fact label="Sub-agency" value={subAgency} />
          <Fact label="Contracting office" value={f.contractingOffice} />
          <Fact label="Program office" value={f.programOffice} />
          <Fact label="NAICS" value={f.naicsCode ? `${f.naicsCode}${naicsDesc ? ` — ${naicsDesc}` : ''}` : null} />
          <Fact label="PSC" value={f.pscCode ? `${f.pscCode}${f.pscDescription ? ` — ${f.pscDescription}` : ''}` : null} />
          <Fact label="Estimated value" value={value} />
          <Fact label="Anticipated award" value={fmtDate(f.anticipatedAwardDate)} />
          <Fact label="Anticipated solicitation" value={fmtDate(f.solicitationDate)} />
          <Fact label="Fiscal period" value={period} />
          {/* Absent set-aside renders "Not stated": absent ≠ unrestricted. */}
          <Fact label="Set-aside" value={f.setAside} />
          <Fact label="Competition" value={f.competition} />
          <Fact label="Contract type" value={f.contractType} />
          <Fact label="Place of performance" value={place} />
          <Fact label="Incumbent (as published)" value={f.incumbentName} />
          <Fact label="Point of contact">
            {f.hasPoc ? <span>Listed — <Link href="/signup" className="text-(--mp-navy) hover:underline">sign up free to view</Link></span> : null}
          </Fact>
        </dl>

        <section className="mt-8">
          <h2 className="text-lg font-semibold text-(--mp-ink) mb-2">Description</h2>
          {f.description ? (
            <div className="text-(--mp-body) whitespace-pre-wrap leading-relaxed text-sm">
              {f.description.slice(0, 6000)}
              {f.description.length > 6000 && '…'}
            </div>
          ) : (
            <p className="text-sm italic text-(--mp-muted)">{NOT_STATED} by the publisher.</p>
          )}
          <p className="text-xs text-(--mp-muted) mt-3">
            Source: {agency || f.sourceAgency} published procurement forecast
            {f.sourceUrl && (
              <>
                {' '}(<a href={f.sourceUrl} target="_blank" rel="noopener noreferrer nofollow" className="text-(--mp-navy) hover:underline">original source ↗</a>)
              </>
            )}
            . A forecast is a plan, not a solicitation: dates, values and set-asides can change.
          </p>
        </section>

        <div className="mt-8 border border-(--mp-line) rounded-lg p-6 bg-(--mp-wash)">
          <h2 className="text-lg font-bold text-(--mp-ink)">Get ahead of this requirement — free</h2>
          <ul className="mt-2 text-sm text-(--mp-body) list-disc pl-5 space-y-1">
            <li>Alert me when this forecast becomes a solicitation</li>
            <li>Save it to my pipeline</li>
            <li>See the forecast&apos;s point-of-contact details{f.hasPoc ? '' : ' (when the publisher lists one)'}</li>
          </ul>
          <div className="mt-4">
            <MemberAwareCta appearance="public" memberHref="/app" memberLabel="Open forecasts in Mindy →">
              <Link
                href="/signup"
                className="inline-block bg-(--mp-navy) hover:bg-(--mp-navy-hover) text-white font-semibold rounded-lg px-5 py-2.5 text-sm"
              >
                Sign up free to track this forecast →
              </Link>
            </MemberAwareCta>
          </div>
        </div>

        {more.length > 0 && (
          <section className="mt-10">
            <h2 className="text-lg font-semibold text-(--mp-ink) mb-3">More forecasts from {agency || f.sourceAgency}</h2>
            <div className="grid md:grid-cols-2 gap-3">
              {more.map((m) => (
                <Link
                  key={m.slug}
                  href={`/forecasts/${m.slug}`}
                  className="block border border-(--mp-hair) rounded-lg p-4 hover:border-(--mp-navy) hover:bg-(--mp-navy-wash) transition-colors"
                >
                  <div className="text-sm font-medium text-(--mp-ink) line-clamp-2">{m.title}</div>
                  <div className="text-xs text-(--mp-muted) mt-1">{[m.period, m.value].filter(Boolean).join(' · ') || NOT_STATED}</div>
                </Link>
              ))}
            </div>
          </section>
        )}

        <nav className="mt-10 pt-6 border-t border-(--mp-hair) text-sm flex flex-wrap gap-x-4 gap-y-1">
          {agencySeo && (
            <Link href={`/agencies/${agencySeo.slug}`} className="text-(--mp-navy) hover:underline">
              {agencySeo.name} contracting profile →
            </Link>
          )}
          {naicsPageExists(f.naicsCode) && (
            <Link href={`/naics/${f.naicsCode}`} className="text-(--mp-navy) hover:underline">
              NAICS {f.naicsCode} market →
            </Link>
          )}
          <Link href="/forecasts" className="text-(--mp-navy) hover:underline">All agency forecasts →</Link>
          <Link href="/opportunity-hunter" className="text-(--mp-navy) hover:underline">Open opportunities →</Link>
        </nav>
      </div>
    </main>
  );
}
