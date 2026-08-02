/**
 * /awards/[id] — single award detail page.
 *
 * Each URL is the USASpending contract_award_unique_key (`award_id`).
 * Examples: "CONT_AWD_W9133L18C0001_9700_-NONE-_-NONE-"
 *
 * Rendering model: ISR-only, 7-day revalidate. We DON'T prerender at
 * build because there are 63M+ possible awards. generateStaticParams
 * could return the top 10K but even that's a build hit we'd rather
 * amortize across real Google crawl. Sitemap only includes the top
 * 10K so the long-tail awards are discoverable but not crawled
 * directly.
 *
 * DESIGN (2026-08-02): restyled from the old dark/navy app look to the NEW MAP
 * design system — white surfaces, blue accent (--jan #2563eb), Inter, subtle
 * hairlines/shadows. Content + SEO structure (JSON-LD, headings, metadata) is
 * UNCHANGED so rankings are undisturbed; only the visual layer changes. Added
 * the parent IDV / vehicle drill-down (real, from award_detail_lookup).
 * NOTE: obligated-vs-ceiling is NOT shown — award_detail_lookup carries only
 * obligation_amount, not current/potential award value, so a "ceiling" here
 * would be a fabricated equal-to-obligated number. Showing it truthfully needs
 * the lookup view rebuilt to carry current_award_value; deferred rather than faked.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getAwardById } from '@/lib/bigquery/awards';
import { formatCompanyName as fmtCompanyName } from '@/lib/format-name';
import { formatMoneyCompact as fmtMoney, formatMoneyFull as fmtFullMoney } from '@/lib/format-money';
import { recipientSlug } from '@/lib/bigquery/recipients';

const SITE_URL = 'https://getmindy.ai';

export const revalidate = 604800; // 7d
export const dynamicParams = true;

export async function generateStaticParams() {
  return [];
}

function fmtDate(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

interface PageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const award = await getAwardById(decodeURIComponent(id));
  if (!award) return { title: 'Award Not Found | Mindy' };

  const recipient = fmtCompanyName(award.recipient_name);
  const amount = fmtMoney(Number(award.obligation_amount));
  const agency = award.awarding_agency || 'federal agency';
  // Lead the title with the contract number. Most organic traffic to this
  // page comes from searchers pasting a raw PIID (GSC: "19aqmm21f1496",
  // "140d0426p0078", …). Echoing that number first makes them recognize
  // their result in the SERP and click — the prior "{recipient} — {amount}"
  // title ranked well (pos 2-4) but drew ~0% CTR because it didn't visibly
  // match the query they typed.
  const contractNo = award.piid || award.award_id;
  const title = contractNo
    ? `Contract ${contractNo} — ${recipient}, ${amount} | Mindy`
    : `${recipient} — ${amount} ${agency} Contract Award | Mindy`;
  const description = `Federal contract ${contractNo}: ${recipient} received ${amount} from ${agency}${award.naics_description ? ` for ${award.naics_description}` : ''}. Action date ${fmtDate(award.action_date)}. View award details, period of performance, and NAICS.`;

  return {
    title,
    description,
    alternates: { canonical: `${SITE_URL}/awards/${id}` },
    openGraph: {
      title,
      description,
      url: `${SITE_URL}/awards/${id}`,
      type: 'article',
      siteName: 'Mindy',
    },
  };
}

export default async function AwardDetailPage({ params }: PageProps) {
  const { id } = await params;
  const award = await getAwardById(decodeURIComponent(id));
  if (!award) notFound();

  const recipient = fmtCompanyName(award.recipient_name);
  const amount = Number(award.obligation_amount);
  const firmHref = `/contractors/${recipientSlug(award.recipient_name)}`;
  const setAside = award.set_aside && !/no set aside/i.test(award.set_aside) ? award.set_aside : null;

  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'GovernmentService',
        '@id': `${SITE_URL}/awards/${id}#award`,
        name: `Federal Contract Award — ${recipient}`,
        provider: { '@type': 'GovernmentOrganization', name: award.awarding_agency || 'United States Federal Government' },
        recipient: {
          '@type': 'Organization',
          name: recipient,
          identifier: award.recipient_uei,
          url: `${SITE_URL}${firmHref}`,
        },
        description: award.description || `Federal contract award of ${fmtFullMoney(amount)} to ${recipient}`,
        url: `${SITE_URL}/awards/${id}`,
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: SITE_URL },
          { '@type': 'ListItem', position: 2, name: 'Awards', item: `${SITE_URL}/awards` },
          { '@type': 'ListItem', position: 3, name: `${recipient} — ${fmtMoney(amount)}`, item: `${SITE_URL}/awards/${id}` },
        ],
      },
    ],
  };

  return (
    <main className="min-h-screen bg-[#f5f8fb] text-[#111c26]" style={{ fontFamily: 'Inter, system-ui, sans-serif' }}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      {/* breadcrumb */}
      <div className="mx-auto max-w-5xl px-6 pt-6 text-[13px] font-medium text-[#6b7787]">
        <Link href="/" className="text-[#2563eb] hover:underline">Home</Link>
        <span className="mx-2">›</span>
        <Link href="/awards" className="text-[#2563eb] hover:underline">Awards</Link>
        <span className="mx-2">›</span>
        <span>{recipient}</span>
      </div>

      {/* hero */}
      <section className="mx-auto max-w-5xl px-6 pt-5 pb-6">
        <div className="flex items-start gap-4">
          <div className="flex-none w-[52px] h-[52px] rounded-[13px] flex items-center justify-center text-white text-[18px] font-extrabold"
            style={{ background: 'linear-gradient(135deg,#b45309,#f59e0b)' }}>$</div>
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#c2740a]">Federal Contract Award</p>
            <h1 className="mt-1.5 text-[26px] md:text-[30px] font-extrabold tracking-[-0.02em] leading-tight">{recipient}</h1>
            <p className="mt-1 text-[14px] text-[#6b7787]">
              {award.awarding_agency || 'Federal'} · {fmtDate(award.action_date)} · FY{award.fiscal_year}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {award.piid && <Pill mono>{award.piid}</Pill>}
              <Pill accent="open">{setAside || 'Full & Open'}</Pill>
              {award.naics_code && <Pill>NAICS {award.naics_code}</Pill>}
            </div>
          </div>
        </div>
      </section>

      {/* amount */}
      <section className="mx-auto max-w-5xl px-6 pb-6">
        <div className="rounded-[13px] border border-[#e6ebf0] bg-white px-5 py-4 inline-block">
          <p className="text-[11px] font-bold uppercase tracking-wide text-[#6b7787]">Obligated</p>
          <p className="mt-1 text-[26px] font-extrabold tracking-[-0.02em]">{fmtFullMoney(amount)}</p>
        </div>
      </section>

      {/* two columns: details + scope */}
      <section className="mx-auto max-w-5xl px-6 pb-6 grid gap-5 md:grid-cols-2">
        <div className="rounded-[14px] border border-[#e6ebf0] bg-white p-5">
          <h2 className="text-[15px] font-extrabold mb-1">Contract details</h2>
          <dl className="mt-2">
            <Row label="Award ID" value={award.award_id} mono />
            <Row label="PIID" value={award.piid || '—'} mono />
            <Row label="Period of performance" value={`${fmtDate(award.pop_start_date)} → ${fmtDate(award.pop_end_date)}`} />
            <Row label="Place of performance" value={[award.pop_city, award.pop_state, award.pop_country].filter(Boolean).join(', ') || '—'} />
            <Row label="Set-aside" value={setAside || 'None (Full & Open)'} />
            {award.contract_pricing_type && <Row label="Pricing type" value={award.contract_pricing_type} />}
            {award.psc_code && <Row label="PSC" value={`${award.psc_code}${award.psc_description ? ` — ${award.psc_description}` : ''}`} />}
            {award.naics_code && <Row label="NAICS" value={`${award.naics_code}${award.naics_description ? ` — ${award.naics_description}` : ''}`} />}
          </dl>
        </div>

        <div className="flex flex-col gap-5">
          {award.description && (
            <div className="rounded-[14px] border border-[#e6ebf0] bg-white p-5">
              <p className="text-[11px] font-bold uppercase tracking-wide text-[#6b7787]">Scope</p>
              <p className="mt-2 text-[14px] leading-relaxed text-[#3a4a5c]">{award.description}</p>
            </div>
          )}
          {/* Parent IDV / vehicle — the drill-down: is this a task order off a bigger vehicle? */}
          {award.parent_name && (
            <div className="rounded-[14px] border border-[#e6ebf0] bg-white p-5">
              <p className="text-[11px] font-bold uppercase tracking-wide text-[#6b7787]">Parent vehicle (IDV)</p>
              <p className="mt-2 text-[15px] font-bold">{fmtCompanyName(award.parent_name)}</p>
              {award.parent_uei && <p className="mt-1 text-[12px] font-mono text-[#6b7787]">UEI {award.parent_uei}</p>}
              <p className="mt-2 text-[12.5px] text-[#6b7787]">This award was placed as a task/delivery order under a larger contract vehicle.</p>
            </div>
          )}
        </div>
      </section>

      {/* recipient + agency */}
      <section className="mx-auto max-w-5xl px-6 pb-6 grid gap-5 md:grid-cols-2">
        <div className="rounded-[14px] border border-[#e6ebf0] bg-white p-5">
          <h2 className="text-[15px] font-extrabold mb-2">Recipient</h2>
          <Link href={firmHref} className="text-[#2563eb] hover:underline font-bold text-[15px]">{recipient} →</Link>
          <dl className="mt-3">
            <Row label="UEI" value={award.recipient_uei} mono />
            {award.cage_code && <Row label="CAGE" value={award.cage_code} mono />}
            {award.parent_name && <Row label="Parent" value={fmtCompanyName(award.parent_name)} />}
            {(award.recipient_city || award.recipient_state) && (
              <Row label="Address" value={[award.recipient_city, award.recipient_state].filter(Boolean).join(', ')} />
            )}
          </dl>
        </div>

        <div className="rounded-[14px] border border-[#e6ebf0] bg-white p-5">
          <h2 className="text-[15px] font-extrabold mb-2">Awarding agency</h2>
          {award.awarding_agency && (
            <Link href={`/agencies/${agencySlug(award.awarding_agency)}`} className="text-[#2563eb] hover:underline font-bold text-[15px]">
              {award.awarding_agency} →
            </Link>
          )}
          <dl className="mt-3">
            {award.awarding_sub_agency && <Row label="Sub-agency" value={award.awarding_sub_agency} />}
            {award.awarding_office && <Row label="Office" value={award.awarding_office} />}
            {award.funding_agency && <Row label="Funding agency" value={award.funding_agency} />}
            {award.funding_office && <Row label="Funding office" value={award.funding_office} />}
          </dl>
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-5xl px-6 pb-16">
        <div className="rounded-[16px] border border-[#dbe7ff] bg-[#eff5ff] p-7 text-center">
          <h2 className="text-[19px] font-extrabold text-[#111c26]">See every contract {recipient} has won</h2>
          <p className="mt-2 max-w-xl mx-auto text-[#3a4a5c] text-[14px]">
            Full contracting history, year-over-year trends, subaward graph, and recompete alerts.
          </p>
          <Link href={firmHref}
            className="mt-4 inline-flex rounded-[11px] bg-[#2563eb] px-5 py-2.5 font-bold text-white hover:brightness-110"
            style={{ boxShadow: '0 3px 10px -3px rgba(37,99,235,.5)' }}>
            View {recipient} profile →
          </Link>
        </div>
      </section>
    </main>
  );
}

// A very light agency-name → slug (matches how the agency pages build slugs). Kept local + simple:
// lowercased, non-alphanumerics to hyphens. Cold slugs 404 gracefully, same as before.
function agencySlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-3 py-[9px] border-b border-[#f0f3f7] last:border-0 text-[14px]">
      <dt className="text-[#6b7787]">{label}</dt>
      <dd className={`font-bold text-right ${mono ? 'font-mono text-[12px]' : ''}`}>{value}</dd>
    </div>
  );
}

function Pill({ children, mono, accent }: { children: React.ReactNode; mono?: boolean; accent?: 'open' }) {
  const cls = accent === 'open'
    ? 'bg-[#fff7ec] text-[#c2740a] border-[#f0d9b5]'
    : 'bg-[#f5f8fb] text-[#516072] border-[#e6ebf0]';
  return (
    <span className={`inline-flex items-center text-[11.5px] font-bold px-2.5 py-1 rounded-[14px] border ${cls} ${mono ? 'font-mono' : ''}`}>
      {children}
    </span>
  );
}
