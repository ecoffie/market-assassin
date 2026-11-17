/**
 * Data layer for the public DoD buying-office pages: /offices/[dodaac] (one page per DoDAAC).
 *
 * WHAT A DoDAAC IS HERE
 * ---------------------
 * A DoD solicitation number starts with the issuing office's 6-char DoDAAC
 * (W912PL-26-R-0001 → W912PL = USACE Los Angeles District). That prefix is the office key on BOTH
 * tables this page reads — `sam_opportunities.solicitation_number` and
 * `federal_contacts.solicitation_number` — exactly as the in-app office roster, the DoDAAC contact
 * anchoring and the open_opp_count backfill already use it (CLAUDE.md "DoD office anchoring").
 * The office NAME + parent come from the existing `dodaac_directory_display` view (the same source
 * loadDodaacNames() reads), never re-derived here.
 *
 * COST RULES (public, crawler-facing)
 * -----------------------------------
 *   - Supabase + KV only. NO BigQuery, ever (see src/lib/seo/live-bq.ts): a crawl must not be able
 *     to trigger a warehouse scan. "Recent awards" therefore comes from SAM award notices already
 *     cached in `sam_opportunities`, and the office's lifetime FPDS scale from the directory row
 *     that a script precomputed — not a live award query.
 *   - One indexed PK read + four small prefix reads, all in parallel. ISR caches the result.
 *
 * HONEST FAILURE
 * --------------
 * Every read binds `{ data, error }`. Any error — or a count PostgREST did not establish — throws
 * SeoTemporarilyUnavailableError (→ 5xx, not cached by ISR, Google retries) instead of rendering
 * a page that says the office has 0 bids or 0 contacts (Bug Prevention Rule #11). Only a directory
 * read that SUCCEEDED and found no DoD office may produce a 404.
 */
import { cache } from 'react';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { isValidDodaac } from '@/lib/gov-contacts/agency-key';
import { decodeDodaac } from '@/lib/gov-contacts/dodaac';
import { normalizeOfficeName } from '@/lib/gov-contacts/office-name';
import { DODAAC_PREFIX_COLUMN, dodaacPrefixPattern } from '@/lib/gov-contacts/dodaac-prefix';
import { CONTACT_KIND_GOVERNMENT } from '@/lib/gov-contacts/contact-kind';
import { isUsableContactCard } from '@/lib/gov-contacts/contact-quality';
import { roleQueryToBucket } from '@/lib/gov-contacts/contact-roster';
import { SeoTemporarilyUnavailableError } from '@/lib/seo/seo-unavailable';
import { opportunitySlug, isIndexableOpp } from '@/lib/seo/opportunities';
import { getServeableProfiles } from '@/lib/seo/served-slugs';
import { recipientSlug } from '@/lib/bigquery/recipients';
import { latestLastmod } from '@/lib/seo/sitemap-xml';
import {
  officeIndexable,
  officeSitemapEligible,
  isDodOffice,
  dodaacPrefixOf,
} from '@/lib/seo/office-gate';

/** How many contact rows one office page reads. A roster that hits it is shown as "N+". */
const CONTACT_READ_LIMIT = 5000;
const OPEN_LIST_LIMIT = 10;
const AWARD_LIST_LIMIT = 8;
const PAGE = 1000; // PostgREST max-rows

export interface OfficeOpenNotice {
  title: string;
  noticeType: string | null;
  responseDeadline: string | null;
  postedDate: string | null;
  /** Only set when /opportunity/<slug> would render (non-thin); otherwise shown unlinked. */
  slug: string | null;
}

export interface OfficeAwardNotice {
  title: string;
  awardee: string;
  amount: number | null;
  date: string | null;
  /** /contractors/<slug>, only when that profile is verified serveable (KV). */
  contractorSlug: string | null;
  /** /opportunity/<slug> when the award notice itself has a non-thin page. */
  slug: string | null;
}

