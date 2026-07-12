/**
 * MCP tool: get_winning_playbook — the Phase 0 spike tool for the Mindy MCP server.
 *
 * WHY THIS TOOL FIRST (not search_sam_opportunities): the SAM API is free/public, so
 * "search SAM" is the commodity layer any competitor can wrap. The moat is the
 * PROPRIETARY GovCon Giants teaching corpus — 8 years of course + coaching + podcast
 * content that answers "how do I actually WIN this," which no public API contains.
 * Proving the MCP transport with THIS tool demos the un-copyable differentiator on day
 * one. (PRD: tasks/PRD-mindy-mcp-server.md §1a, §8.)
 *
 * Transport-agnostic on purpose: this file is pure tool logic (input -> result). The
 * stdio entrypoint (src/mcp/server.ts) and the future hosted HTTP route both wrap this
 * same function, so there is zero rework when we add the hosted edge.
 *
 * Assembles the "playbook" from two proprietary RAG pulls (there is no single stored
 * "playbook" object — it's composed):
 *   1. retrieveRagContext() over the how-to-win doc types (proposal_template /
 *      cap_statement / past_performance) — the tactical guidance chunks.
 *   2. getPodcastInsightForProfile() — the best "someone like you won it this way"
 *      quote from a real podcast guest, when NAICS codes are provided.
 */

import { retrieveRagContext, formatChunksForPrompt } from '@/lib/rag/retrieve';
import { getPodcastInsightForProfile } from '@/lib/rag/podcast-insights';

/** Doc types that carry actual how-to-win guidance (mirrors the chat/proposal pulls). */
const PLAYBOOK_DOC_TYPES = ['proposal_template', 'cap_statement', 'past_performance'];

export interface WinningPlaybookInput {
  /** The scenario — free text. e.g. "win an 8(a) construction recompete at the VA". */
  topic: string;
  /** Optional NAICS codes to pull a matching real-guest win-story quote. */
  naics_codes?: string[];
  /** Max guidance chunks (default 6). */
  limit?: number;
}

export interface WinningPlaybookResult {
  topic: string;
  /** Tactical guidance passages from the GovCon Giants teaching corpus. */
  guidance: Array<{
    source: string; // "from Eric's <doc_type> teaching: <title>"
    doc_type: string | null;
    text: string;
  }>;
  /** A real podcast-guest win story matched to the NAICS, when provided + found. */
  win_story: {
    quote: string;
    guest: string | null;
    company: string | null;
    episode: string;
    episode_url: string | null;
    matched_naics: string[];
  } | null;
  /** Pre-narrated conclusion the calling agent can quote verbatim (the _ai_hint moat). */
  _ai_hint: {
    summary: string;
    how_to_use: string;
    key_caveats: string[];
  };
  /** Provenance so the agent (and we) can trust/trace the answer. */
  _meta: {
    guidance_chunks: number;
    corpus: string;
    grounded: boolean; // false => nothing matched; agent should NOT invent an answer
  };
}

/**
 * Run the playbook retrieval. Pure function — no transport, no auth (the caller/edge
 * handles those). Never fabricates: if the corpus returns nothing, `grounded=false`
 * and guidance is empty (the agent must say "no corpus match", not hallucinate).
 */
export async function getWinningPlaybook(
  input: WinningPlaybookInput,
): Promise<WinningPlaybookResult> {
  const topic = String(input.topic || '').trim();
  const limit = Math.min(Math.max(input.limit ?? 6, 1), 12);
  const naics = (input.naics_codes || [])
    .map((c) => String(c || '').replace(/\D/g, '').slice(0, 6))
    .filter((c) => c.length >= 4);

  // 1) Tactical guidance from the teaching corpus.
  let chunks: Awaited<ReturnType<typeof retrieveRagContext>> = [];
  try {
    chunks = await retrieveRagContext({
      query: topic,
      docTypes: PLAYBOOK_DOC_TYPES,
      limit,
    });
  } catch (err) {
    // Surface, don't swallow — a retrieval failure must be visible, not silent-empty.
    console.error('[mcp:get_winning_playbook] corpus retrieval failed:', err);
  }

  const guidance = chunks.map((c) => ({
    source: `from Eric's ${c.doc_type || 'teaching'}: ${c.doc_title || 'untitled'}`,
    doc_type: c.doc_type,
    text: c.chunk_text,
  }));

  // 2) A real-guest win story matched to the NAICS (bonus — only when NAICS given).
  let winStory: WinningPlaybookResult['win_story'] = null;
  if (naics.length) {
    try {
      const insight = await getPodcastInsightForProfile({
        naicsCodes: naics,
        today: new Date().toISOString().slice(0, 10),
      });
      if (insight) {
        winStory = {
          quote: insight.quote,
          guest: insight.guestName,
          company: insight.guestCompany,
          episode: insight.episodeTitle,
          episode_url: insight.episodeUrl,
          matched_naics: insight.matchedNaics,
        };
      }
    } catch (err) {
      console.error('[mcp:get_winning_playbook] podcast insight failed:', err);
    }
  }

  const grounded = guidance.length > 0 || winStory !== null;

  // Pre-narrated conclusion — every fact traces to the real returned data (no LLM guess).
  const summary = grounded
    ? `Found ${guidance.length} guidance passage${guidance.length === 1 ? '' : 's'} from the GovCon Giants teaching corpus on "${topic}"` +
      (winStory
        ? `, plus a real win story from ${winStory.guest || 'a podcast guest'}${winStory.company ? ` (${winStory.company})` : ''}.`
        : '.')
    : `No teaching-corpus match for "${topic}". Do not invent a playbook — tell the user Mindy has no coaching content on this exact scenario and suggest they broaden the topic.`;

  return {
    topic,
    guidance,
    win_story: winStory,
    _ai_hint: {
      summary,
      how_to_use: grounded
        ? 'Quote the guidance passages as Eric Coffie / GovCon Giants coaching, and the win_story as a real contractor precedent. These are proprietary teaching content, not public data.'
        : 'No grounded content returned; state that plainly rather than generating advice.',
      key_caveats: grounded
        ? ['Guidance is teaching material, not legal/contractual advice.', 'Verify agency-specific requirements against the actual solicitation.']
        : ['Zero corpus matches — any advice here would be ungrounded.'],
    },
    _meta: {
      guidance_chunks: guidance.length,
      corpus: 'GovCon Giants teaching corpus (mindy_rag_chunks + podcast_episodes)',
      grounded,
    },
  };
}

/** Convenience for a text-first agent surface: a single prompt-ready string. */
export function formatPlaybookForPrompt(result: WinningPlaybookResult): string {
  const parts: string[] = [`# Winning Playbook — ${result.topic}\n`];
  if (result.guidance.length) {
    parts.push(formatChunksForPrompt(
      result.guidance.map((g, i) => ({
        document_id: String(i),
        chunk_index: i,
        chunk_text: g.text,
        doc_title: g.source,
        doc_type: g.doc_type,
        doc_top_level_folder: null,
        source_path: null,
        rank: 0,
      })),
    ));
  }
  if (result.win_story) {
    parts.push(`\n## Real win story\n"${result.win_story.quote}"\n— ${result.win_story.guest || 'Podcast guest'}${result.win_story.company ? `, ${result.win_story.company}` : ''} (${result.win_story.episode})`);
  }
  if (!result.guidance.length && !result.win_story) {
    parts.push('\n(No teaching-corpus match — do not fabricate advice.)');
  }
  return parts.join('\n');
}
