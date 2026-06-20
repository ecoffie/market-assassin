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
          url: `${SITE_URL}/contractors/${recipientSlug(award.recipient_name)}`,
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
    <main className="min-h-screen bg-slate-950 text-white">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <div className="mx-auto max-w-6xl px-6 pt-6 text-sm text-slate-400">
        <Link href="/" className="hover:text-purple-400">Home</Link>
        <span className="mx-2">/</span>
        <Link href="/awards" className="hover:text-purple-400">Awards</Link>
        <span className="mx-2">/</span>
        <span className="text-slate-300">{recipient}</span>
      </div>

      <section className="mx-auto max-w-6xl px-6 pt-6 pb-8">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-purple-400">
          Federal Contract Award
        </p>
        <h1 className="mt-3 text-3xl md:text-4xl font-bold tracking-tight">
          {recipient}
        </h1>
        <p className="mt-2 text-3xl font-bold font-mono text-purple-300">
          {fmtFullMoney(amount)}
        </p>
        <p className="mt-1 text-sm text-slate-400">
          {award.awarding_agency || 'Federal'} · {fmtDate(award.action_date)} · FY{award.fiscal_year}
        </p>
      </section>

      {/* Award details grid */}
      <section className="mx-auto max-w-6xl px-6 pb-10">
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-6 grid gap-4 md:grid-cols-2">
          <Field label="Award ID" value={award.award_id} mono />
          <Field label="PIID" value={award.piid || '—'} mono />
          <Field label="Obligation Amount" value={fmtFullMoney(amount)} />
          <Field label="Action Date" value={fmtDate(award.action_date)} />
          <Field label="Period of Performance" value={`${fmtDate(award.pop_start_date)} → ${fmtDate(award.pop_end_date)}`} />
          {award.contract_pricing_type && <Field label="Contract Pricing Type" value={award.contract_pricing_type} />}
          {award.set_aside && <Field label="Set-Aside" value={award.set_aside} />}
          {award.naics_code && (
            <Field
              label="NAICS Code"
              value={`${award.naics_code}${award.naics_description ? ` — ${award.naics_description}` : ''}`}
            />
          )}
          {award.psc_code && (
            <Field
              label="PSC Code"
              value={`${award.psc_code}${award.psc_description ? ` — ${award.psc_description}` : ''}`}
            />
          )}
          {(award.pop_city || award.pop_state) && (
            <Field
              label="Place of Performance"
              value={[award.pop_city, award.pop_state, award.pop_country].filter(Boolean).join(', ')}
            />
          )}
        </div>
      </section>

      {/* Recipient + Agency cards */}
      <section className="mx-auto max-w-6xl px-6 pb-10 grid gap-6 md:grid-cols-2">
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-6">
          <h2 className="text-lg font-bold mb-3">Recipient</h2>
          <Link
            href={`/contractors/${recipientSlug(award.recipient_name)}`}
            className="text-purple-400 hover:text-purple-300 font-semibold"
          >
            {recipient} →
          </Link>
          <dl className="mt-4 space-y-2 text-sm">
            <DescRow label="UEI" value={award.recipient_uei} mono />
            {award.cage_code && <DescRow label="CAGE Code" value={award.cage_code} mono />}
            {award.parent_name && <DescRow label="Parent" value={fmtCompanyName(award.parent_name)} />}
            {(award.recipient_city || award.recipient_state) && (
              <DescRow
                label="Address"
                value={[award.recipient_city, award.recipient_state].filter(Boolean).join(', ')}
              />
            )}
          </dl>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900 p-6">
          <h2 className="text-lg font-bold mb-3">Awarding Agency</h2>
          <p className="text-slate-200 font-semibold">{award.awarding_agency || '—'}</p>
          <dl className="mt-4 space-y-2 text-sm">
            {award.awarding_sub_agency && <DescRow label="Sub-Agency" value={award.awarding_sub_agency} />}
            {award.awarding_office && <DescRow label="Office" value={award.awarding_office} />}
            {award.funding_agency && <DescRow label="Funding Agency" value={award.funding_agency} />}
            {award.funding_office && <DescRow label="Funding Office" value={award.funding_office} />}
          </dl>
        </div>
      </section>

      {/* Description */}
      {award.description && (
        <section className="mx-auto max-w-6xl px-6 pb-10">
          <h2 className="text-lg font-bold mb-3">Contract Description</h2>
          <div className="rounded-xl border border-slate-800 bg-slate-900 p-6">
            <p className="text-slate-300 leading-relaxed">{award.description}</p>
          </div>
        </section>
      )}

      <section className="mx-auto max-w-6xl px-6 pb-16">
        <div className="rounded-2xl border border-purple-500/30 bg-gradient-to-br from-purple-900/40 to-slate-900 p-8 text-center">
          <h2 className="text-xl font-bold">See Every Contract {recipient} Has Won</h2>
          <p className="mt-3 max-w-2xl mx-auto text-slate-300 text-sm">
            Full contracting history, year-over-year trends, subaward graph, and recompete alerts.
          </p>
          <Link
            href={`/contractors/${recipientSlug(award.recipient_name)}`}
            className="mt-5 inline-flex rounded-xl bg-purple-600 px-5 py-2.5 font-semibold text-white hover:bg-purple-500 shadow-lg shadow-purple-500/20"
          >
            View {recipient} Profile →
          </Link>
        </div>
      </section>
    </main>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wider text-slate-500">{label}</p>
      <p className={`mt-1 text-slate-200 ${mono ? 'font-mono text-sm' : ''}`}>{value}</p>
    </div>
  );
}

function DescRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-slate-500">{label}</dt>
      <dd className={`text-slate-300 text-right ${mono ? 'font-mono text-xs' : ''}`}>{value}</dd>
    </div>
  );
}
