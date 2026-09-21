/**
 * TIER 2 — requirement-batched multi-pass section drafting.
 *
 * DEFERRED build (Eric, Jun 26 — start after demo day). Tier 1 scales a section's
 * length to its mapped-requirement count but is still ONE LLM call (~5K words max).
 * For true multi-volume length, Tier 2 batches a section's requirements into small
 * groups, drafts EACH group in parallel as a self-contained subsection (via the
 * generateV2Draft `subsection` path), then assembles them into a long volume. A
 * 147-requirement Technical section → ~25 subsections → 50–100+ pages.
 *
 * GATED OFF by default: callers only use this when PROPOSAL_MULTIPASS=1, so merging
 * this PR changes nothing in production until it's deliberately enabled + tested.
 *
 * Known follow-ups for when we turn it on:
 *  - Context reuse: each subsection re-runs buildV2Prompt (re-loads vault + RAG).
 *    Refactor buildV2Prompt into loadDraftContext() + assembleV2Prompt(ctx) so the
 *    context loads ONCE per section. (Parallel today, so wall-clock is fine; this
 *    is a cost/efficiency optimization.)
 *  - Optional: a final short "section introduction" pass + a generated TOC.
 *  - Cost guardrails: respect the per-user LLM budget (usage-cost.ts) — a 25-call
 *    section is materially more expensive than single-pass.
 */
import { generateV2Draft, sectionAlignedReqs } from './v2';
import type { SectionType, DraftResult } from './types';
import type { ComplianceReq } from './section-alignment';
import type { NoticePocSet } from './notice-poc';

export const MULTIPASS_ENABLED = process.env.PROPOSAL_MULTIPASS === '1';
const THRESHOLD = Number(process.env.PROPOSAL_MULTIPASS_THRESHOLD) || 12;
const BATCH_SIZE = Number(process.env.PROPOSAL_MULTIPASS_BATCH) || 6;
const CONCURRENCY = Number(process.env.PROPOSAL_MULTIPASS_CONCURRENCY) || 4;

/** Run an async fn over items with bounded concurrency, preserving order. */
async function mapPool<T, R>(items: T[], concurrency: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      out[i] = await fn(items[i], i);
    }
  }));
  return out;
}

export interface MultiPassOpts {
  email: string;
  sectionType: SectionType;
  sourceText: string;
  fileName?: string;
  rfpAgency?: string | null;
  lensSeed?: number;
  noticePoc?: NoticePocSet | null;
  requirements?: ComplianceReq[];
}

/**
 * Draft a section as a multi-pass volume when it owns many requirements; otherwise
 * fall straight through to the single-pass (Tier 1) draft. Always returns a normal
 * DraftResult so callers don't branch.
 */
export async function generateMultiPassSection(opts: MultiPassOpts): Promise<DraftResult> {
  const mine = sectionAlignedReqs(opts.requirements, opts.sectionType);

  // Light sections (or no matrix) stay single-pass — multi-pass only earns its
  // cost when there are enough requirements to fill multiple subsections.
  if (mine.length <= THRESHOLD) {
    return generateV2Draft(opts);
  }

  // Batch requirements into small groups; each becomes one self-contained subsection.
  const batches: ComplianceReq[][] = [];
  for (let i = 0; i < mine.length; i += BATCH_SIZE) batches.push(mine.slice(i, i + BATCH_SIZE));

  const results = await mapPool(batches, CONCURRENCY, (reqs, i) =>
    generateV2Draft({
      ...opts,
      subsection: { index: i + 1, total: batches.length, reqs },
    }).catch((err) => {
      console.warn(`[multi-pass] subsection ${i + 1}/${batches.length} failed:`, err instanceof Error ? err.message : err);
      return null;
    })
  );

  const ok = results.filter((r): r is DraftResult => !!r && !!r.draft);
  // Total failure → fall back to a single-pass draft so the user still gets something.
  if (ok.length === 0) return generateV2Draft(opts);

  const label = ok[0].label;
  const body = ok.map((r) => r.draft.trim()).join('\n\n');
  const draft = `# ${label}\n\n${body}`;
  const wordCount = draft.split(/\s+/).filter(Boolean).length;
  const factGuardFlags = ok.reduce((s, r) => s + (r.meta.factGuardFlags || 0), 0);

  return {
    section: opts.sectionType,
    label,
    draft,
    wordCount,
    targetWords: ok.reduce((s, r) => s + r.targetWords, 0),
    meta: {
      ...ok[0].meta,
      pipeline: 'v2',
      model: `${ok[0].meta.model} ×${ok.length} (multi-pass)`,
      factGuardFlags,
    },
  };
}
