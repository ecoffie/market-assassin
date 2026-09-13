/**
 * THE MINDY INSTITUTE — ingestion of canonical government research documents.
 *
 *   GOVERNMENT SOURCE -> INSTITUTE CORPUS -> STRATEGIC INTELLIGENCE -> product
 *
 * This layer owns EVIDENCE and nothing else. It decides what a document IS, who it
 * is ABOUT, and where it CAME FROM. It deliberately makes no interpretive claim —
 * deriving a pain point is a separate concern (src/lib/strategic-intel/derive.ts),
 * because a document is valuable Institute evidence even when it yields no
 * intelligence at all.
 *
 * ⚠️ WHY GAO RSS AND NOT GovInfo. The repo's GovInfo fetcher targets the GAOREPORTS
 * collection. Measured live 2026-09-13: that collection's newest document is
 * **2008-09-18** — an 18-year-old frozen archive that cannot produce a living
 * signal. The GAO RSS feed (already declared as `gao_reports` in
 * src/lib/briefings/web-intel/rss.ts but never wired to anything) carried reports
 * from **2026-09-10** the same day. Separately: the stored GOVINFO_API_KEY returns
 * API_KEY_INVALID — recorded, not fixed here.
 *
 * ⚠️ AGENCY IDENTITY GOES THROUGH resolveAgency() ONLY. We never reuse
 * `extractAgenciesFromTitle` from the GovInfo fetcher — its unanchored
 * `titleLower.includes(alias)` is the defect Potato 0 repaired ("ICE" matched inside
 * "Serv-ICE-s"; one report fanned out to four agencies). Here a document resolves to
 * AT MOST ONE canonical agency, or to none.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveAgency, type AgencyResolution } from '@/lib/strategic-intel/agency-resolver';

/** A government-authored document, normalized. Source-type agnostic on purpose. */
export interface InstituteDocument {
  sourceOrg: string;        // 'GAO'
  sourceType: string;       // 'gao_report'
  documentNumber: string;   // 'GAO-26-108092' — the body's own id; the idempotency key
  title: string;
  url: string;
  publicationDate: string | null;
  abstract: string | null;
  sourceWatermark?: string | null;
}

export interface IngestResult {
  documentNumber: string;
  instituteSourceId: string | null;
  inserted: boolean;                 // false = already in the corpus (idempotent)
  resolution: AgencyResolution;
  error?: string;
}

const GAO_RSS = 'https://www.gao.gov/rss/reports.xml';

function tag(xml: string, name: string): string | null {
  const cdata = xml.match(new RegExp(`<${name}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${name}>`, 'i'));
  if (cdata) return cdata[1].trim();
  const plain = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i'));
  return plain ? plain[1].trim() : null;
}

function decode(s: string): string {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/&#8217;/g, '’').replace(/&amp;/g, '&')
    .replace(/<[^>]+>/g, '').trim();
}

/** Pure parse — unit-testable without network. */
export function parseGaoRss(xml: string): InstituteDocument[] {
  const out: InstituteDocument[] = [];
  for (const block of xml.match(/<item>[\s\S]*?<\/item>/gi) ?? []) {
    const link = tag(block, 'link');
    const title = tag(block, 'title');
    if (!link || !title) continue;
    const slug = (link.split('/products/')[1] ?? '').trim().replace(/\/$/, '');
    if (!slug) continue;
    const pub = tag(block, 'pubDate');
    const parsed = pub ? new Date(pub) : null;
    const desc = tag(block, 'description');
    out.push({
      sourceOrg: 'GAO',
      sourceType: 'gao_report',
      documentNumber: slug.toUpperCase(),        // 'GAO-26-108092'
      title: decode(title),
      url: link,
      publicationDate: parsed && !Number.isNaN(parsed.getTime()) ? parsed.toISOString().slice(0, 10) : null,
      abstract: desc ? decode(desc).slice(0, 4000) : null,
    });
  }
  return out;
}

export async function fetchGaoReports(fetchImpl: typeof fetch = fetch): Promise<InstituteDocument[]> {
  const res = await fetchImpl(GAO_RSS, { headers: { 'User-Agent': 'Mindy-Institute (hello@getmindy.ai)' } });
  if (!res.ok) throw new Error(`GAO RSS ${res.status}`);
  return parseGaoRss(await res.text());
}

/**
 * Which agency does this document CONCERN?
 *
 * A GAO title reads "Subject: Finding"; the agency is usually named in the subject or
 * the opening line of the abstract ("a component within the Department of Homeland
 * Security"). We match a canonical agency NAME as a whole, word-bounded phrase.
 *
 * TWO REFUSALS, both deliberate:
 *   • zero names found   -> unresolved
 *   • two or more names  -> unresolved (ambiguous is NOT a coin flip, and it is
 *                          exactly how one report ended up under four agencies)
 */
export function resolveDocumentAgency(doc: InstituteDocument, canonicalNames: string[]): AgencyResolution {
  const haystack = `${doc.title}\n${doc.abstract ?? ''}`;
  const hits = new Set<string>();
  for (const name of canonicalNames) {
    const re = new RegExp(`(?:^|[^A-Za-z])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:[^A-Za-z]|$)`, 'i');
    if (re.test(haystack)) hits.add(name);
  }
  return resolveAgency({ agencyName: hits.size === 1 ? [...hits][0] : '' });
}

/**
 * Add one document to the Institute corpus. Idempotent on
 * (source_type, document_number) — re-ingesting cannot duplicate it.
 *
 * The record is kept REGARDLESS of whether any intelligence is later derived from it.
 */
export async function ingestInstituteDocument(
  db: SupabaseClient,
  doc: InstituteDocument,
  canonicalNames: string[],
): Promise<IngestResult> {
  const resolution = resolveDocumentAgency(doc, canonicalNames);

  const { data: existing } = await db
    .from('institute_sources')
    // unranged-ok: single row by the unique (source_type, document_number) key.
    .select('id')
    .eq('source_type', doc.sourceType).eq('document_number', doc.documentNumber).maybeSingle();

  if (existing?.id) {
    return { documentNumber: doc.documentNumber, instituteSourceId: existing.id as string, inserted: false, resolution };
  }

  const { data, error } = await db.from('institute_sources').insert({
    source_org: doc.sourceOrg,
    source_type: doc.sourceType,
    document_number: doc.documentNumber,
    title: doc.title,
    source_url: doc.url,
    publication_date: doc.publicationDate,
    canonical_agency: resolution.canonicalAgency,
    toptier_code: resolution.toptierCode,
    resolution_method: resolution.method,
    resolution_confidence: resolution.confidence,
    source_watermark: doc.sourceWatermark ?? doc.publicationDate,
    abstract: doc.abstract,
    raw: { title: doc.title, url: doc.url, publicationDate: doc.publicationDate },
  }).select('id').maybeSingle();

  if (error) {
    // A concurrent insert winning the unique key is not a failure — re-read.
    const { data: again } = await db.from('institute_sources')
      // unranged-ok: single row by unique key.
      .select('id').eq('source_type', doc.sourceType).eq('document_number', doc.documentNumber).maybeSingle();
    if (again?.id) return { documentNumber: doc.documentNumber, instituteSourceId: again.id as string, inserted: false, resolution };
    return { documentNumber: doc.documentNumber, instituteSourceId: null, inserted: false, resolution, error: error.message };
  }

  return { documentNumber: doc.documentNumber, instituteSourceId: (data?.id as string) ?? null, inserted: true, resolution };
}
