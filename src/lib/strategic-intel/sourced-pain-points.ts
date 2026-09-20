/**
 * SHARED sourced-intelligence read path for customer surfaces.
 *
 * ONE reader for living GAO-derived pain points + distinguishable legacy fallback.
 * TMR / MCP / reports / map / company drawers MUST call this — never hand-roll a
 * GAO query or silently merge legacy JSON into an unsourced string list.
 *
 * Provenance contract (every living row):
 *   claim · GAO report · source URL · document number · published_at ·
 *   agency mapping · SOURCE_FACT | MINDY_INTERPRETATION
 *
 * Policy: living sourced FIRST, legacy JSON SECOND, never indistinguishable.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@supabase/supabase-js';
import agencyPainPointsJson from '@/data/agency-pain-points.json';
import { resolveAgency } from '@/lib/strategic-intel/agency-resolver';

export type ClaimProvenance =
  | 'SOURCE_FACT'           // GAO wording (title) cited with Institute evidence
  | 'MINDY_INTERPRETATION'  // derived/rewritten claim — not direct GAO wording
  | 'LEGACY_MANUAL';        // static JSON / unsourced historical corpus

export type ClaimSourceType = 'gao' | 'legacy_manual' | 'other';

export interface SourcedPainPoint {
  agency: string;
  pain_point: string;
  source_type: ClaimSourceType;
  source_url: string | null;
  document_number: string | null;
  published_at: string | null;
  institute_source_id: string | null;
  provenance: ClaimProvenance;
  /** Soft legacy tag like "(Source: GAO)" when present — never upgraded to SOURCE_FACT. */
  legacy_source_tag: string | null;
}

export interface AgencyIntelligenceBundle {
  agency: string;
  canonicalAgency: string | null;
  sourced: SourcedPainPoint[];
  legacy: SourcedPainPoint[];
  /** Sourced first, then legacy — never merged into one provenance class. */
  painPoints: SourcedPainPoint[];
  /** Legacy priorities only (no living priority pipeline yet). */
  priorities: SourcedPainPoint[];
  meta: {
    sourcedCount: number;
    legacyCount: number;
    legacyPriorityCount: number;
    provenanceAvailable: boolean;
  };
}

type StaticAgency = { painPoints?: string[]; priorities?: string[] };
const STATIC = agencyPainPointsJson as { agencies: Record<string, StaticAgency> };

function sb(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false } },
  );
}

/** Extract a GAO document number from claim text when present. */
export function extractDocumentNumber(text: string): string | null {
  const m = text.match(/\b(GAO-\d{2}-\d{5,6}|OIG-\d{2}-\d+)\b/i);
  return m ? m[1].toUpperCase() : null;
}

function legacyTag(text: string): string | null {
  const m = text.match(/\(\s*Source:\s*([^)]+)\)/i);
  return m ? m[1].trim() : null;
}

/**
 * Normalize an agency query to the canonical toptier name when possible.
 * Unresolved queries still search by the raw string (legacy JSON keys vary).
 */
export function resolveAgencyQuery(agencyQuery: string): { canonical: string | null; searchKeys: string[] } {
  const raw = agencyQuery.trim();
  if (!raw) return { canonical: null, searchKeys: [] };
  const r = resolveAgency({ agencyName: raw });
  const keys = new Set<string>([raw]);
  if (r.canonicalAgency) keys.add(r.canonicalAgency);
  // Also try common static-JSON key forms.
  for (const name of Object.keys(STATIC.agencies)) {
    if (name.toLowerCase() === raw.toLowerCase()) keys.add(name);
    if (r.canonicalAgency && name.toLowerCase() === r.canonicalAgency.toLowerCase()) keys.add(name);
  }
  return { canonical: r.canonicalAgency, searchKeys: [...keys] };
}

function fingerprintClaim(text: string): string {
  return text
    .toLowerCase()
    .replace(/\(\s*source:\s*[^)]+\)/gi, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .slice(0, 120);
}

/**
 * Drop a legacy claim when a sourced claim is obviously the same item
 * (shared GAO document number, or near-identical fingerprint).
 */
export function dedupeLegacyAgainstSourced(
  sourced: SourcedPainPoint[],
  legacy: SourcedPainPoint[],
): SourcedPainPoint[] {
  const sourcedDocs = new Set(
    sourced.map((s) => s.document_number).filter((d): d is string => !!d).map((d) => d.toUpperCase()),
  );
  const sourcedFp = new Set(sourced.map((s) => fingerprintClaim(s.pain_point)));
  return legacy.filter((l) => {
    const doc = l.document_number?.toUpperCase() ?? extractDocumentNumber(l.pain_point);
    if (doc && sourcedDocs.has(doc)) return false;
    if (sourcedFp.has(fingerprintClaim(l.pain_point))) return false;
    return true;
  });
}

interface DbPainRow {
  id: string;
  agency: string;
  pain_point: string;
  source: string | null;
  source_url: string | null;
  institute_source_ids: string[] | null;
  confidence: string | null;
  status: string | null;
}

