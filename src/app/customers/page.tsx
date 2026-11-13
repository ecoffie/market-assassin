/**
 * /customers — public proof page: federal contracts won by companies that use Mindy.
 *
 * Every number is DERIVED from the member contract-wins snapshot (written by
 * /api/admin/member-contract-wins), never typed by hand. Totals and buckets of 3+ companies only;
 * nothing on this page names or identifies a company. A missing or stale snapshot shows a calm
 * "being refreshed" state, never a zero. Money and counts are rounded DOWN.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { readMemberProof } from '@/lib/admin/member-wins-snapshot';
import { proofCount, proofDollars, toCustomerStats, type StatBucket, type StatBucketSet } from '@/lib/admin/member-proof-format';

export const revalidate = 3600;

const PAGE_URL = 'https://getmindy.ai/customers';
const DESC = 'Federal contract wins by companies that use Mindy: totals since joining and lifetime, by agency and industry.';

export const metadata: Metadata = {
  title: 'Customer results | Mindy',
  description: DESC,
  alternates: { canonical: PAGE_URL },
  openGraph: { title: 'Customer results | Mindy', description: DESC, url: PAGE_URL },
};

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="m-0 flex items-center gap-2 text-[13px] font-semibold uppercase tracking-[0.1em] text-(--mp-muted)">
      <span aria-hidden="true" className="inline-block h-2.5 w-2.5 rounded-[3px] bg-(--mp-navy)" />
      {children}
    </p>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-xl border border-(--mp-hair) bg-(--mp-surface) px-5 py-4">
      <div className="font-(family-name:--mp-font-serif) text-[30px] font-bold leading-tight text-(--mp-ink)">{value}</div>
      <div className="mt-1 text-[14px] leading-[1.4] text-(--mp-muted)">{label}</div>
    </div>
  );
}

function Column({ title, note, dollars, contracts, companies }: { title: string; note: string; dollars: number; contracts: number; companies: number }) {
  return (
    <section aria-label={title} className="rounded-2xl border border-(--mp-hair) bg-(--mp-paper) p-5 sm:p-6">
      <h2 className="m-0 text-[18px] font-semibold text-(--mp-ink)">{title}</h2>
      <p className="mt-1 mb-0 text-[14px] text-(--mp-subtle)">{note}</p>
      <div className="mt-5 grid gap-3">
        <Stat value={proofDollars(dollars)} label="in federal contracts" />
        <div className="grid grid-cols-2 gap-3">
          <Stat value={proofCount(contracts)} label="contracts won" />
          <Stat value={proofCount(companies)} label="companies with wins" />
        </div>
      </div>
    </section>
  );
}

function BarList({ title, set, rows }: { title: string; set?: StatBucketSet; rows?: StatBucket[] }) {
  const items = rows ?? set?.buckets ?? [];
  const other = set?.other ?? null;
  const max = Math.max(1, ...items.map((b) => b.dollars), other?.dollars ?? 0);
  if (!items.length) return null;
  return (
    <section className="rounded-2xl border border-(--mp-hair) bg-(--mp-surface) p-5 sm:p-6">
      <h2 className="m-0 font-(family-name:--mp-font-serif) text-[22px] font-bold text-(--mp-ink)">{title}</h2>
      <ul className="m-0 mt-5 grid list-none gap-4 p-0">
        {items.map((b) => (
          <BarRow key={b.key} label={b.label} dollars={b.dollars} contracts={b.contracts} max={max} />
        ))}
        {other && other.dollars > 0 && <BarRow label="Everything else" dollars={other.dollars} contracts={other.contracts} max={max} muted />}
      </ul>
    </section>
  );
}

function BarRow({ label, dollars, contracts, max, muted = false }: { label: string; dollars: number; contracts: number; max: number; muted?: boolean }) {
  const pct = Math.max(2, Math.round((dollars / max) * 100));
  return (
    <li>
      <div className="flex items-baseline justify-between gap-3 text-[15px]">
        <span className={muted ? 'text-(--mp-muted)' : 'text-(--mp-ink)'}>{label}</span>
        <span className="shrink-0 font-semibold text-(--mp-ink)">{proofDollars(dollars)}</span>
      </div>
      <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-(--mp-wash)" aria-hidden="true">
        <div className={`h-full rounded-full ${muted ? 'bg-(--mp-faint)' : 'bg-(--mp-navy)'}`} style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-1 text-[13px] text-(--mp-subtle)">{proofCount(contracts)} contracts</div>
    </li>
  );
}

function asOf(iso: string): string {
  const d = new Date(iso);
  return Number.isFinite(d.getTime())
    ? d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
    : '';
}

export default async function CustomersPage() {
  const s = toCustomerStats(await readMemberProof());

  return (
    <div className="bg-(--mp-paper)">
      <section className="mx-auto max-w-[1180px] px-4 pb-12 pt-14 sm:px-6 md:pt-20">
        <Eyebrow>Customer results</Eyebrow>
        <h1 className="mt-4 mb-0 max-w-[46rem] font-(family-name:--mp-font-serif) text-[38px] font-bold leading-[1.1] tracking-[-0.01em] text-(--mp-ink) sm:text-[50px]">
          What Mindy customers have <span className="text-(--mp-accent)">won.</span>
        </h1>
        <p className="mt-5 mb-0 max-w-[40rem] text-[18px] leading-[1.55] text-(--mp-body)">
          Federal contracts won by companies that use Mindy, counted from public award data. Totals only. We never show which
          company won what.
        </p>

        {s ? (
          <>
            <div className="mt-10 grid gap-3 sm:grid-cols-3">
              <Stat value={proofCount(s.members)} label="contractors use Mindy" />
              <Stat value={proofCount(s.sinceJoining.contracts)} label="contracts won since joining Mindy" />
              <Stat value={proofDollars(s.sinceJoining.dollars)} label="won since joining Mindy" />
            </div>
            <div className="mt-6 grid gap-4 md:grid-cols-2">
              <Column
                title="Since joining Mindy"
                note="Awards first made after the company's member joined."
                dollars={s.sinceJoining.dollars}
                contracts={s.sinceJoining.contracts}
                companies={s.sinceJoining.companiesWithWins}
              />
              <Column
                title="Lifetime"
                note="Every federal award these companies have received, before and after Mindy."
                dollars={s.lifetime.dollars}
                contracts={s.lifetime.contracts}
                companies={s.lifetime.companiesWithWins}
              />
            </div>
          </>
        ) : (
          <div role="status" className="mt-10 max-w-[40rem] rounded-2xl border border-(--mp-hair) bg-(--mp-surface) p-6">
            <h2 className="m-0 text-[18px] font-semibold text-(--mp-ink)">Stats are being refreshed</h2>
            <p className="mt-2 mb-0 text-[15px] leading-[1.55] text-(--mp-body)">
              We recount customer wins from federal award data regularly. Check back soon.
            </p>
          </div>
        )}
      </section>

      {s && (
        <div className="rounded-t-[40px] bg-(--mp-wash) py-12 md:rounded-t-[64px]">
          <div className="mx-auto grid max-w-[1180px] gap-4 px-4 sm:px-6 md:grid-cols-2">
            <BarList title="Top agencies" set={s.breakdowns.agencies} />
            <BarList title="Top industries" set={s.breakdowns.naics} />
          </div>
          {s.breakdowns.fiscalYears.length > 0 && (
            <div className="mx-auto mt-4 max-w-[1180px] px-4 sm:px-6">
              <BarList title="Wins by fiscal year" rows={s.breakdowns.fiscalYears} />
            </div>
          )}
          <p className="mx-auto mt-4 mb-0 max-w-[1180px] px-4 text-[13px] text-(--mp-subtle) sm:px-6">
            Agency, industry and year totals are lifetime awards. Each line combines at least {s.breakdowns.minCompaniesPerBucket}{' '}
            companies; smaller groups are counted in &ldquo;Everything else&rdquo; or left out.
          </p>
        </div>
      )}

      <section className="border-t border-(--mp-hair) bg-(--mp-paper)">
        <div className="mx-auto max-w-[760px] px-4 py-14 sm:px-6">
          <h2 className="m-0 font-(family-name:--mp-font-serif) text-[26px] font-bold text-(--mp-ink)">How we count</h2>
          <ul className="mt-4 mb-0 grid gap-2 pl-5 text-[16px] leading-[1.6] text-(--mp-body)">
            <li>
              We count only companies whose members saved their SAM.gov ID (UEI) in Mindy
              {s ? ` (${proofCount(s.companiesWithUei)} companies)` : ''}. Staff and demo accounts are left out.
            </li>
            <li>Awards come from federal award data (USASpending). A contract is one award with money obligated to it.</li>
            <li>&ldquo;Since joining Mindy&rdquo; counts awards first made on or after the date the member joined.</li>
            <li>&ldquo;Lifetime&rdquo; counts every award the company has received, including before Mindy.</li>
            <li>Numbers are rounded down, so we never overstate.{s ? ` As of ${asOf(s.computedAt)}.` : ''}</li>
          </ul>
        </div>
      </section>

      <section className="bg-(--mp-navy)">
        <div className="mx-auto max-w-[1180px] px-4 py-16 text-center sm:px-6">
          <h2 className="m-0 font-(family-name:--mp-font-serif) text-[32px] font-bold text-(--mp-surface)">Find your next federal contract.</h2>
          <p className="mx-auto mt-3 mb-0 max-w-[36rem] text-[17px] text-(--mp-navy-wash)">Try Mindy free for 14 days.</p>
          <Link href="/pricing" className="mt-7 inline-flex items-center rounded-xl bg-(--mp-surface) px-6 py-3.5 text-[16px] font-semibold text-(--mp-navy) no-underline">
            Start for free
          </Link>
        </div>
      </section>
    </div>
  );
}
