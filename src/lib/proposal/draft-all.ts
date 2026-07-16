/**
 * Two-pass "Draft Entire Proposal" generator — Content Reaper pattern #2.
 *
 * STEP 1: One cheap AI call returns an outline JSON with all sections
 *         the user wants drafted. Outline includes per-section "spin"
 *         (lens hint, key emphasis points).
 *
 * STEP 2: Parallel-render each section via the existing generateV2Draft
 *         pipeline, batched 3 at a time so we don't blow rate limits.
 *
 * Why two passes:
 *   - One mega-call writing all 5 sections at once tends to homogenize
 *     them ("the same draft 5 times with different headings").
 *   - Five independent calls without an outline produces sections that
 *     don't speak to each other.
 *   - Outline-first ensures each section has a distinct angle AND
 *     references the same RFP context.
 *
 * Same pattern Content Reaper uses to generate 30 distinct LinkedIn
 * posts (STEP 1 outline → STEP 2 parallel write, content-generator/
 * generate/route.ts:325-607).
 */

import { generateV2Draft } from './v2';
import { generateMultiPassSection, MULTIPASS_ENABLED } from './multi-pass';
import type { NoticePocSet } from './notice-poc';
import type { ComplianceReq } from './section-alignment';
import { getSectionMeta } from './sections';
import { safeParseJSON } from '@/lib/utils/safe-parse-json';
import { callLLM } from '@/lib/llm/call-llm';
import { isCapStatementSection, type SectionType, type DraftResult } from './types';

const MAX_INPUT_CHARS = 40000;
const PARALLEL_BATCH_SIZE = 3;

export interface DraftAllOpts {
  email: string;
  sourceText: string;
  fileName?: string;
  rfpAgency?: string | null;
  /** Which sections to draft. Defaults to all 5 RFP sections. */
  sectionTypes?: SectionType[];
  /** Government POC from the SAM notice (raw_data.pointOfContact). */
  noticePoc?: NoticePocSet | null;
  /** Compliance matrix — each section is told which requirements it must cover. */
  requirements?: ComplianceReq[];
}

export interface DraftAllResult {
  sections: DraftResult[];
  outline: SectionOutline[];
  totalProcessingMs: number;
  errors: Array<{ sectionType: SectionType; error: string }>;
}

interface SectionOutline {
  sectionType: SectionType;
  emphasis: string;       // 1-line creative direction for this section
  keyAngles: string[];    // 2-3 bullet points the section should hit
}

const DEFAULT_RFP_SECTIONS: SectionType[] = [
  'exec_summary',
  'technical',
  'management',
  'past_performance',
  'pricing',
];

const DEFAULT_CAP_STMT_SECTIONS: SectionType[] = [
  'company_overview',
  'cap_past_performance',
  'capabilities',
  'differentiators',
  'poc',
];

/**
 * STEP 1: Outline. One AI call returns per-section emphasis + key angles.
 * Cheap, structured, sets up STEP 2 for distinct outputs.
 */
async function generateOutline(
  sourceText: string,
  sectionTypes: SectionType[],
): Promise<SectionOutline[]> {
  const emptyOutlines = () => sectionTypes.map(s => ({ sectionType: s, emphasis: '', keyAngles: [] }));

  const inputText = sourceText.slice(0, MAX_INPUT_CHARS);
  const sectionsRequested = sectionTypes
    .map(s => `- ${s}: ${getSectionMeta(s).label}`)
    .join('\n');

  const systemPrompt = `You are a senior federal capture strategist outlining a multi-section proposal response. Your job is NOT to write the sections — just outline the strategic emphasis for each section so the actual drafting (which happens in a separate pass) produces distinct, complementary output.

Output rules:
- Respond with a JSON object ONLY, no commentary.
- Shape: { "outlines": [{ "sectionType": "...", "emphasis": "1-line direction", "keyAngles": ["...", "...", "..."] }, ...] }
- emphasis: ≤25 words. The creative direction for THIS section (e.g. "Lead with the agency's mission language, then frame our team as the means to that mission").
- keyAngles: 2-3 short bullets the section MUST hit. Specific to THIS RFP's content, not generic.
- Each section's emphasis + angles should be DISTINCT — Past Performance ≠ Management Plan ≠ Executive Summary.
- Reference real facts from the RFP source text (agency name, scope keywords, evaluation factors).`;

  const userPrompt = `Outline the strategic emphasis for each of these proposal sections:

${sectionsRequested}

RFP source text:
${inputText}

JSON only.`;

  try {
    // Provider-agnostic outline call. The 'drafting' chain (Claude → Groq 70B →
    // OpenAI → Grok) means the outline still comes back even when Groq's daily
    // quota is exhausted — the old raw-Groq fetch + 70B→8B fallback both died
    // together in that case. callLLM records the token cost itself when `tool`
    // is set, so the manual recordLlmUsage is no longer needed. On total failure
    // callLLM throws → the catch returns empty outlines (unchanged behavior).
    const { text } = await callLLM({
      system: systemPrompt,
      user: userPrompt,
      json: true,
      temperature: 0.5,
      maxTokens: 1500,
      job: 'drafting',
      tool: 'proposal_draft',
      userEmail: null,
    });
    const parsed = safeParseJSON<{ outlines?: SectionOutline[] }>(text || '', {
      fallback: { outlines: [] },
      source: 'proposal.draftAll.outline',
    });
    const outlines = parsed.outlines || [];

    // Ensure every requested section has an outline (fill blanks with empty)
    return sectionTypes.map(s => {
      const found = outlines.find(o => o.sectionType === s);
      return found || { sectionType: s, emphasis: '', keyAngles: [] };
    });
  } catch (err) {
    console.error('[proposal/draft-all] outline failed:', err);
    return emptyOutlines();
  }
}

