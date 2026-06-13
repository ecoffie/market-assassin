import {
  CTA_DEFINITIONS,
  type CtaDefinition,
  type CtaTagResult,
  tagOpportunityForCta,
  type SamOpportunityForCta,
} from '@/lib/cta/definitions';

export type { CtaDefinition, CtaTagResult, SamOpportunityForCta };

export interface CtaTagRow {
  notice_id: string;
  cta_id: string;
  confidence: string;
  match_source: string;
  tagged_at: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseClient = any;

export function buildCtaTagRows(
  opp: SamOpportunityForCta,
  taggedAt = new Date().toISOString(),
  definitions: CtaDefinition[] = CTA_DEFINITIONS,
): CtaTagRow[] {
  return tagOpportunityForCta(opp, definitions).map((tag) => ({
    notice_id: opp.notice_id,
    cta_id: tag.cta_id,
    confidence: tag.confidence,
    match_source: tag.match_source,
    tagged_at: taggedAt,
  }));
}

export async function upsertCtaTagsForOpportunity(
  supabase: SupabaseClient,
  opp: SamOpportunityForCta,
): Promise<{ inserted: number }> {
  const taggedAt = new Date().toISOString();
  const rows = buildCtaTagRows(opp, taggedAt);
  const noticeId = opp.notice_id;

  // Dedupe within batch (defensive) and upsert so concurrent cron workers
  // don't collide on opportunity_cta_tags_pkey.
  const deduped = [...new Map(rows.map((r) => [`${r.notice_id}:${r.cta_id}`, r])).values()];

  await supabase.from('opportunity_cta_tags').delete().eq('notice_id', noticeId);

  if (deduped.length > 0) {
    const { error } = await supabase
      .from('opportunity_cta_tags')
      .upsert(deduped, { onConflict: 'notice_id,cta_id' });
    if (error) throw new Error(error.message);
  }

  await supabase
    .from('sam_opportunities')
    .update({ cta_tagged_at: taggedAt })
    .eq('notice_id', noticeId);

  return { inserted: deduped.length };
}

export async function tagCtaBatch(
  supabase: SupabaseClient,
  options: { limit?: number; activeOnly?: boolean } = {},
): Promise<{
  processed: number;
  tagsWritten: number;
  remaining: number | null;
}> {
  const limit = Math.min(options.limit ?? 500, 2000);
  const activeOnly = options.activeOnly !== false;

  let query = supabase
    .from('sam_opportunities')
    .select('notice_id, naics_code, naics_codes, title, description')
    .is('cta_tagged_at', null)
    .order('id', { ascending: true })
    .limit(limit);

  if (activeOnly) query = query.eq('active', true);

  const { data: rows, error } = await query;
  if (error) throw new Error(error.message);

  let tagsWritten = 0;
  for (const row of rows || []) {
    const result = await upsertCtaTagsForOpportunity(supabase, row as SamOpportunityForCta);
    tagsWritten += result.inserted;
  }

  let remainingQuery = supabase
    .from('sam_opportunities')
    .select('*', { count: 'exact', head: true })
    .is('cta_tagged_at', null);
  if (activeOnly) remainingQuery = remainingQuery.eq('active', true);
  const { count: remaining } = await remainingQuery;

  return {
    processed: (rows || []).length,
    tagsWritten,
    remaining: remaining ?? null,
  };
}
