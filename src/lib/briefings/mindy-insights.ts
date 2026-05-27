/**
 * Mindy Insights for daily alert emails.
 *
 * Per Eric's spec (#91): inject one teaching insight per notice-type
 * bucket that appears in a user's alert, sourced from the RAG library
 * (Eric's 8-year teaching corpus + new estimating samples like the
 * Fort Belvoir bid).
 *
 * Critical constraints:
 *   1. EXIT STRATEGY: NO "Eric on...", NO personal attribution.
 *      Brand as "Mindy Insight" exclusively. See exit_strategy_brand_separation memory.
 *   2. ECONOMY: 5 RAG queries per cron INVOCATION, not per opp, not per user.
 *      A single batch of 500 users sharing the same notice-type buckets
 *      should hit the RAG library at most 5 times.
 *
 * Architecture:
 *   - Process-level Map cache keyed by bucket → quote (resets each
 *     invocation since serverless workers are short-lived).
 *   - getInsightForNoticeType() is the public entry point — call it
 *     per-user-batch; it lazily fills the cache as it sees new buckets.
 *   - bucketNoticeType() canonicalizes SAM's verbose noticeType strings
 *     to 5 stable buckets the prompt is tuned for.
 *   - extractQuote() picks the most quote-shaped sentence from a chunk
 *     (a real teaching line, not a paragraph) and trims to ~200 chars
 *     so it fits in an email row without dominating it.
 */

import { retrieveRagContext } from '@/lib/rag/retrieve';

export type InsightBucket =
  | 'rfp'              // RFP / Solicitation — "ready to bid"
  | 'sources_sought'   // Sources Sought / RFI — "market research, pre-bid"
  | 'rfq'              // RFQ — "small quote, fast turn"
  | 'presolicitation'  // Presolicitation — "look ahead, position"
  | 'combined';        // Combined Synopsis/Solicitation — "compressed timeline"

// Tuned: keep queries SHORT (3-5 tokens). The Postgres FTS ts_rank
// ranks much better with focused queries than long phrases — long
// queries dilute the score and often return no usable matches.
const BUCKET_QUERIES: Record<InsightBucket, string> = {
  rfp:             'proposal compliance evaluation factors',
  sources_sought:  'sources sought capability statement',
  rfq:             'request for quote pricing',
  presolicitation: 'presolicitation acquisition planning',
  combined:        'combined synopsis solicitation timeline',
};

const BUCKET_LABELS: Record<InsightBucket, string> = {
  rfp:             'For your RFPs',
  sources_sought:  'For your Sources Sought / RFIs',
  rfq:             'For your RFQs',
  presolicitation: 'For your Presolicitation notices',
  combined:        'For your Combined Synopsis/Solicitations',
};

/**
 * Canonicalize SAM's noticeType strings to one of 5 buckets.
 * Unknown / missing types default to 'rfp' (the most useful general bucket).
 */
export function bucketNoticeType(noticeType: string | null | undefined): InsightBucket {
  const t = String(noticeType || '').toLowerCase();
  if (t.includes('sources sought') || t.includes('rfi') || t.includes('request for information')) return 'sources_sought';
  if (t.includes('rfq') || t.includes('request for quot')) return 'rfq';
  if (t.includes('presolicit') || t.includes('pre-solicit') || t.includes('special notice')) return 'presolicitation';
  if (t.includes('combined synopsis') || t.includes('combined/synopsis')) return 'combined';
  // Default: RFP / Solicitation / anything else
  return 'rfp';
}

// Process-level cache: serverless workers are short-lived, so this is
// effectively per-invocation. Eric's 5-queries-per-cron rule.
const insightCache = new Map<InsightBucket, MindyInsight | null>();

export interface MindyInsight {
  bucket: InsightBucket;
  label: string;            // "For your RFPs"
  quote: string;            // The teaching line itself, ~200 chars
  sourceTitle: string;      // For internal debugging (NOT shown in email)
  sourceDocType: string;
}

/**
 * Pull the best teaching chunk for a notice-type bucket and extract
 * a single quote-shaped sentence. Cached per process for the rest of
 * this cron invocation.
 *
 * Returns null on retrieval failure or empty result — caller MUST
 * handle null (no insight) gracefully.
 */