export interface OfficePageData {
  dodaac: string;
  name: string;
  agency: string | null;
  subAgency: string | null;
  /** Precomputed FPDS scale from dodaac_directory (all years on file). null = not recorded. */
  fpdsActions: number | null;
  fpdsObligated: number | null;
  directoryAsOf: string | null;
  openCount: number;
  openNotices: OfficeOpenNotice[];
  activeNotices: number;
  awards: OfficeAwardNotice[];
  contacts: {
    /** Distinct usable government-buyer contacts (a floor when `capped`). */
    count: number;
    capped: boolean;
    roles: Array<{ role: string; count: number }>;
  };
  indexable: boolean;
  /** Latest posted date across what the page shows — a data date, never the render time. */
  lastModified: string | null;
}

function sb(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new SeoTemporarilyUnavailableError('offices: Supabase env missing');
  return createClient(url, key, { auth: { persistSession: false } });
}

function unavailable(dodaac: string, what: string, msg: string): never {
  throw new SeoTemporarilyUnavailableError(`office ${dodaac}: ${what} read failed: ${msg}`);
}

interface ContactRow {
  contact_fullname: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  contact_title: string | null;
  department_ind_agency: string | null;
  contact_kind: string | null;
}

/**
 * Distinct people + role mix. Pure (exported for the unit test). Names/emails never leave this
 * function — the public page shows only the count and the role buckets.
 */
export function summarizeContacts(rows: ContactRow[]): { count: number; roles: Array<{ role: string; count: number }> } {
  const seen = new Set<string>();
  const roles = new Map<string, number>();
  for (const r of rows) {
    if (!isUsableContactCard(r)) continue;
    const key = (r.contact_email || r.contact_fullname || '').trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const role = (r.contact_title && roleQueryToBucket(r.contact_title)) || 'Point of contact (role not stated)';
    roles.set(role, (roles.get(role) || 0) + 1);
  }
  return {
    count: seen.size,
    roles: Array.from(roles.entries())
      .map(([role, count]) => ({ role, count }))
      .sort((a, b) => b.count - a.count),
  };
}

/**
 * Everything one office page renders. null = the directory ANSWERED and this is not a DoD office
 * we know (→ 404). Throws SeoTemporarilyUnavailableError when any source could not answer.
 * Wrapped in React cache() so generateMetadata and the page share one set of reads per request.
 */
