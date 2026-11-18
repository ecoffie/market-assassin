/**
 * /recompetes/[slug] — one public, indexable record page per expiring federal contract
 * (2026-11-17). GovTribe-style record page that ends in a free sign-up.
 *
 * Path: /recompetes/<incumbent-agency>--<contract_id>. NOT /expiring-contracts — that path
 * 308s to `/` (retired product, next.config.ts).
 *
 * WHAT IS FREE: the record itself — PIID, incumbent, agency, NAICS, PSC, current end date, value,
 * and an ESTIMATED rebid window. WHAT IS GATED (owner decision): the "track this recompete" alert,
 * change-history detail (only that history exists + its count is public) and contacts.
 *
 * DATA DISCIPLINE: every field comes from recompete_opportunities; an absent field reads
 * "Not stated", never 0. A grouped_synthetic / quarantined row is not a contract → 404. A read
 * failure throws SeoTemporarilyUnavailableError (5xx, not cached) — never a false 404 or an empty
 * page (same contract as /awards/[id]).
 *
 * INDEXING: the thin gate (recompeteIndexVerdict) decides robots. A real row that fails it — no
 * named incumbent, no agency, no stated value, a legacy non-USASpending id, or an end date more
 * than 90 days past — still renders (a shared link must not break) but is noindex,follow and is
 * never in the sitemap.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { cache } from 'react';
import { notFound, permanentRedirect } from 'next/navigation';
import MemberAwareCta from '@/components/MemberAwareCta';
import { AGENCIES_SEO } from '@/data/agencies-seo';
import { getNaicsTopEntry } from '@/data/naics-top100';
import { recipientSlug } from '@/lib/bigquery/recipients';
import { formatCompanyName } from '@/lib/format-name';
import { formatMoneyCompact, formatMoneyFull } from '@/lib/format-money';
import { awardHref, isLinkableAwardId, servableAwardIds } from '@/lib/seo/award-links';
import {
  contractIdFromSlug,
  estimateRebidWindow,
  getOtherAgencyRecompetes,
  getRecompeteById,
  getRecompeteChangeCount,
  headlineValue,
  isGeneratedAwardId,
  recompeteIndexVerdict,
  recompeteSlug,
  type RebidWindow,
  type RecompeteRecord,
} from '@/lib/seo/recompetes';

const SITE_URL = 'https://getmindy.ai';
const NOT_STATED = 'Not stated';

export const dynamicParams = true;
export const revalidate = 86400; // 1d — the sync re-checks every contract several times a day

export async function generateStaticParams() {
  return []; // ISR-only: ~100K records render on first crawl, then cache
}

interface PageProps {
  params: Promise<{ slug: string }>;
}

/** One read per request shared by generateMetadata and the page. */
const loadRecord = cache(async (slug: string): Promise<RecompeteRecord | null> => {
  const id = contractIdFromSlug(slug);
  if (!id) return null;
  return getRecompeteById(id);
});

const LINKABLE_AGENCIES = new Set(AGENCIES_SEO.map((a) => a.slug));
function agencySlug(name: string): string {
  return name.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120);
}

function fmtDate(iso: string | null | undefined, style: 'long' | 'month' = 'long'): string {
  if (!iso) return NOT_STATED;
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return NOT_STATED;
  return style === 'month'
    ? d.toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })
    : d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

function money(n: number | null): string {
  return n == null ? NOT_STATED : formatMoneyFull(n);
}

function clamp(s: string, n = 158): string {
  const clean = s.replace(/\s+/g, ' ').trim();
  return clean.length > n ? `${clean.slice(0, n - 1).trimEnd()}…` : clean;
}

