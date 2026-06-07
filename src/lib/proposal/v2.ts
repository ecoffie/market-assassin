/**
 * Proposal Assist v2 generator.
 *
 * Architecture mirrors what made Content Reaper's LinkedIn posts feel
 * "this applies to MY business":
 *
 *   1. Bidder profile + vault           (FACTUAL — who's writing)
 *   2. Agency context (pain points)     (TARGET — who it's FOR)
 *   3. RAG style references             (HOW strong federal response writing reads)
 *   4. Section-specific lens            (FRAMING — variety across runs)
 *   5. Section-specific writer voice    (PERSONA — exec summary writer
 *                                        ≠ pricing writer)
 *   6. Humanization pass                (DEFENSE against LLM tells)
 *
 * v2 is exposed as buildV2Prompt + generateV2Draft. The /api/app/proposal/draft
 * route can call either v1 or v2; /admin/proposal-ab uses both for comparison.
 */

import { retrieveRagContext, formatChunksForPrompt } from '@/lib/rag/retrieve';
import { callLLM } from '@/lib/llm/call-llm';
import { loadBidderProfile, loadVaultContext, formatProfileForPrompt, formatVaultForPrompt } from './loaders';
import { buildAgencyContext, formatAgencyContextForPrompt } from './agency-context';
import { pickLens } from './lenses';
import { getSectionMeta } from './sections';
import { humanizeProposalDraft } from './humanize';
import { isCapStatementSection, type SectionType, type BuiltPrompt, type DraftResult } from './types';
import { buildTemplateCorpusQuery, getTemplateCorpusDocTypes } from './template-corpus';

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = process.env.PROPOSAL_GROQ_MODEL || 'llama-3.3-70b-versatile';
// Fallback when the primary (70B, small daily quota) is rate-limited.
const PROPOSAL_FALLBACK_MODEL = process.env.PROPOSAL_FALLBACK_MODEL || 'llama-3.1-8b-instant';
const MAX_INPUT_CHARS = 40000;

// ---- Prompt builder -------------------------------------------------

export async function buildV2Prompt(opts: {
  email: string;
  sectionType: SectionType;
  sourceText: string;
  rfpAgency?: string | null;
  lensSeed?: number;  // for deterministic A/B testing
}): Promise<BuiltPrompt> {
  const { email, sectionType, sourceText, rfpAgency, lensSeed } = opts;
  const sectionMeta = getSectionMeta(sectionType);
  const isCapStmt = isCapStatementSection(sectionType);

  const wasTruncated = sourceText.length > MAX_INPUT_CHARS;
  const inputText = wasTruncated ? sourceText.slice(0, MAX_INPUT_CHARS) : sourceText;

  // RAG query uses the output section, notice type, and source head snippet.
  // This makes Proposal Assist retrieve format-specific examples (LOI, RFI,
  // RFQ, technical volume, pricing volume) instead of generic response text.
  const ragQuery = buildTemplateCorpusQuery({
    sectionLabel: sectionMeta.label,
    sectionType,
    sourceText: inputText,
  });

  // Run all the parallel loads
  const [profile, vault, ragChunks] = await Promise.all([
    loadBidderProfile(email),
    loadVaultContext(email, sectionType).catch((err) => {
      console.error('[proposal/v2] vault load failed:', err);
      return { has_any: false } as Awaited<ReturnType<typeof loadVaultContext>>;
    }),
    retrieveRagContext({
      query: ragQuery,
      docTypes: getTemplateCorpusDocTypes(sectionType, inputText),
      limit: 4,
      maxChars: 3500,
      maxPerDoc: 1,
    }).catch((err) => {
      console.error('[proposal/v2] RAG retrieval failed:', err);
      return [];
    }),
  ]);

  // Agency context is synchronous (just lookup against the static
  // pain-points JSON Content Reaper already uses)
  const agency = buildAgencyContext(inputText, rfpAgency);
  const lens = pickLens(sectionType, lensSeed);

  // ---- Compose the SYSTEM PROMPT ----
  // Each section gets its own writer-voice + anti-patterns. This is the
  // big difference from v1 (which had ONE generic 'senior federal
  // proposal writer' prompt for all sections).
  const banList = sectionMeta.antiPatterns.map(p => `- DO NOT: ${p}`).join('\n');

  const systemPrompt = `${sectionMeta.voice}

You will receive several context blocks. Use them like this:
- **Bidder profile + Bidder identity/past-performance/capabilities/team blocks**: FACTUAL. Use verbatim — real UEI, real contracts, real team. NEVER use [placeholders] for facts the vault provides.
- **Agency context (pain points + priorities)**: USE these to ground every claim in what THIS agency actually struggles with. Reference at least one specific pain point or priority where natural. This is what makes the draft feel like it was written FOR them, not generic.
- **Teaching library chunks**: STYLE references only. Learn the framing, vocabulary, structure. Do NOT copy phrasing verbatim.
- **Lens framing**: Apply the framing for THIS draft. Different lens each generation forces variety across drafts.

Section-specific constraints — what NOT to do:
${banList}

General rules:
- ${isCapStmt
    ? 'This is a Letter of Intent / market-research response section for a Sources Sought or RFI. Draft the response narrative; assume the user attaches an existing capability statement separately if requested. NOT a proposal volume.'
    : 'This is an RFP PROPOSAL section — compliant, evaluation-factor aware, federal capture voice.'}
- Mirror language from the source document where it shows you understand the scope.
- Use bracketed [placeholders] ONLY for facts not in the bidder profile or vault.
- NEVER use: "world-class", "best-in-class", "cutting-edge", "innovative solutions", "leverage", "synergistic", "state-of-the-art", "passionate", "dedicated commitment", "robust scalable".
- NEVER open with "In today's federal landscape..." or similar GPT intros.
- NEVER stack three adjectives ("robust, scalable, and secure").
- Output plain markdown. No JSON. No commentary about what you wrote.`;

  // ---- Compose the USER PROMPT ----
  const profileBlock = formatProfileForPrompt(profile);
  const vaultBlock = formatVaultForPrompt(vault);
  const agencyBlock = formatAgencyContextForPrompt(agency);
  const ragBlock = formatChunksForPrompt(ragChunks);

  const parts: string[] = [];

  parts.push(`### Bidder profile (NAICS / agencies / set-asides)\n${profileBlock}`);
  if (vaultBlock) parts.push(vaultBlock);
  if (agencyBlock) parts.push(agencyBlock);
  if (ragBlock) parts.push(`### Curated proposal corpus — STYLE references (do NOT copy verbatim)\n${ragBlock}`);

  if (lens) {
    parts.push(`### Lens for THIS draft\n${lens.framing}\n\n(Use this framing. A different lens may be used on a future run to produce a different framing — this is intentional.)`);
  }

  parts.push(`### Section to draft: ${sectionMeta.label}\n${sectionMeta.basePrompt}`);

  parts.push(`### Source solicitation${opts ? '' : ''}\n--- SOURCE TEXT (${inputText.length.toLocaleString()} chars${wasTruncated ? ', truncated' : ''}) ---\n${inputText}`);

  const userPrompt = parts.join('\n\n');

  return {
    systemPrompt,
    userPrompt,
    context: {
      profile,
      vault,
      agency,
      rag: ragChunks,
      lens,
      inputChars: inputText.length,
      wasTruncated,
    },
  };
}