export const getOfficePageData = cache(async (rawCode: string): Promise<OfficePageData | null> => {
  const dodaac = String(rawCode || '').toUpperCase().trim();
  if (!isValidDodaac(dodaac)) return null;
  const pattern = dodaacPrefixPattern(dodaac)!; // validated above; `W912PL%`
  const client = sb();
  const nowIso = new Date().toISOString();

  const [dirRes, openRes, activeRes, awardRes, contactRes] = await Promise.all([
    client
      .from('dodaac_directory_display')
      .select('dodaac, display_name, agency, sub_agency, award_count, total_obligated, updated_at')
      .eq('dodaac', dodaac)
      .maybeSingle(),
    // Open now: still active, deadline ahead, not an award notice (same rule as by-office.ts).
    client
      .from('sam_opportunities')
      .select('notice_id, title, description, notice_type, response_deadline, posted_date', { count: 'exact' })
      .ilike('solicitation_number', pattern)
      .eq('active', true)
      .gt('response_deadline', nowIso)
      .not('notice_type', 'ilike', '%award%')
      .order('posted_date', { ascending: false })
      .limit(OPEN_LIST_LIMIT),
    // The gate's notice count — the SAME predicate the sitemap counts with.
    client
      .from('sam_opportunities')
      .select('notice_id', { count: 'exact', head: true })
      .ilike('solicitation_number', pattern)
      .eq('active', true),
    client
      .from('sam_opportunities')
      .select('notice_id, title, description, awardee_name, award_amount, award_date, posted_date')
      .ilike('solicitation_number', pattern)
      .ilike('notice_type', '%award%')
      .not('awardee_name', 'is', null)
      .order('posted_date', { ascending: false })
      .limit(AWARD_LIST_LIMIT),
    // Same predicates as withDodaacPrefix() + governmentBuyersOnly() (the trigram-indexed
    // `solicitation_number ILIKE 'W912PL%'` and the government-buyer contact_kind), written out
    // because nesting the two generic helpers inside Promise.all trips TS2589.
    client
      .from('federal_contacts')
      .select('contact_fullname, contact_email, contact_phone, contact_title, department_ind_agency, contact_kind')
      .ilike(DODAAC_PREFIX_COLUMN, pattern)
      .eq('contact_kind', CONTACT_KIND_GOVERNMENT)
      .limit(CONTACT_READ_LIMIT),
  ]);

  if (dirRes.error) unavailable(dodaac, 'directory', dirRes.error.message);
  if (openRes.error) unavailable(dodaac, 'open notices', openRes.error.message);
  if (activeRes.error) unavailable(dodaac, 'active notice count', activeRes.error.message);
  if (awardRes.error) unavailable(dodaac, 'award notices', awardRes.error.message);
  if (contactRes.error) unavailable(dodaac, 'contacts', contactRes.error.message);
  // A null count is UNKNOWN (a missing relation answers count=null, error=null). Never 0.
  if (openRes.count == null) unavailable(dodaac, 'open notices', 'count not established');
  if (activeRes.count == null) unavailable(dodaac, 'active notice count', 'count not established');

  const dir = dirRes.data as {
    dodaac: string; display_name: string | null; agency: string | null; sub_agency: string | null;
    award_count: number | null; total_obligated: number | string | null; updated_at: string | null;
  } | null;

  // Identity: the directory row (must be DoD), else the curated in-code DoD names in dodaac.ts.
  let rawName: string | null = null;
  if (dir) {
    if (!isDodOffice(dir.agency, dir.sub_agency)) return null;
    rawName = dir.display_name;
  } else {
    rawName = decodeDodaac(`${dodaac}26`)?.officeName ?? null;
    if (!rawName) return null;
  }
  const name = normalizeOfficeName(rawName || dodaac, { mode: 'expand' }) || dodaac;

  type OppRow = { notice_id: string; title: string | null; description: string | null; notice_type: string | null; response_deadline: string | null; posted_date: string | null };
  const openRows = (openRes.data ?? []) as OppRow[];
  const openNotices: OfficeOpenNotice[] = openRows
    .filter((r) => r.title && r.notice_id)
    .map((r) => ({
      title: r.title!,
      noticeType: r.notice_type,
      responseDeadline: r.response_deadline,
      postedDate: r.posted_date,
      // isIndexableOpp on title+description only: a sow-only notice may have a page too, but we
      // only link what we can prove renders (a subset — never a link to a 404).
      slug: isIndexableOpp({ title: r.title, description: r.description }) ? opportunitySlug(r.title, r.notice_id) : null,
    }));

  type AwardRow = { notice_id: string; title: string | null; description: string | null; awardee_name: string | null; award_amount: number | string | null; award_date: string | null; posted_date: string | null };
  const awardRows = ((awardRes.data ?? []) as AwardRow[]).filter((r) => r.awardee_name && r.awardee_name.trim());
  const awardeeSlugs = Array.from(new Set(awardRows.map((r) => recipientSlug(r.awardee_name!)).filter(Boolean)));
  // KV-only membership test. A KV failure means "don't link", never "doesn't exist" — it only
  // controls whether an awardee name is a link, so it does not fail the page.
  let serveable = new Set<string>();
  if (awardeeSlugs.length > 0) {
    try {
      serveable = new Set((await getServeableProfiles(awardeeSlugs)).profiles.keys());
    } catch {
      serveable = new Set();
    }
  }
  const awards: OfficeAwardNotice[] = awardRows.map((r) => {
    const s = recipientSlug(r.awardee_name!);
    const amt = r.award_amount == null ? null : Number(r.award_amount);
    return {
      title: r.title || 'Award notice',
      awardee: r.awardee_name!.trim(),
      amount: amt != null && Number.isFinite(amt) && amt > 0 ? amt : null,
      date: r.award_date || r.posted_date,
      contractorSlug: serveable.has(s) ? s : null,
      slug: r.title && isIndexableOpp({ title: r.title, description: r.description }) ? opportunitySlug(r.title, r.notice_id) : null,
    };
  });

  const contactRows = (contactRes.data ?? []) as ContactRow[];
  const summary = summarizeContacts(contactRows);
  const capped = contactRows.length >= CONTACT_READ_LIMIT;

  const fpdsActions = dir?.award_count == null ? null : Number(dir.award_count);
  const fpdsObligated = dir?.total_obligated == null ? null : Number(dir.total_obligated);

  return {
    dodaac,
    name,
    agency: dir?.agency ?? 'Department of Defense',
    subAgency: dir?.sub_agency ?? null,
    fpdsActions: fpdsActions != null && Number.isFinite(fpdsActions) && fpdsActions > 0 ? fpdsActions : null,
    fpdsObligated: fpdsObligated != null && Number.isFinite(fpdsObligated) && fpdsObligated > 0 ? fpdsObligated : null,
    directoryAsOf: dir?.updated_at ?? null,
    openCount: openRes.count,
    openNotices,
    activeNotices: activeRes.count,
    awards,
    contacts: { count: summary.count, capped, roles: summary.roles },
    indexable: officeIndexable({ activeNotices: activeRes.count, contacts: summary.count }),
    lastModified: latestLastmod([...openRows.map((r) => r.posted_date), ...awardRows.map((r) => r.posted_date)]),
  };
});

