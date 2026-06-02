/**
 * Proposal Assist v1 generator — wrapped as a callable function so the
 * A/B harness can compare it head-to-head with v2.
 *
 * This is the ORIGINAL prompt structure (before agency context, lenses,
 * humanization, per-section voices). Kept as the baseline for measuring
 * whether v2 is actually better.
 *
 * The original /api/app/proposal/draft/route.ts inlines all of this;
 * this file lifts it into a reusable function. The route can be moved
 * to call this helper if we want a single source of truth, but for now
 * the route keeps its own inline logic to minimize regression risk.
 */

import { retrieveRagContext, formatChunksForPrompt } from '@/lib/rag/retrieve';
import { loadBidderProfile, loadVaultContext, formatProfileForPrompt, formatVaultForPrompt } from './loaders';
import { getSectionMeta } from './sections';
import { isCapStatementSection, type SectionType, type DraftResult } from './types';

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = process.env.PROPOSAL_GROQ_MODEL || 'llama-3.3-70b-versatile';
const MAX_INPUT_CHARS = 40000;

export async function generateV1Draft(opts: {
  email: string;
  sectionType: SectionType;
  sourceText: string;
  fileName?: string;
}): Promise<DraftResult & { prompt: { system: string; user: string } }> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('GROQ_API_KEY not configured');

  const { email, sectionType, sourceText, fileName } = opts;
  const sectionMeta = getSectionMeta(sectionType);
  const isCapStmt = isCapStatementSection(sectionType);

  const wasTruncated = sourceText.length > MAX_INPUT_CHARS;
  const inputText = wasTruncated ? sourceText.slice(0, MAX_INPUT_CHARS) : sourceText;

  const rfpSnippet = inputText.slice(0, 1000).replace(/\s+/g, ' ');
  const ragQuery = `${sectionMeta.label} ${rfpSnippet}`;

  const [profile, vault, ragChunks] = await Promise.all([
    loadBidderProfile(email),
    loadVaultContext(email, sectionType).catch(() => ({ has_any: false } as Awaited<ReturnType<typeof loadVaultContext>>)),
    retrieveRagContext({
      query: ragQuery,
      docTypes: (() => {
        if (sectionType === 'past_performance' || sectionType === 'cap_past_performance') return ['proposal_template', 'past_performance', 'cap_statement', 'course_material'];
        if (sectionType === 'company_overview' || sectionType === 'capabilities' || sectionType === 'differentiators' || sectionType === 'poc') return ['cap_statement', 'proposal_template', 'course_material'];
        return ['proposal_template', 'course_material', 'webinar_resource', 'teaching_handout'];
      })(),
      limit: 4,
      maxChars: 3500,
      maxPerDoc: 1,
    }).catch(() => []),
  ]);

  const profileBlock = formatProfileForPrompt(profile);
  const vaultBlock = formatVaultForPrompt(vault);
  const ragBlock = formatChunksForPrompt(ragChunks);

  // v1's single generic system prompt
  const systemPrompt = isCapStmt
    ? `You are a senior federal capture writer. Draft a SHORT Letter of Intent / market-research response section for a Sources Sought or RFI — NOT a proposal. The user should attach their existing capability statement separately if the notice requests one.

How to use the context you'll receive:
- Bidder profile + vault data = FACTS about this bidder. Use them verbatim (real UEI, real past performance, real capabilities, real team). Do NOT use [placeholders] for anything the vault provides.
- Teaching examples (if present) = STYLE references from Eric Coffie's teaching library. Learn the framing + vocabulary + structure. Do NOT copy phrasing verbatim; adapt to this specific bidder + solicitation.

Rules:
- Concise prose + scannable bullets. No marketing fluff.
- Mirror language from the source notice where it shows alignment with the scope.
- Use bracketed [placeholders] ONLY for facts not in the bidder profile or vault.
- Never invent facts about the bidder beyond what is provided.
- Never use 'world-class', 'best-in-class', 'cutting-edge'.
- Do NOT use proposal section labels like 'Executive Summary' — this is an LOI / response section.
- Output plain markdown only. No JSON. No commentary about what you wrote.`
    : `You are a senior federal proposal writer. Draft proposal section copy that is compliant, specific to the source solicitation, and grounded in the bidder's saved profile + vault.

How to use the context you'll receive:
- Bidder profile + vault data = FACTS about this bidder. Use them verbatim (real UEI, real past performance, real capabilities, real team). Do NOT use [placeholders] for anything the vault provides.
- Teaching examples (if present) = STYLE references from Eric Coffie's teaching library. Learn the framing + vocabulary + structure. Do NOT copy phrasing verbatim; adapt to this specific bidder + solicitation.

Rules:
- Use clear headings and short paragraphs.
- Mirror language from the solicitation where it shows the bidder understands the scope.
- Use bracketed [placeholders] ONLY for facts not in the bidder profile or vault.
- Never invent facts about the bidder beyond what is provided.
- No marketing fluff, no superlatives like "world-class" or "best-in-class".
- Output plain markdown only. No JSON. No commentary about what you wrote.`;

  const parts: string[] = [];
  parts.push(`Bidder profile (NAICS / agencies / set-asides):\n${profileBlock}`);
  if (vaultBlock) parts.push(vaultBlock);
  if (ragBlock) parts.push(`### Eric Coffie teaching library — STYLE references (do NOT copy verbatim)\n${ragBlock}`);
  parts.push(`### Section to draft: ${sectionMeta.label}\n${sectionMeta.basePrompt}`);
  parts.push(`### Solicitation: ${fileName || 'untitled'}\n--- SOURCE TEXT (${inputText.length.toLocaleString()} chars${wasTruncated ? ', truncated' : ''}) ---\n${inputText}`);
  const userPrompt = parts.join('\n\n');

  const response = await fetch(GROQ_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.4,
      max_tokens: 2200,
    }),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`Groq ${response.status}: ${errText.slice(0, 300)}`);
  }

  const completion = await response.json();
  const draft = (completion.choices?.[0]?.message?.content || '').trim();
  if (!draft) throw new Error('AI returned empty draft');

  const wordCount = draft.split(/\s+/).filter(Boolean).length;

  return {
    section: sectionType,
    label: sectionMeta.label,
    draft,
    wordCount,
    targetWords: sectionMeta.targetWords,
    meta: {
      model: GROQ_MODEL,
      pipeline: 'v1',
      inputChars: inputText.length,
      truncated: wasTruncated,
      originalChars: sourceText.length,
      profileGrounded: profileBlock !== 'No saved profile — write generically with [Company name] placeholders.',
      vaultGrounded: vault.has_any,
      vaultCounts: {
        past_performance: vault.past_performance?.length || 0,
        capabilities: vault.capabilities?.length || 0,
        team: vault.team?.length || 0,
      },
      ragChunksUsed: ragChunks.length,
      ragSources: ragChunks.map(c => ({ title: c.doc_title, type: c.doc_type })),
      agencyDetected: null,
      painPointsUsed: 0,
      lensId: null,
      humanized: false,
    },
    prompt: { system: systemPrompt, user: userPrompt },
  };
}