// ---- Generator ------------------------------------------------------

export async function generateV2Draft(opts: {
  email: string;
  sectionType: SectionType;
  sourceText: string;
  fileName?: string;
  rfpAgency?: string | null;
  lensSeed?: number;
}): Promise<DraftResult> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('GROQ_API_KEY not configured');

  const built = await buildV2Prompt(opts);
  const sectionMeta = getSectionMeta(opts.sectionType);

  // PROVIDER-AGNOSTIC drafting (Eric QC: "5 sections failed" — Groq's daily quota
  // was exhausted and the old 70B→8B fallback is BOTH Groq, so both died). Use
  // the 'drafting' chain (Groq 70B → Claude → OpenAI → Grok) so a draft ALWAYS
  // comes back even when Groq is fully throttled. Low volume, so Claude is safe.
  const { text: rawDraftRaw, provider } = await callLLM({
    system: built.systemPrompt,
    user: built.userPrompt,
    temperature: 0.5,
    maxTokens: 2200,
    job: 'drafting',
  });
  const rawDraft = (rawDraftRaw || '').trim();
  if (!rawDraft) throw new Error('AI returned empty draft (all providers)');

  // ---- Humanization pass ----
  const { text: humanizedDraft } = humanizeProposalDraft(rawDraft);
  const wordCount = humanizedDraft.split(/\s+/).filter(Boolean).length;

  return {
    section: opts.sectionType,
    label: sectionMeta.label,
    draft: humanizedDraft,
    wordCount,
    targetWords: sectionMeta.targetWords,
    meta: {
      model: provider,
      pipeline: 'v2',
      inputChars: built.context.inputChars,
      truncated: built.context.wasTruncated,
      originalChars: opts.sourceText.length,
      profileGrounded: !!(built.context.profile.naicsCodes?.length || built.context.profile.companyName),
      vaultGrounded: built.context.vault.has_any,
      vaultCounts: {
        past_performance: built.context.vault.past_performance?.length || 0,
        capabilities: built.context.vault.capabilities?.length || 0,
        team: built.context.vault.team?.length || 0,
      },
      ragChunksUsed: built.context.rag.length,
      ragSources: built.context.rag.map(c => ({ title: c.doc_title, type: c.doc_type })),
      agencyDetected: built.context.agency.agency,
      painPointsUsed: built.context.agency.painPoints.length,
      lensId: built.context.lens?.id || null,
      humanized: true,
    },
  };
}