export interface OfficeSitemapRow {
  dodaac: string;
  lastModified: string | null;
}

/**
 * Offices the sitemap may advertise: a DoD directory row + ≥ OFFICE_MIN_ACTIVE_NOTICES active SAM
 * notices under that prefix (officeSitemapEligible — a subset of the page's index gate).
 *
 * One paged read of active notices' solicitation numbers (the same population the opportunity
 * sitemap already drains), grouped in memory by the exact prefix rule the page's ILIKE uses, then
 * one `.in()` directory read per 200 candidates. Throws on any read error → the route answers 503.
 */
export async function getOfficeSitemapEntries(): Promise<OfficeSitemapRow[]> {
  const client = sb();
  const counts = new Map<string, { n: number; latest: string | null }>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await client
      .from('sam_opportunities')
      .select('notice_id, solicitation_number, posted_date')
      .eq('active', true)
      .not('solicitation_number', 'is', null)
      .order('notice_id', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`office sitemap: notices page ${from / PAGE}: ${error.message}`);
    const page = (data ?? []) as Array<{ solicitation_number: string | null; posted_date: string | null }>;
    for (const r of page) {
      const p = dodaacPrefixOf(r.solicitation_number);
      if (!p) continue;
      const cur = counts.get(p) || { n: 0, latest: null };
      cur.n += 1;
      cur.latest = latestLastmod([cur.latest, r.posted_date]);
      counts.set(p, cur);
    }
    if (page.length < PAGE) break;
    if (from > 300_000) throw new Error('office sitemap: runaway pagination');
  }

  const candidates = Array.from(counts.entries())
    .filter(([code, c]) => isValidDodaac(code) && officeSitemapEligible(c.n))
    .map(([code]) => code)
    .sort();

  const out: OfficeSitemapRow[] = [];
  for (let i = 0; i < candidates.length; i += 200) {
    const chunk = candidates.slice(i, i + 200);
    const { data, error } = await client
      .from('dodaac_directory_display')
      .select('dodaac, agency, sub_agency')
      .in('dodaac', chunk);
    if (error) throw new Error(`office sitemap: directory chunk ${i / 200}: ${error.message}`);
    for (const d of (data ?? []) as Array<{ dodaac: string; agency: string | null; sub_agency: string | null }>) {
      const code = String(d.dodaac || '').toUpperCase();
      if (!counts.has(code) || !isDodOffice(d.agency, d.sub_agency)) continue;
      out.push({ dodaac: code, lastModified: counts.get(code)!.latest });
    }
  }
  return out.sort((a, b) => a.dodaac.localeCompare(b.dodaac));
}
