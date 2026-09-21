import type { CtaTagResult } from '@/lib/cta/definitions';
import { CTA_BY_ID, filterTagsForDisplay, tagOpportunityForCta } from '@/lib/cta/definitions';

export interface OpportunityCtaTagPayload {
  ctaId: string;
  name: string;
  shortName: string;
  confidence: CtaTagResult['confidence'];
  matchSource: CtaTagResult['match_source'];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseClient = any;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Resolve notice_ids that match any selected CTA (DB tags). */
export async function getNoticeIdsForCtaFilter(
  supabase: SupabaseClient,
  ctaIds: string[],
): Promise<{ noticeIds: string[] | null; error?: string }> {
  if (!ctaIds.length) return { noticeIds: null };

  // Only high/medium tags drive the filter. 'low' = a broad-NAICS-only match with
  // no keyword corroboration (e.g. a rifle under "Advanced Materials" via the 332
  // anchor) — kept in the table for transparency but never surfaced as a CTA match.
  const { data, error } = await supabase
    .from('opportunity_cta_tags')
    .select('notice_id')
    .in('cta_id', ctaIds)
    .in('confidence', ['high', 'medium']);

  if (error) {
    if (String(error.message || '').includes('does not exist')) {
      return { noticeIds: null, error: 'cta_tables_missing' };
    }
    return { noticeIds: [], error: error.message };
  }

  const noticeIds = [
    ...new Set(
      (data || []).map((r: { notice_id: string }) => r.notice_id).filter(Boolean),
    ),
  ] as string[];
  return { noticeIds };
}

export async function loadCtaTagsForNotices(
  supabase: SupabaseClient,
  noticeIds: string[],
): Promise<Map<string, OpportunityCtaTagPayload[]>> {
  const map = new Map<string, OpportunityCtaTagPayload[]>();
  if (!noticeIds.length) return map;

  type TagRow = {
    notice_id: string;
    cta_id: string;
    confidence: string;
    match_source: string;
  };

  const rows: TagRow[] = [];
  for (const batch of chunk(noticeIds, 400)) {
    const { data, error } = await supabase
      .from('opportunity_cta_tags')
      .select('notice_id, cta_id, confidence, match_source')
      .in('notice_id', batch);
    if (error) break;
    if (data) rows.push(...data);
  }

  for (const row of rows) {
    const def = CTA_BY_ID.get(row.cta_id);
    const payload: OpportunityCtaTagPayload = {
      ctaId: row.cta_id,
      name: def?.name || row.cta_id,
      shortName: def?.short_name || row.cta_id,
      confidence: row.confidence as CtaTagResult['confidence'],
      matchSource: row.match_source as CtaTagResult['match_source'],
    };
    const list = map.get(row.notice_id) || [];
    list.push(payload);
    map.set(row.notice_id, list);
  }

  return map;
}

export function tagOpportunityInMemory(opp: {
  notice_id: string;
  naics_code?: string | null;
  naics_codes?: string[] | null;
  title?: string | null;
  description?: string | null;
}): OpportunityCtaTagPayload[] {
  const tags = filterTagsForDisplay(tagOpportunityForCta(opp));
  return tags.map((t) => {
    const def = CTA_BY_ID.get(t.cta_id);
    return {
      ctaId: t.cta_id,
      name: def?.name || t.cta_id,
      shortName: def?.short_name || t.cta_id,
      confidence: t.confidence,
      matchSource: t.match_source,
    };
  });
}

export function opportunityMatchesCtaFilter(
  tags: OpportunityCtaTagPayload[],
  selectedCtaIds: string[],
): boolean {
  if (!selectedCtaIds.length) return true;
  return tags.some((t) => selectedCtaIds.includes(t.ctaId));
}