function incumbentLabel(r: RecompeteRecord): string {
  return r.incumbent_name ? formatCompanyName(r.incumbent_name) : NOT_STATED;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const r = await loadRecord(slug);
  if (!r) return { title: 'Contract not found | Mindy', robots: { index: false, follow: true } };

  const canonical = `${SITE_URL}/recompetes/${recompeteSlug(r)}`;
  const contractNo = r.piid || r.contract_id;
  const inc = incumbentLabel(r);
  const end = r.period_of_performance_current_end;
  const title = `${contractNo} — ${inc} contract expiring ${fmtDate(end, 'month')} | Mindy`;
  const agency = r.awarding_sub_agency || r.awarding_agency || 'a federal agency';
  const value = headlineValue(r);
  const description = clamp(
    `Contract ${contractNo} held by ${inc} at ${agency}` +
      (value != null ? `, worth ${formatMoneyCompact(value)}` : '') +
      (end ? `, ends ${fmtDate(end)}` : '') +
      (r.naics_code ? `. NAICS ${r.naics_code}${r.naics_description ? ` ${r.naics_description}` : ''}` : '') +
      '. See the estimated rebid window and track the recompete free with Mindy.',
  );
  const indexable = recompeteIndexVerdict(r).indexable;
  return {
    title,
    description,
    alternates: { canonical },
    robots: indexable ? undefined : { index: false, follow: true },
    openGraph: { title, description, url: canonical, type: 'article', siteName: 'Mindy' },
  };
}

const PHASE_COPY: Record<RebidWindow['phase'], string> = {
  before_sources_sought: 'Early: the estimated Sources Sought window has not opened yet.',
  sources_sought: 'Now inside the estimated Sources Sought / RFI window.',
  between: 'Between the estimated Sources Sought and RFP windows.',
  rfp: 'Now inside the estimated RFP window.',
  final_months: 'In the final months before the current end date.',
  ended: 'The current end date has passed. The work may have been extended, re-awarded, or recompeted.',
};

