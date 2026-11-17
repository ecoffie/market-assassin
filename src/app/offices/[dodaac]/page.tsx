/**
 * /offices/[dodaac] — public, indexable page for one DoD buying office (DoD / DLA / Navy / Army /
 * Air Force …), keyed by its 6-char DoDAAC (W912PL = USACE Los Angeles District).
 *
 * Keyword targets: "<office name> contracting office", "<DODAAC>", "<office> open solicitations",
 * "<office> contracting officer".
 *
 * What is public vs gated (owner decision): counts and role mix are public; contact names, emails
 * and phones, office alerts and full history sit behind a FREE Mindy account.
 *
 * Data: src/lib/seo/offices.ts — Supabase + KV only, never BigQuery on a crawl. A read failure
 * throws SeoTemporarilyUnavailableError (5xx, not cached) rather than rendering a zero.
 * Thin-content gate: src/lib/seo/office-gate.ts (thin offices render with robots noindex).
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, permanentRedirect } from 'next/navigation';
import MemberAwareCta from '@/components/MemberAwareCta';
import { getOfficePageData, type OfficePageData } from '@/lib/seo/offices';
import { formatCompanyName } from '@/lib/format-name';
import { formatMoneyCompact } from '@/lib/format-money';

export const dynamicParams = true;
export const revalidate = 86400; // 1d — notices and contacts change daily

export async function generateStaticParams() {
  return []; // ISR-only; pages render on first crawl, then cache
}

const SITE_URL = 'https://getmindy.ai';
const DOD_AGENCY_SLUG = 'department-of-defense'; // src/data/agencies-seo.ts

function fmtDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return isNaN(d.getTime())
    ? null
    : d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

const n = (x: number) => x.toLocaleString('en-US');

/** The free-signup link. The landing page and referrer are already captured by the root
 *  AttributionTracker (gca_attr first/last touch); src/office tag the last touch with the office. */
function signupHref(dodaac: string): string {
  return `/app/signup?src=seo_office&office=${encodeURIComponent(dodaac)}`;
}

function parentLabel(o: OfficePageData): string {
  return o.subAgency && o.subAgency !== o.agency ? `${o.subAgency} · ${o.agency ?? 'Department of Defense'}` : (o.agency ?? 'Department of Defense');
}

export async function generateMetadata({ params }: { params: Promise<{ dodaac: string }> }): Promise<Metadata> {
  const { dodaac } = await params;
  const o = await getOfficePageData(dodaac);
  if (!o) {
    return { title: 'Office not found | Mindy', robots: { index: false, follow: true } };
  }
  const url = `${SITE_URL}/offices/${o.dodaac}`;
  const title = `${o.name} (${o.dodaac}) — Contracting Office, Open Bids & Contacts | Mindy`;
  const parts = [
    `${o.name} (DoDAAC ${o.dodaac}), ${parentLabel(o)}.`,
    `${n(o.openCount)} open ${o.openCount === 1 ? 'bid' : 'bids'} now`,
    `${n(o.activeNotices)} active SAM.gov ${o.activeNotices === 1 ? 'notice' : 'notices'}`,
    `${n(o.contacts.count)}${o.contacts.capped ? '+' : ''} named buying ${o.contacts.count === 1 ? 'contact' : 'contacts'}.`,
    'Get free alerts for this office.',
  ];
  const description = `${parts[0]} ${parts[1]}, ${parts[2]}, ${parts[3]} ${parts[4]}`;
  return {
    title: title.length > 70 ? `${o.name.slice(0, 40)}… (${o.dodaac}) — Contracting Office | Mindy` : title,
    description,
    alternates: { canonical: url },
    robots: o.indexable ? { index: true, follow: true } : { index: false, follow: true },
    openGraph: { title, description, type: 'website', url },
  };
}

function jsonLd(o: OfficePageData) {
  const url = `${SITE_URL}/offices/${o.dodaac}`;
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'GovernmentOrganization',
        name: o.name,
        identifier: { '@type': 'PropertyValue', propertyID: 'DoDAAC', value: o.dodaac },
        url,
        parentOrganization: {
          '@type': 'GovernmentOrganization',
          name: o.subAgency || o.agency || 'Department of Defense',
          ...(o.subAgency && o.agency && o.subAgency !== o.agency
            ? { parentOrganization: { '@type': 'GovernmentOrganization', name: o.agency } }
            : {}),
        },
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: SITE_URL },
          { '@type': 'ListItem', position: 2, name: 'Department of Defense', item: `${SITE_URL}/agencies/${DOD_AGENCY_SLUG}` },
          { '@type': 'ListItem', position: 3, name: o.name, item: url },
        ],
      },
    ],
  };
}

