/**
 * Keyword EVIDENCE for the market report's record-level sections (recompetes, contacts).
 *
 * The market-size, agency and competitor sections are measured on the keyword's award text.
 * Recompetes and contacts used to be borrowed from a broader population (the keyword's whole
 * NAICS coverage set; the top agency's entire contact roster), so a "risk management framework"
 * report listed CAD warranty maintenance and generic Navy contracting staff. Those rows describe
 * a different market. Here a row only qualifies when its OWN text names the keyword:
 *   recompetes: the contract description contains a keyword phrase (query.ts descriptionTerms)
 *   contacts:   the person is a listed POC on SAM notices whose title/description contain one
 * An empty result is reported as empty, never back-filled from the broader population.
 */
import { createClient } from '@supabase/supabase-js';
import { marketKeywords } from '@/lib/market/keyword-coverage';
import { sanitizeDescriptionTerms } from '@/lib/recompete/query';
import { displayContactName } from '@/lib/gov-contacts/contact-quality';
import { classifyRole, roleCategoryLabel } from '@/lib/gov-contacts/contact-roster';
import { normalizeAgencyKey } from '@/lib/gov-contacts/agency-key';

/** Max curated phrases used as evidence (the literal keyword first, then term-of-art synonyms). */
const MAX_TERMS = 6;
/** Most recent matching notices scanned for POCs. */
const NOTICE_SCAN = 300;

/** The phrases a record must contain to count as evidence of this keyword market. */
export function keywordEvidenceTerms(keyword: string): string[] {
  const k = (keyword || '').trim();
  if (!k) return [];
  return sanitizeDescriptionTerms(marketKeywords(k)).slice(0, MAX_TERMS);
}

export interface KeywordContactPerson {
  name: string;
  role: string;
  email: string;
  office: string | null;
  /** Matching notices that list this person as a point of contact. */
  notices: number;
}

export interface KeywordContactsResult {
  people: KeywordContactPerson[];
  /** Distinct emailable people found on the matching notices (before the display cap). */
  total: number;
  /** Matching notices scanned (most recent first, capped at NOTICE_SCAN). */
  notices_scanned: number;
  terms: string[];
  degraded: boolean;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseLike = { from: (table: string) => any };

type NoticeRow = { solicitation_number: string | null; department: string | null; sub_tier: string | null; office: string | null };
type ContactRow = { contact_fullname: string | null; contact_title: string | null; contact_email: string | null; role_category: string | null; solicitation_number: string | null };

/** PostgREST `.or()` over title + description for each phrase. Terms must already be sanitized. */
export function noticeTextOrExpression(terms: string[]): string {
  return terms.flatMap((t) => [`title.ilike.%${t}%`, `description.ilike.%${t}%`]).join(',');
}

/**
 * Who to call for a keyword market: people listed as points of contact on SAM notices that
 * mention the keyword, ranked by how many of those notices list them. Honors agency + state.
 */
export async function keywordContacts(input: {
  terms: string[];
  agency?: string;
  state?: string;
  limit?: number;
}, deps: { db?: SupabaseLike } = {}): Promise<KeywordContactsResult> {
  const terms = sanitizeDescriptionTerms(input.terms);
  const limit = Math.min(Math.max(Number(input.limit) || 6, 1), 25);
  const empty = (degraded: boolean, scanned = 0): KeywordContactsResult => ({ people: [], total: 0, notices_scanned: scanned, terms, degraded });
  if (!terms.length) return empty(false);

  const db = deps.db ?? (createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!) as unknown as SupabaseLike);
  let q = db
    .from('sam_opportunities')
    .select('solicitation_number, department, sub_tier, office')
    .or(noticeTextOrExpression(terms))
    .not('solicitation_number', 'is', null)
    .neq('solicitation_number', '');
  const agencyKey = normalizeAgencyKey(input.agency || '').replace(/[,()%*_]/g, ' ').trim();
  if (agencyKey) q = q.or(`department.ilike.%${agencyKey}%,sub_tier.ilike.%${agencyKey}%`);
  const state = (input.state || '').trim().toUpperCase();
  if (/^[A-Z]{2}$/.test(state)) q = q.or(`pop_state.eq.${state},office_address->>state.eq.${state}`);
  const { data: notices, error } = await q.order('posted_date', { ascending: false }).limit(NOTICE_SCAN);
  if (error) {
    console.error('[keyword-evidence] notice read failed:', error.message);
    return empty(true);
  }
  const bySol = new Map<string, NoticeRow>();
  for (const n of (notices || []) as NoticeRow[]) if (n.solicitation_number) bySol.set(n.solicitation_number, n);
  if (!bySol.size) return empty(false, 0);

  const sols = [...bySol.keys()];
  const contacts: ContactRow[] = [];
  for (let i = 0; i < sols.length; i += 100) {
    const { data, error: cErr } = await db
      .from('federal_contacts')
      .select('contact_fullname, contact_title, contact_email, role_category, solicitation_number')
      .in('solicitation_number', sols.slice(i, i + 100))
      .like('contact_email', '%@%');
    if (cErr) {
      console.error('[keyword-evidence] contact read failed:', cErr.message);
      return empty(true, bySol.size);
    }
    contacts.push(...((data || []) as ContactRow[]));
  }

  const people = new Map<string, KeywordContactPerson & { sols: Set<string> }>();
  for (const c of contacts) {
    const email = (c.contact_email || '').trim();
    const name = displayContactName(c.contact_fullname) || '';
    if (!email || !name || !c.solicitation_number) continue;
    const key = email.toLowerCase();
    const notice = bySol.get(c.solicitation_number);
    const p = people.get(key) ?? {
      name,
      email,
      role: classifyRole(c.contact_title || '') || roleCategoryLabel(c.role_category) || '',
      office: notice?.sub_tier || notice?.office || notice?.department || null,
      notices: 0,
      sols: new Set<string>(),
    };
    p.sols.add(c.solicitation_number);
    p.notices = p.sols.size;
    people.set(key, p);
  }
  const ranked = [...people.values()]
    .sort((a, b) => b.notices - a.notices || a.name.localeCompare(b.name))
    .map(({ sols: _sols, ...p }) => p);
  return { people: ranked.slice(0, limit), total: ranked.length, notices_scanned: bySol.size, terms, degraded: false };
}