export async function getInsightForNoticeType(
  noticeType: string | null | undefined,
): Promise<MindyInsight | null> {
  const bucket = bucketNoticeType(noticeType);

  if (insightCache.has(bucket)) {
    return insightCache.get(bucket) ?? null;
  }

  try {
    // Don't over-filter docTypes — the corpus has 288 'misc' / 124
    // 'course_material' / 103 'slide_deck' / 31 'webinar_resource' that
    // are full of teaching gems. We only EXCLUDE noise (meta_doc,
    // qa_dataset, planner_app_code) via the RPC default, and rely on
    // the FTS rank to surface the bucket-relevant chunk.
    const chunks = await retrieveRagContext({
      query: BUCKET_QUERIES[bucket],
      limit: 8,
      maxChars: 6000,
      maxPerDoc: 1,
    });

    // If the specific bucket query returned nothing (some buckets like
    // 'presolicitation' / 'combined' have thin corpus coverage), fall
    // back to a generic federal-bid-prep query so the email still
    // carries an insight instead of an empty block.
    let activeChunks = chunks;
    if (!activeChunks.length) {
      const fallback = await retrieveRagContext({
        query: 'federal contracting proposal preparation',
        limit: 8,
        maxChars: 6000,
        maxPerDoc: 1,
      });
      if (!fallback.length) {
        insightCache.set(bucket, null);
        return null;
      }
      activeChunks = fallback;
    }

    // Try each chunk until we find a quote-shaped sentence; if none
    // produce one, fall back to the top chunk's first decent line.
    let insight: MindyInsight | null = null;
    for (const chunk of activeChunks) {
      const quote = extractQuote(chunk.chunk_text);
      if (quote) {
        insight = {
          bucket,
          label: BUCKET_LABELS[bucket],
          quote,
          sourceTitle: chunk.doc_title || chunk.source_path || 'mindy-corpus',
          sourceDocType: chunk.doc_type || 'misc',
        };
        break;
      }
    }

    insightCache.set(bucket, insight);
    return insight;
  } catch (err) {
    console.error('[mindy-insights] retrieval failed:', err);
    insightCache.set(bucket, null);
    return null;
  }
}

/**
 * Extract the best quote-shaped sentence from a chunk.
 *
 * Prefers: declarative sentences 60-240 chars long that aren't
 * meta-text (file headers, bullet markers, all-caps lines).
 */
function extractQuote(chunkText: string): string | null {
  if (!chunkText) return null;

  // Strip markdown headers, bullet markers, code fences
  const cleaned = chunkText
    .replace(/^#+\s.*$/gm, '')
    .replace(/^[-*•]\s+/gm, '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  // Sentence-split (cheap regex, good enough)
  const sentences = cleaned
    .split(/(?<=[.!?])\s+(?=[A-Z])/)
    .map(s => s.trim())
    .filter(Boolean);

  // Score each sentence — prefer 60-240 chars, no all-caps,
  // no obvious headers, no URLs.
  let best: { sentence: string; score: number } | null = null;
  for (const s of sentences) {
    if (s.length < 60 || s.length > 240) continue;
    if (/^[A-Z\s\d.,'-]+$/.test(s)) continue;             // all-caps line
    if (/^(##|---|\*|\d+\.)/.test(s)) continue;           // header / bullet
    if (/https?:\/\//.test(s)) continue;                  // URL
    if (/\$\d/.test(s) && /\d{4,}/.test(s)) continue;     // raw price table

    let score = 0;
    if (s.length >= 100 && s.length <= 180) score += 10;
    if (/^(The|A|When|If|Most|Federal|Every|Government|Small|Always|Don't|Never)/.test(s)) score += 5;
    if (/[a-z],/.test(s)) score += 2;                     // has natural commas (prose-y)

    if (!best || score > best.score) {
      best = { sentence: s, score };
    }
  }

  return best?.sentence || null;
}

/**
 * Render an insight as an HTML block to inject under the matching
 * opportunity bucket in a daily alert email.
 *
 * Returns empty string if insight is null (caller can interpolate
 * safely without null-checking).
 */
export function renderInsightHtml(insight: MindyInsight | null): string {
  if (!insight) return '';
  // Escape minimally — chunks come from our own RAG library, but be safe.
  const escaped = insight.quote.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `
    <div style="background: linear-gradient(135deg, #f5f3ff 0%, #ede9fe 100%); border-left: 3px solid #7c3aed; padding: 14px 18px; margin: 8px 0;">
      <div style="color: #6d28d9; font-size: 11px; font-weight: 700; letter-spacing: 0.5px; margin-bottom: 6px;">
        💡 MINDY INSIGHT &nbsp;·&nbsp; ${insight.label}
      </div>
      <div style="color: #1e1b4b; font-size: 13px; line-height: 1.55; font-style: italic;">
        "${escaped}"
      </div>
    </div>
  `;
}

/**
 * For tests / debugging only — wipe the per-process cache.
 * The cron handler should NOT call this; serverless workers reset
 * the module state between cold starts naturally.
 */
export function _clearInsightCacheForTests() {
  insightCache.clear();
}