export default async function OfficePage({ params }: { params: Promise<{ dodaac: string }> }) {
  const { dodaac } = await params;
  const upper = decodeURIComponent(dodaac).toUpperCase().trim();
  if (upper !== dodaac) permanentRedirect(`/offices/${encodeURIComponent(upper)}`);
  const o = await getOfficePageData(upper);
  if (!o) notFound();

  return (
    <main className="bg-white">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd(o)) }} />

      <div className="max-w-4xl mx-auto px-4 py-10">
        <nav className="text-xs text-(--mp-muted) mb-4">
          <Link href="/" className="hover:underline">Home</Link>
          <span className="mx-1.5">/</span>
          <Link href={`/agencies/${DOD_AGENCY_SLUG}`} className="hover:underline">Department of Defense</Link>
          <span className="mx-1.5">/</span>
          <span>{o.dodaac}</span>
        </nav>

        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-(--mp-muted)">
          DoD contracting office · DoDAAC {o.dodaac}
        </p>
        <h1 className="text-2xl md:text-3xl font-bold text-(--mp-ink) leading-tight font-(family-name:--mp-font-serif)">
          {o.name}
        </h1>
        <p className="text-sm text-(--mp-muted) mt-2">{parentLabel(o)}</p>

        {/* Counts first. Every number is a live read; a failed read is a 5xx, never a 0 here. */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-6">
          <Fact label="Open bids now" value={n(o.openCount)} />
          <Fact label="Active SAM.gov notices" value={n(o.activeNotices)} />
          <Fact label="Named buying contacts" value={`${n(o.contacts.count)}${o.contacts.capped ? '+' : ''}`} />
          {o.fpdsObligated != null && (
            <Fact label="Obligated (FPDS, all years on file)" value={formatMoneyCompact(o.fpdsObligated)} />
          )}
        </div>
        <p className="text-xs text-(--mp-muted) mt-2">
          Notices are SAM.gov solicitations whose number starts with {o.dodaac}. &ldquo;Active&rdquo; is
          SAM&rsquo;s own flag (open or recently closed).
          {o.fpdsActions != null &&
            ` FPDS scale: ${n(o.fpdsActions)} contract actions awarded by this office in the federal award data on file` +
              (fmtDate(o.directoryAsOf) ? ` (as of ${fmtDate(o.directoryAsOf)}).` : '.')}
        </p>

        {/* Open bids */}
        <section className="mt-8">
          <h2 className="text-lg font-semibold text-(--mp-ink) mb-3">Open bids at {o.name}</h2>
          {o.openNotices.length === 0 ? (
            <p className="text-sm text-(--mp-body)">
              SAM.gov shows no solicitation from {o.dodaac} open for responses right now. Get an alert the
              day this office posts its next one.
            </p>
          ) : (
            <ul className="divide-y divide-(--mp-hair) border border-(--mp-hair) rounded-lg">
              {o.openNotices.map((x, i) => (
                <li key={`${x.slug ?? x.title}-${i}`} className="p-4">
                  {x.slug ? (
                    <Link href={`/opportunity/${x.slug}`} className="text-sm font-medium text-(--mp-navy) hover:underline">
                      {x.title}
                    </Link>
                  ) : (
                    <span className="text-sm font-medium text-(--mp-ink)">{x.title}</span>
                  )}
                  <div className="text-xs text-(--mp-muted) mt-1">
                    {[x.noticeType, fmtDate(x.responseDeadline) && `due ${fmtDate(x.responseDeadline)}`]
                      .filter(Boolean)
                      .join(' · ')}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {o.openCount > o.openNotices.length && (
            <p className="text-xs text-(--mp-muted) mt-2">
              Showing the {o.openNotices.length} most recently posted of {n(o.openCount)} open bids. See all
              of them, with alerts, in a free Mindy account.
            </p>
          )}
        </section>

        {/* Recent award notices (SAM award notices already cached — no warehouse scan) */}
        {o.awards.length > 0 && (
          <section className="mt-8">
            <h2 className="text-lg font-semibold text-(--mp-ink) mb-3">Recent awards announced by this office</h2>
            <ul className="divide-y divide-(--mp-hair) border border-(--mp-hair) rounded-lg">
              {o.awards.map((a, i) => (
                <li key={`${a.title}-${i}`} className="p-4">
                  <div className="text-sm text-(--mp-ink)">
                    {a.contractorSlug ? (
                      <Link href={`/contractors/${a.contractorSlug}`} className="font-medium text-(--mp-navy) hover:underline">
                        {formatCompanyName(a.awardee)}
                      </Link>
                    ) : (
                      <span className="font-medium">{formatCompanyName(a.awardee)}</span>
                    )}
                    {a.amount != null && <span className="text-(--mp-muted)"> · {formatMoneyCompact(a.amount)}</span>}
                    {fmtDate(a.date) && <span className="text-(--mp-muted)"> · {fmtDate(a.date)}</span>}
                  </div>
                  <div className="text-xs text-(--mp-muted) mt-1">
                    {a.slug ? (
                      <Link href={`/opportunity/${a.slug}`} className="hover:underline">{a.title}</Link>
                    ) : (
                      a.title
                    )}
                  </div>
                </li>
              ))}
            </ul>
            <p className="text-xs text-(--mp-muted) mt-2">Source: SAM.gov award notices posted by {o.dodaac}.</p>
          </section>
        )}

        {/* Contacts: count + roles public; people gated behind a free account */}
        <section className="mt-8">
          <h2 className="text-lg font-semibold text-(--mp-ink) mb-2">Who buys at this office</h2>
          {o.contacts.count === 0 ? (
            <p className="text-sm text-(--mp-body)">
              No government buyer is named on this office&rsquo;s SAM.gov notices yet.
            </p>
          ) : (
            <>
              <p className="text-sm text-(--mp-body)">
                {n(o.contacts.count)}{o.contacts.capped ? '+' : ''} government{' '}
                {o.contacts.count === 1 ? 'buyer is' : 'buyers are'} named as points of contact on{' '}
                {o.dodaac}&rsquo;s SAM.gov notices. By role:
              </p>
              <ul className="mt-3 flex flex-wrap gap-2">
                {o.contacts.roles.map((r) => (
                  <li key={r.role} className="text-xs rounded-full border border-(--mp-line) bg-(--mp-wash) px-3 py-1 text-(--mp-body)">
                    {r.role}: {n(r.count)}
                  </li>
                ))}
              </ul>
              <p className="text-xs text-(--mp-muted) mt-2">
                Names, emails and phone numbers are in your free Mindy account.
              </p>
            </>
          )}
        </section>

        {/* CTA — free signup */}
        <div className="mt-8 border border-(--mp-line) rounded-lg p-6 bg-(--mp-wash)">
          <h2 className="text-lg font-bold text-(--mp-ink)">Get alerts for {o.name}</h2>
          <p className="text-sm text-(--mp-muted) mt-1">
            Mindy emails you the morning {o.dodaac} posts a new solicitation, and unlocks this office&rsquo;s
            full contact roster and notice history. Free.
          </p>
          <div className="mt-4">
            <MemberAwareCta appearance="public" memberHref="/app" memberLabel="Open in Mindy →">
              <Link
                href={signupHref(o.dodaac)}
                className="inline-block bg-(--mp-navy) hover:bg-(--mp-navy-hover) text-white font-semibold rounded-lg px-5 py-2.5 text-sm"
              >
                Get free alerts for this office →
              </Link>
            </MemberAwareCta>
          </div>
        </div>

        <nav className="mt-10 pt-6 border-t border-(--mp-hair) text-sm flex flex-wrap gap-x-4 gap-y-1">
          <Link href={`/agencies/${DOD_AGENCY_SLUG}`} className="text-(--mp-navy) hover:underline">
            Department of Defense contracting overview →
          </Link>
          <Link href="/opportunity-hunter" className="text-(--mp-navy) hover:underline">Browse all opportunities →</Link>
          <Link href="/forecasts" className="text-(--mp-navy) hover:underline">Agency forecasts →</Link>
        </nav>
      </div>
    </main>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-(--mp-wash) border border-(--mp-hair) rounded-lg p-3">
      <div className="text-[11px] uppercase tracking-wide text-(--mp-muted) font-semibold">{label}</div>
      <div className="text-xl font-bold text-(--mp-ink) mt-0.5">{value}</div>
    </div>
  );
}
