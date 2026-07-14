/**
 * MCP tool: search_podcast_lessons — the proprietary GovCon Giants podcast corpus. Real
 * lessons from real contractor/agency guests, matched by topic / agency / NAICS / set-
 * aside / guest name. This is un-copyable moat content: no public API has "what did a
 * winning SDVOSB actually learn breaking into VA construction."
 *
 * Wraps the pure src/lib/rag/podcast-search.ts (Supabase keyword/structured search on
 * podcast_episode_metadata — no LLM, no embeddings). Returns episode cards with their
 * key_lessons. grounded=false when nothing matches — do NOT invent a lesson or a guest.
 * tier: metered, credits: 1. `_meta` always ships; `_ai_hint` OFF by default.
 */
import { retrievePodcastEpisodes, type PodcastEpisodeCard } from '@/lib/rag/podcast-search';
import { mcpFlags } from '@/lib/mcp/flags';

export interface PodcastLessonsToolInput {
  /** Free-text: topic, agency, NAICS, set-aside, or a guest name. */
  query: string;
  /** Max episodes (default 4, max 12). */
  limit?: number;
}

export interface PodcastLessonsToolResult {
  episodes: PodcastEpisodeCard[];
  _ai_hint?: { summary: string; how_to_use: string; key_caveats: string[] };
  _meta: {
    grounded: boolean;
    degraded: boolean;
    episode_count: number;
    lesson_count: number;
  };
}

export async function searchPodcastLessons(input: PodcastLessonsToolInput): Promise<PodcastLessonsToolResult> {
  const query = (input.query || '').trim();
  const limit = Math.min(Math.max(input.limit ?? 4, 1), 12);

  let episodes: PodcastEpisodeCard[] = [];
  let degraded = false;
  try {
    episodes = await retrievePodcastEpisodes({ query, limit });
  } catch (e) {
    degraded = true;
    console.error('[search_podcast_lessons] retrieve failed:', e instanceof Error ? e.message : String(e));
  }

  const lessonCount = episodes.reduce((n, e) => n + (Array.isArray(e.key_lessons) ? e.key_lessons.length : 0), 0);
  const grounded = episodes.length > 0;

  const result: PodcastLessonsToolResult = {
    episodes,
    _meta: {
      grounded,
      degraded,
      episode_count: episodes.length,
      lesson_count: lessonCount,
    },
  };

  if (mcpFlags.aiHint) {
    const top = episodes[0];
    result._ai_hint = {
      summary: degraded
        ? 'The podcast corpus errored (Supabase unreachable) — temporarily unavailable, not "no episodes".'
        : !grounded
        ? `No podcast episodes matched "${query}". Try a broader topic, an agency, a NAICS, or a guest name — do NOT invent a lesson.`
        : `${episodes.length} episode(s), ${lessonCount} key lesson(s)${top ? ` — top: "${top.episode_title}"${top.guest_name ? ` w/ ${top.guest_name}` : ''}` : ''}.`,
      how_to_use: grounded
        ? 'Ground advice in the returned key_lessons and cite the episode/guest. This is real practitioner experience, not generic coaching — quote it, do not paraphrase into something the guest did not say.'
        : 'Nothing matched; do NOT fabricate a podcast lesson or a guest. Say the corpus has no episode on this and suggest a broader query.',
      key_caveats: [
        'Every lesson must trace to a returned episode\'s key_lessons — never attribute an invented quote to a guest.',
        'The corpus is what has been recorded + extracted; an empty result is a coverage gap, not evidence the tactic is wrong.',
      ],
    };
  }
  return result;
}