interface InstituteRow {
  id: string;
  document_number: string;
  source_url: string;
  publication_date: string | null;
  title: string;
  canonical_agency: string | null;
}

/**
 * Load living sourced pain points for an agency from canonical tables.
 * Requires service-role (or RLS-open) access to institute_sources + agency_pain_points_db.
 */
export async function loadSourcedPainPointsForAgency(
  agencyQuery: string,
  opts: { client?: SupabaseClient; limit?: number } = {},
): Promise<SourcedPainPoint[]> {
  const client = opts.client ?? sb();
  const limit = opts.limit ?? 50;
  const { canonical, searchKeys } = resolveAgencyQuery(agencyQuery);
  if (searchKeys.length === 0) return [];

  // Prefer the canonical name for the living table (derive writes canonical names).
  const agencyKeys = canonical ? [canonical, ...searchKeys.filter((k) => k !== canonical)] : searchKeys;

  const { data: rows, error } = await client
    .from('agency_pain_points_db')
    .select('id,agency,pain_point,source,source_url,institute_source_ids,confidence,status')
    .in('agency', agencyKeys)
    .eq('source', 'gao')
    .limit(limit);
  if (error) throw new Error(`loadSourcedPainPointsForAgency: ${error.message}`);
  if (!rows?.length) return [];

  const sourceIds = [...new Set(
    (rows as DbPainRow[]).flatMap((r) => r.institute_source_ids ?? []).filter(Boolean),
  )];

  const byId = new Map<string, InstituteRow>();
  if (sourceIds.length > 0) {
    const { data: sources, error: sErr } = await client
      .from('institute_sources')
      .select('id,document_number,source_url,publication_date,title,canonical_agency')
      .in('id', sourceIds);
    if (sErr) throw new Error(`loadSourcedPainPointsForAgency institute: ${sErr.message}`);
    for (const s of (sources ?? []) as InstituteRow[]) byId.set(s.id, s);
  }

  const out: SourcedPainPoint[] = [];
  for (const row of rows as DbPainRow[]) {
    const sid = row.institute_source_ids?.[0] ?? null;
    const inst = sid ? byId.get(sid) : undefined;
    const docNum = inst?.document_number ?? extractDocumentNumber(row.pain_point);
    const url = row.source_url || inst?.source_url || null;

    // Living pipeline cites the GAO title as the claim → SOURCE_FACT.
    // Anything without an Institute id or URL is not promoted to SOURCE_FACT.
    const provenance: ClaimProvenance =
      sid && url ? 'SOURCE_FACT' : 'MINDY_INTERPRETATION';

    out.push({
      agency: row.agency,
      pain_point: row.pain_point,
      source_type: 'gao',
      source_url: url,
      document_number: docNum,
      published_at: inst?.publication_date ?? null,
      institute_source_id: sid,
      provenance,
      legacy_source_tag: null,
    });
  }
  return out;
}

/**
 * LEGACY_MANUAL dollar figures are curated prose, not sourced budget data.
 * Default customer responses omit the amounts until a living citation supports
 * them. Qualitative program names and opportunity framing stay.
 *
 * Round 3 watch (NAVSEA priorities): a skimmer reads "$2.3B Columbia-class" as
 * budget fact; the claim is provenance LEGACY_MANUAL with null source_url.
 */
const DOLLAR_AMOUNT_RE =
  /\$[\d,]+(?:\.\d+)?\s*(?:[BbMmKk](?:illion)?)?\b/g;
const INTRO_VERB_AMOUNT_RE =
  /\b(allocated|allocating|investing|budgeting|committing|funding|dedicating|planning)\s+\$[\d,]+(?:\.\d+)?\s*(?:[BbMmKk](?:illion)?)?\s*(?:for|to|in|through)?\s*/gi;

export function omitUnsourcedDollarAmounts(text: string): {
  text: string;
  omitted: string[];
} {
  const omitted: string[] = [];
  // Prefer verb+$amount+preposition as one unit so grammar stays readable.
  let out = text.replace(INTRO_VERB_AMOUNT_RE, (m) => {
    const amt = m.match(DOLLAR_AMOUNT_RE);
    if (amt) omitted.push(...amt.map((a) => a.trim()));
    return '';
  });
  out = out.replace(DOLLAR_AMOUNT_RE, (m) => {
    omitted.push(m.trim());
    return '';
  });
  if (omitted.length === 0) return { text, omitted: [] };

  out = out
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,.;:])/g, '$1')
    .replace(/^[,.\s]+/, '')
    .trim();
  if (out && /^[a-z]/.test(out)) {
    out = out.charAt(0).toUpperCase() + out.slice(1);
  }
  return { text: out || text, omitted };
}

/** Apply default-path dollar omission to a LEGACY_MANUAL claim. */
export function sanitizeLegacyClaimText(text: string): string {
  return omitUnsourcedDollarAmounts(text).text;
}

