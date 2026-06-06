/**
 * /api/app/knowledge-base
 *
 * Search/browse Mindy's source-document corpus (mindy_rag_documents) — the
 * "Knowledge Base" page (PRD-knowledge-base-repository). This is the browsable
 * home for the documents Mindy Chat cites, so "show me the source" lands on a
 * real, searchable page instead of getting lost.
 *
 * GET ?q=&docType=&limit=&offset=  → list (title, type, summary, NAICS).
 * Full text comes from /api/app/rag-doc?id=<id>.
 *
 * Guardrails:
 *  - has_pii rows are NEVER returned.
 *  - INTERNAL doc_types (code, meta, raw Q&A) are excluded — only user-useful
 *    reference material (proposals, templates, training, podcasts) surfaces.
 *  - Exit-strategy brand rule: we do NOT expose usage_rights / owner identity
 *    ("eric_owned"); the corpus is presented as "GovCon Giants curriculum".
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireMIAuthSession } from '@/lib/two-factor-session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Doc types that are NOT user-facing reference material.
const EXCLUDED_TYPES = ['planner_app_code', 'meta_doc', 'qa_dataset'];

// Friendly labels for the UI filter pills.
export const DOC_TYPE_LABELS: Record<string, string> = {
  proposal_template: 'Proposal Templates',
  technical_volume: 'Technical Volumes',
  pricing_volume: 'Pricing Volumes',
  past_performance: 'Past Performance',
  cap_statement: 'Capability Statements',
  sources_sought_loi: 'Sources Sought / LOI',
  course_material: 'Training',
  slide_deck: 'Slide Decks',
  webinar_resource: 'Webinars',
  estimating_example: 'Estimating',
  podcast_interview: 'Podcast Insights',
  misc: 'Reference',
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _sb: any = null;
function sb() {
  if (!_sb) _sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  return _sb;
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const email = url.searchParams.get('email');
  const auth = requireMIAuthSession(request, email);
  if (!auth.ok) return auth.response;

  const q = (url.searchParams.get('q') || '').trim();
  const docType = (url.searchParams.get('docType') || '').trim();
  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '30', 10) || 30, 1), 60);
  const offset = Math.max(parseInt(url.searchParams.get('offset') || '0', 10) || 0, 0);

  let query = sb()
    .from('mindy_rag_documents')
    .select('id, title, doc_type, one_line_summary, related_naics, word_count, page_count', { count: 'exact' })
    .eq('has_pii', false)
    .not('doc_type', 'in', `(${EXCLUDED_TYPES.join(',')})`)
    .in('ingestion_status', ['extracted', 'completed', 'embedded']);

  if (docType && !EXCLUDED_TYPES.includes(docType)) {
    query = query.eq('doc_type', docType);
  }
  if (q) {
    // Search title + summary + tags. (full_text search is heavier — start here.)
    query = query.or(`title.ilike.%${q}%,one_line_summary.ilike.%${q}%`);
  }

  query = query.order('word_count', { ascending: false }).range(offset, offset + limit - 1);

  const { data, error, count } = await query;
  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  // doc_type facet counts (for the filter pills) — one cheap grouped pass.
  const { data: facetRows } = await sb()
    .from('mindy_rag_documents')
    .select('doc_type')
    .eq('has_pii', false)
    .not('doc_type', 'in', `(${EXCLUDED_TYPES.join(',')})`)
    .in('ingestion_status', ['extracted', 'completed', 'embedded']);
  const facets: Record<string, number> = {};
  for (const r of (facetRows || []) as { doc_type: string }[]) {
    facets[r.doc_type] = (facets[r.doc_type] || 0) + 1;
  }

  return NextResponse.json({
    success: true,
    total: count || 0,
    docs: (data || []).map((d: any) => ({
      id: d.id,
      title: d.title || 'Untitled',
      docType: d.doc_type,
      docTypeLabel: DOC_TYPE_LABELS[d.doc_type as string] || (d.doc_type as string),
      summary: d.one_line_summary || '',
      naics: d.related_naics || null,
      words: d.word_count || 0,
      pages: d.page_count || null,
    })),
    facets: Object.entries(facets)
      .map(([t, n]) => ({ docType: t, label: DOC_TYPE_LABELS[t] || t, count: n }))
      .sort((a, b) => b.count - a.count),
  });
}
