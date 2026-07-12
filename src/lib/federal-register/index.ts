/**
 * Federal Register client — the "demand before SAM" signal. A proposed or final
 * rule in a subject area often precedes agency solicitations by 6-18 months as the
 * agency staffs up to implement it. This turns a topic/agency query into a list of
 * recent regulatory items — a LEADING indicator SAM/USASpending cannot provide.
 *
 * API: https://www.federalregister.gov/api/v1/documents.json — free, NO key.
 * Honesty rule: Federal Register does NOT tag items to NAICS or a service
 * category. Any mapping from a rule to a NAICS/set-aside is inference, NOT data —
 * this client returns the raw items only; the tool never invents a NAICS mapping.
 *
 * Caching: 1h TTL (rules publish daily; within-day amendments are rare enough for a
 * spike). Backed by the shared `mcp_external_cache` table; degrades to no-cache on
 * any error. Rate-limited via the shared KV limiter (fails open).
 *
 * (PRD §5a — Federal Register net-new. The "demand before SAM" dataset is a
 * Phase-2 mirror candidate; this Phase-1 path is live-fetch + short TTL.)
 */
import { withCache } from '@/lib/mcp/external-cache';
import { checkRateLimit } from '@/lib/rate-limit';

const TTL_SECONDS = 60 * 60; // 1h
const API_BASE = 'https://www.federalregister.gov/api/v1/documents.json';

export type FederalRegisterDocType = 'RULE' | 'PROPOSED_RULE' | 'NOTICE';

/** Our enum → the Federal Register API's type strings. */
const DOC_TYPE_API: Record<FederalRegisterDocType, string> = {
  RULE: 'Rule',
  PROPOSED_RULE: 'Proposed Rule',
  NOTICE: 'Notice',
};

export interface FederalRegisterItem {
  title: string;
  document_type: string;
  publication_date: string | null;
  abstract: string | null;
  agencies: string[];
  cfr_parts: string[];
  docket_id: string | null;
  html_url: string | null;
  document_number: string | null;
}

export interface FederalRegisterQuery {
  /** Keyword / CFR topic, e.g. "cybersecurity". */
  query?: string;
  /** Agency slug or name, e.g. "defense" / "Department of Defense". */
  agency?: string;
  /** Filter to a document type. Omit for all. */
  document_type?: FederalRegisterDocType;
  /** Look-back window in days (default 90, capped at 365). */
  days_back?: number;
  /** Max items to return (default 15, capped at 50). */
  limit?: number;
}

interface FrApiItem {
  title?: string;
  type?: string;
  document_type?: string;
  publication_date?: string;
  abstract?: string;
  agencies?: Array<{ name?: string; raw_name?: string }>;
  cfr_parts?: string[];
  docket_id?: string | null;
  html_url?: string;
  document_number?: string;
}

interface FrApiResponse {
  results?: FrApiItem[];
  count?: number;
}

function dateDaysAgo(days: number): string {
  // Compute from a fixed reference passed in by the caller where possible; here we
  // derive from now. (The MCP tool passes a `today` param for deterministic tests.)
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/**
 * Fetch recent Federal Register documents for a query. Pure-ish: takes an optional
 * `today` ISO date so callers/tests can pin the look-back window deterministically.
 * Returns null on a hard upstream error (the tool maps that to degraded=true).
 */
export async function fetchRegulatoryDocuments(
  q: FederalRegisterQuery,
  opts: { today?: string } = {},
): Promise<{ items: FederalRegisterItem[]; total: number; fromCache: boolean } | null> {
  const daysBack = Math.min(Math.max(Math.floor(q.days_back ?? 90), 1), 365);
  const limit = Math.min(Math.max(Math.floor(q.limit ?? 15), 1), 50);

  const ref = opts.today ? new Date(opts.today) : new Date();
  const gteRef = new Date(ref);
  gteRef.setUTCDate(gteRef.getUTCDate() - daysBack);
  const gte = gteRef.toISOString().slice(0, 10);
  const lte = (opts.today ?? new Date().toISOString()).slice(0, 10);

  const params: Record<string, unknown> = {
    'per_page': limit,
    'order': 'newest',
    'conditions[publication_date][gte]': gte,
    'conditions[publication_date][lte]': lte,
  };
  if (q.query) params['conditions[term]'] = q.query;
  if (q.agency) params['conditions[agencies][]'] = q.agency;
  if (q.document_type) params['conditions[type][]'] = DOC_TYPE_API[q.document_type];

  const cacheKey = { ...params };

  try {
    const { value, fromCache } = await withCache<{ items: FederalRegisterItem[]; total: number } | null>(
      'fedreg:documents',
      cacheKey,
      TTL_SECONDS,
      async () => {
        await checkRateLimit('mcp:fedreg', 10, 1).catch(() => {});
        const url = new URL(API_BASE);
        for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
        const res = await fetch(url, {
          headers: { 'User-Agent': 'Mindy-MCP-GovConGiants (hello@govcongiants.com)', Accept: 'application/json' },
        });
        if (!res.ok) throw new Error(`Federal Register ${res.status}`);
        const j = (await res.json()) as FrApiResponse;
        const items: FederalRegisterItem[] = (j.results ?? []).map((r) => ({
          title: r.title ?? '(untitled)',
          document_type: r.document_type ?? r.type ?? 'Unknown',
          publication_date: r.publication_date ?? null,
          abstract: r.abstract ?? null,
          agencies: (r.agencies ?? []).map((a) => a.raw_name ?? a.name ?? 'Unknown').filter(Boolean),
          cfr_parts: Array.isArray(r.cfr_parts) ? r.cfr_parts : [],
          docket_id: r.docket_id ?? null,
          html_url: r.html_url ?? null,
          document_number: r.document_number ?? null,
        }));
        return { items, total: j.count ?? items.length };
      },
    );
    if (value === null) return null;
    return { items: value.items, total: value.total, fromCache };
  } catch (err) {
    console.error('[mcp:fedreg] fetch failed:', err);
    return null;
  }
}