/** Legacy JSON claims — always LEGACY_MANUAL; never fabricate a source URL. */
export function loadLegacyPainPointsForAgency(agencyQuery: string, limit = 50): {
  painPoints: SourcedPainPoint[];
  priorities: SourcedPainPoint[];
} {
  const { searchKeys } = resolveAgencyQuery(agencyQuery);
  const painPoints: SourcedPainPoint[] = [];
  const priorities: SourcedPainPoint[] = [];

  for (const key of searchKeys) {
    const entry = STATIC.agencies[key]
      ?? Object.entries(STATIC.agencies).find(([n]) => n.toLowerCase() === key.toLowerCase())?.[1];
    if (!entry) continue;
    for (const pp of entry.painPoints ?? []) {
      const claim = sanitizeLegacyClaimText(pp);
      painPoints.push({
        agency: key,
        pain_point: claim,
        source_type: 'legacy_manual',
        source_url: null,
        document_number: extractDocumentNumber(claim),
        published_at: null,
        institute_source_id: null,
        provenance: 'LEGACY_MANUAL',
        legacy_source_tag: legacyTag(pp),
      });
    }
    for (const pr of entry.priorities ?? []) {
      const claim = sanitizeLegacyClaimText(pr);
      priorities.push({
        agency: key,
        pain_point: claim,
        source_type: 'legacy_manual',
        source_url: null,
        document_number: null,
        published_at: null,
        institute_source_id: null,
        provenance: 'LEGACY_MANUAL',
        legacy_source_tag: legacyTag(pr),
      });
    }
    break; // first matching static key wins
  }

  return {
    painPoints: painPoints.slice(0, limit),
    priorities: priorities.slice(0, limit),
  };
}

/**
 * THE shared customer read: sourced-first, legacy-fallback, distinguishable.
 */
export async function getAgencySourcedIntelligence(
  agencyQuery: string,
  opts: { client?: SupabaseClient; sourcedLimit?: number; legacyLimit?: number } = {},
): Promise<AgencyIntelligenceBundle> {
  const { canonical } = resolveAgencyQuery(agencyQuery);
  let sourced: SourcedPainPoint[] = [];
  try {
    sourced = await loadSourcedPainPointsForAgency(agencyQuery, {
      client: opts.client,
      limit: opts.sourcedLimit ?? 50,
    });
  } catch (err) {
    // Fail open to legacy rather than blanking the customer surface — but never
    // upgrade legacy to sourced.
    console.error('[sourced-pain-points] living read failed:', err);
  }

  const legacyBundle = loadLegacyPainPointsForAgency(agencyQuery, opts.legacyLimit ?? 50);
  const legacy = dedupeLegacyAgainstSourced(sourced, legacyBundle.painPoints);

  return {
    agency: agencyQuery,
    canonicalAgency: canonical,
    sourced,
    legacy,
    painPoints: [...sourced, ...legacy],
    priorities: legacyBundle.priorities,
    meta: {
      sourcedCount: sourced.length,
      legacyCount: legacy.length,
      legacyPriorityCount: legacyBundle.priorities.length,
      provenanceAvailable: sourced.length > 0,
    },
  };
}

/** Display helper: string list for surfaces that still need strings, with provenance suffix. */
export function formatPainPointForDisplay(p: SourcedPainPoint): string {
  if (p.provenance === 'SOURCE_FACT' && p.document_number && p.source_url) {
    // Claim already carries (Source: GAO-…) from derive; ensure provenance is visible.
    return p.pain_point.includes(p.document_number)
      ? p.pain_point
      : `${p.pain_point} (Source: ${p.document_number})`;
  }
  if (p.provenance === 'LEGACY_MANUAL') {
    // Defense in depth: never surface unsourced $ amounts even if a caller
    // bypassed loadLegacyPainPointsForAgency.
    const claim = sanitizeLegacyClaimText(p.pain_point);
    if (/\(legacy/i.test(claim) || /provenance unavailable/i.test(claim)) return claim;
    return `${claim} [LEGACY_MANUAL — provenance unavailable]`;
  }
  if (p.provenance === 'MINDY_INTERPRETATION') {
    return `${p.pain_point} [MINDY_INTERPRETATION]`;
  }
  return p.pain_point;
}

/** Structured citation block for MCP / API consumers. */
export function toCitation(p: SourcedPainPoint): {
  claim: string;
  provenance: ClaimProvenance;
  source_type: ClaimSourceType;
  source_url: string | null;
  document_number: string | null;
  published_at: string | null;
  institute_source_id: string | null;
  agency: string;
} {
  const claim =
    p.provenance === 'LEGACY_MANUAL' ? sanitizeLegacyClaimText(p.pain_point) : p.pain_point;
  return {
    claim,
    provenance: p.provenance,
    source_type: p.source_type,
    source_url: p.source_url,
    document_number: p.document_number,
    published_at: p.published_at,
    institute_source_id: p.institute_source_id,
    agency: p.agency,
  };
}