/**
 * STEP 2: Parallel-render each section. Uses existing generateV2Draft
 * for each — same vault + RAG + lens + humanization pipeline. We
 * inject the outline's emphasis + keyAngles as additional guidance
 * for that section's render.
 *
 * Batched to PARALLEL_BATCH_SIZE concurrent calls (default 3) to
 * stay polite to the Groq rate limit.
 */
async function renderSectionsInBatches(
  opts: DraftAllOpts,
  outlines: SectionOutline[],
): Promise<{ sections: DraftResult[]; errors: Array<{ sectionType: SectionType; error: string }> }> {
  const sections: DraftResult[] = [];
  const errors: Array<{ sectionType: SectionType; error: string }> = [];

  for (let i = 0; i < outlines.length; i += PARALLEL_BATCH_SIZE) {
    const batch = outlines.slice(i, i + PARALLEL_BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map(async (outline) => {
        // Inject the outline emphasis + angles into the source text as
        // an additional context block. v2 prompt builder will see them
        // alongside the regular RFP text.
        let augmentedSource = opts.sourceText;
        if (outline.emphasis || outline.keyAngles.length > 0) {
          const outlineBlock = `\n\n### STRATEGIC DIRECTION FOR THIS SECTION (from proposal outline pass)\nEmphasis: ${outline.emphasis}\n${outline.keyAngles.length > 0 ? `Key angles to hit:\n${outline.keyAngles.map(a => `  - ${a}`).join('\n')}` : ''}\n`;
          augmentedSource = opts.sourceText + outlineBlock;
        }
        const sectionArgs = {
          email: opts.email,
          sectionType: outline.sectionType,
          sourceText: augmentedSource,
          fileName: opts.fileName,
          rfpAgency: opts.rfpAgency,
          noticePoc: opts.noticePoc,
          requirements: opts.requirements,
        };
        // TIER 2 (gated off via PROPOSAL_MULTIPASS): requirement-heavy sections draft
        // as multi-pass volumes; otherwise the normal single-pass draft.
        return MULTIPASS_ENABLED
          ? generateMultiPassSection(sectionArgs)
          : generateV2Draft(sectionArgs);
      })
    );
    for (let j = 0; j < results.length; j++) {
      const r = results[j];
      const sectionType = batch[j].sectionType;
      if (r.status === 'fulfilled') {
        sections.push(r.value);
      } else {
        errors.push({
          sectionType,
          error: r.reason instanceof Error ? r.reason.message : String(r.reason),
        });
      }
    }
  }
  return { sections, errors };
}

/**
 * Main: outline → parallel write.
 */
export async function generateAllSections(opts: DraftAllOpts): Promise<DraftAllResult> {
  const startTime = Date.now();
  const sectionTypes = opts.sectionTypes || (() => {
    // Auto-pick based on first content signal: if source mentions
    // "Sources Sought" / "RFI" / "market research", use LOI/response
    // sections; otherwise full RFP set.
    const lower = opts.sourceText.slice(0, 3000).toLowerCase();
    const isCapStmt = lower.includes('sources sought') || lower.includes('request for information') || /\brfi\b/.test(lower);
    return isCapStmt ? DEFAULT_CAP_STMT_SECTIONS : DEFAULT_RFP_SECTIONS;
  })();

  console.log(`[proposal/draft-all] Outlining ${sectionTypes.length} sections...`);
  const outline = await generateOutline(opts.sourceText, sectionTypes);

  console.log(`[proposal/draft-all] Rendering ${outline.length} sections in batches of ${PARALLEL_BATCH_SIZE}...`);
  const { sections, errors } = await renderSectionsInBatches(opts, outline);

  // Sort sections in the same order as sectionTypes (Promise.allSettled
  // may return out of order across batches)
  const indexMap = new Map(sectionTypes.map((s, i) => [s as string, i]));
  sections.sort((a, b) => (indexMap.get(a.section) ?? 99) - (indexMap.get(b.section) ?? 99));

  return {
    sections,
    outline,
    totalProcessingMs: Date.now() - startTime,
    errors,
  };
}

// Re-export for callers that need the type
export { isCapStatementSection };