export default async function RecompetePage({ params }: PageProps) {
  const { slug } = await params;
  const r = await loadRecord(slug);
  if (!r) notFound();

  const canonicalSlug = recompeteSlug(r);
  let requested = slug;
  try { requested = decodeURIComponent(slug); } catch { /* keep raw */ }
  if (requested !== canonicalSlug) permanentRedirect(`/recompetes/${canonicalSlug}`);

  const [changeCount, related, servable] = await Promise.all([
    getRecompeteChangeCount(r.contract_id),
    getOtherAgencyRecompetes(r),
    isGeneratedAwardId(r.contract_id) && isLinkableAwardId(r.contract_id)
      ? servableAwardIds([r.contract_id])
      : Promise.resolve(new Set<string>()),
  ]);

  const inc = incumbentLabel(r);
  const contractNo = r.piid || r.contract_id;
  const firmHref = r.incumbent_name ? `/contractors/${recipientSlug(r.incumbent_name)}` : null;
  const agencyHref = r.awarding_agency && LINKABLE_AGENCIES.has(agencySlug(r.awarding_agency))
    ? `/agencies/${agencySlug(r.awarding_agency)}`
    : null;
  const naicsHref = r.naics_code && getNaicsTopEntry(r.naics_code) ? `/naics/${r.naics_code}` : null;
  const awardLink = servable.has(r.contract_id) ? awardHref(r.contract_id) : null;
  const rebid = estimateRebidWindow(r.period_of_performance_current_end);
  const isOrder = r.award_kind === 'order_under_vehicle';
  const memberHref = `/opportunity-map?recompete=${encodeURIComponent(r.contract_id)}`;
  const place = [r.place_of_performance_city, r.place_of_performance_state].filter(Boolean).join(', ');

  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'GovernmentService',
        name: `Federal contract ${contractNo}`,
        serviceType: 'Federal contract nearing expiration',
        provider: { '@type': 'GovernmentOrganization', name: r.awarding_agency || 'U.S. Federal Government' },
        ...(r.description ? { description: clamp(r.description, 300) } : {}),
        url: `${SITE_URL}/recompetes/${canonicalSlug}`,
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: SITE_URL },
          { '@type': 'ListItem', position: 2, name: 'Recompetes', item: `${SITE_URL}/recompetes` },
          { '@type': 'ListItem', position: 3, name: contractNo, item: `${SITE_URL}/recompetes/${canonicalSlug}` },
        ],
      },
    ],
  };

  return (
    <main className="bg-white">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <div className="max-w-4xl mx-auto px-4 py-10">
        <nav className="text-xs text-(--mp-muted) mb-4">
          <Link href="/" className="hover:underline">Home</Link>
          <span className="mx-1.5">/</span>
          <Link href="/recompetes" className="hover:underline">Recompetes</Link>
          <span className="mx-1.5">/</span>
          <span>{contractNo}</span>
        </nav>

        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-(--mp-muted)">
          Expiring federal contract{isOrder ? ' · order under a contract vehicle' : ''}
        </p>
        <h1 className="text-2xl md:text-3xl font-bold text-(--mp-ink) leading-tight font-(family-name:--mp-font-serif)">
          {contractNo} — {inc}
        </h1>
        <p className="text-sm text-(--mp-muted) mt-2">
          {r.awarding_agency || NOT_STATED}
          {r.awarding_sub_agency && r.awarding_sub_agency !== r.awarding_agency && <span> · {r.awarding_sub_agency}</span>}
          {r.awarding_office && <span> · {r.awarding_office}</span>}
        </p>

        {/* Fact strip — every field always shown; absent reads "Not stated". */}
        <dl className="grid grid-cols-2 md:grid-cols-3 gap-3 mt-6">
          {([
            ['Contract / PIID', contractNo],
            ['Incumbent', inc],
            ['Incumbent UEI', r.incumbent_uei || NOT_STATED],
            ['Current end date', fmtDate(r.period_of_performance_current_end)],
            ['Potential total value', money(r.potential_total_value)],
            ['Obligated', money(r.total_obligation)],
            ['NAICS', r.naics_code ? `${r.naics_code}${r.naics_description ? ` — ${r.naics_description}` : ''}` : NOT_STATED],
            ['PSC', r.psc_code ? `${r.psc_code}${r.psc_description ? ` — ${r.psc_description}` : ''}` : NOT_STATED],
            ['Set-aside', r.set_aside || NOT_STATED],
            ['Start date', fmtDate(r.period_of_performance_start)],
            ['Place of performance', place || NOT_STATED],
            ['Award type', r.contract_type || NOT_STATED],
          ] as Array<[string, string]>).map(([label, v]) => (
            <div key={label} className="bg-(--mp-wash) border border-(--mp-hair) rounded-lg p-3">
              <dt className="text-[11px] uppercase tracking-wide text-(--mp-muted) font-semibold">{label}</dt>
              <dd className="text-sm text-(--mp-ink) mt-0.5 break-words">{v}</dd>
            </div>
          ))}
        </dl>
        {r.last_synced_at && (
          <p className="text-xs text-(--mp-muted) mt-2">
            Source: USASpending.gov award record, last checked {fmtDate(r.last_synced_at)}. Place of performance as reported by USASpending.
          </p>
        )}

        {r.description && (
          <section className="mt-8">
            <h2 className="text-lg font-semibold text-(--mp-ink) mb-2">What the contract covers</h2>
            <p className="text-(--mp-body) leading-relaxed whitespace-pre-wrap">{r.description.slice(0, 3000)}</p>
          </section>
        )}

        {/* Rebid window — an ESTIMATE from the end date, labelled as one. */}
        <section className="mt-8">
          <h2 className="text-lg font-semibold text-(--mp-ink) mb-2">Likely rebid window (estimate)</h2>
          {rebid ? (
            <>
              <ul className="text-sm text-(--mp-body) space-y-1">
                <li>
                  <span className="font-semibold">Sources Sought / RFI:</span> about {fmtDate(rebid.sourcesSought.from, 'month')} – {fmtDate(rebid.sourcesSought.to, 'month')} (6–12 months before the end date)
                </li>
                <li>
                  <span className="font-semibold">RFP:</span> about {fmtDate(rebid.rfp.from, 'month')} – {fmtDate(rebid.rfp.to, 'month')} (2–4 months before the end date)
                </li>
              </ul>
              <p className="text-sm text-(--mp-body) mt-2">{PHASE_COPY[rebid.phase]}</p>
              {isOrder && (
                <p className="text-sm text-(--mp-body) mt-2">
                  This is an order under contract vehicle {r.parent_vehicle_piid || '(parent not recorded)'}. Orders are usually
                  not competed on their own: the next order may be placed under the same vehicle.
                </p>
              )}
              <p className="text-xs text-(--mp-muted) mt-2">
                Estimated from the current end date using typical federal recompete timing. Agencies set their own schedules,
                and contracts are often extended. This is not a published solicitation date.
              </p>
            </>
          ) : (
            <p className="text-sm text-(--mp-body)">Not stated: the record has no end date, so no window can be estimated.</p>
          )}
        </section>

        {/* Gated: alerts, change history detail, contacts. */}
        <section className="mt-8 border border-(--mp-line) rounded-lg p-6 bg-(--mp-wash)">
          <h2 className="text-lg font-bold text-(--mp-ink)">Track this recompete free</h2>
          <ul className="text-sm text-(--mp-body) mt-3 space-y-2">
            <li>
              <span className="font-semibold">Change history:</span>{' '}
              {changeCount == null
                ? 'unavailable right now.'
                : changeCount === 0
                  ? 'no changes recorded since Mindy began tracking this contract.'
                  : `${changeCount.toLocaleString('en-US')} recorded change${changeCount === 1 ? '' : 's'} to the end date, value or incumbent. Sign up to see each one.`}
            </li>
            <li><span className="font-semibold">Alerts:</span> get an email when the end date moves or the follow-on is posted.</li>
            <li><span className="font-semibold">Contacts:</span> the buying office and small-business contacts for this agency.</li>
          </ul>
          <div className="mt-4">
            <MemberAwareCta appearance="public" memberHref={memberHref} memberLabel="Open in Mindy →">
              <Link
                href="/app/signup"
                className="inline-block bg-(--mp-navy) hover:bg-(--mp-navy-hover) text-white font-semibold rounded-lg px-5 py-2.5 text-sm"
              >
                Sign up free to track it →
              </Link>
            </MemberAwareCta>
          </div>
        </section>

        {/* Other contracts expiring at this agency — scoped by agency + NAICS inside the query. */}
        <section className="mt-10">
          <h2 className="text-lg font-semibold text-(--mp-ink) mb-3">
            Other contracts expiring at {r.awarding_agency || 'this agency'}{r.naics_code ? ` (NAICS ${r.naics_code})` : ''}
          </h2>
          {related == null ? (
            <p className="text-sm text-(--mp-muted)">This list is unavailable right now.</p>
          ) : related.length === 0 ? (
            <p className="text-sm text-(--mp-muted)">No other upcoming contracts on record for this agency and NAICS.</p>
          ) : (
            <ul className="divide-y divide-(--mp-hair) border border-(--mp-hair) rounded-lg">
              {related.map((x) => (
                <li key={x.href} className="p-3 text-sm">
                  <Link href={x.href} className="text-(--mp-navy) hover:underline font-medium">
                    {x.piid || 'Contract'} — {x.incumbent_name ? formatCompanyName(x.incumbent_name) : NOT_STATED}
                  </Link>
                  <span className="text-(--mp-muted)">
                    {' '}· ends {fmtDate(x.end)}{x.value != null ? ` · ${formatMoneyCompact(x.value)}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <nav className="mt-10 pt-6 border-t border-(--mp-hair) text-sm flex flex-wrap gap-x-4 gap-y-1">
          {firmHref && <Link href={firmHref} className="text-(--mp-navy) hover:underline">{inc} contractor profile →</Link>}
          {agencyHref && <Link href={agencyHref} className="text-(--mp-navy) hover:underline">{r.awarding_agency} →</Link>}
          {naicsHref && <Link href={naicsHref} className="text-(--mp-navy) hover:underline">NAICS {r.naics_code} →</Link>}
          {awardLink && <Link href={awardLink} className="text-(--mp-navy) hover:underline">Award record →</Link>}
          <Link href="/recompetes" className="text-(--mp-navy) hover:underline">All expiring contracts →</Link>
        </nav>
      </div>
    </main>
  );
}
