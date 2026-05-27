/**
 * Anti-repetition memory for briefings.
 *
 * Mirrors Content Reaper's `previousAngles` pattern (where the client
 * sends the last 50 generated post angles back to the server and the
 * AI is instructed not to repeat them). Aggregated at the
 * naics_profile_hash level because briefings are pre-computed per
 * profile, not per user.
 *
 * Three functions:
 *   - extractAnglesFromBriefing(briefing) → string[]
 *       Pulls the top 5 story angles (opportunity titles + themes).
 *   - persistAngles(profileHash, briefingType, angles) → void
 *       Fire-and-forget INSERT. Doesn't block briefing generation.
 *   - getRecentAngles(profileHash, briefingType, limit=10) → string[]
 *       Returns last N angles for the profile, for prompt injection.
 *
 * Built 2026-05-27 from Content Reaper pattern audit (#3 — highest-
 * compounding pattern: zero new UI, no email-template changes, but
 * every briefing gets fresher week-over-week).
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _supabase: SupabaseClient<any> | null = null;
function getSupabase(): SupabaseClient | null {
  if (_supabase) return _supabase;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  _supabase = createClient(url, key, { auth: { persistSession: false } });
  return _supabase;
}

// ---- Extract -------------------------------------------------------

/**
 * Extract up to 5 short "angle" strings from a briefing for repetition
 * tracking. Angles are the key narrative threads — what would make a
 * user say "wait, this is the same briefing again."
 *
 * Strategy: combine top opportunity titles (trimmed) + any extracted
 * themes / lead headlines if present.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function extractAnglesFromBriefing(briefing: any): string[] {
  if (!briefing || typeof briefing !== 'object') return [];

  const angles: string[] = [];
  const seen = new Set<string>();

  function pushUnique(s: string) {
    const trimmed = s.trim();
    if (!trimmed) return;
    // Normalize for dedup — lowercase, collapse whitespace
    const key = trimmed.toLowerCase().replace(/\s+/g, ' ').slice(0, 80);
    if (seen.has(key)) return;
    seen.add(key);
    // Store the original casing but cap at 120 chars (DB-friendly)
    angles.push(trimmed.slice(0, 120));
  }

  // 1. Top opportunity titles (strongest signal of repetition)
  const opps = Array.isArray(briefing.opportunities) ? briefing.opportunities : [];
  for (const opp of opps.slice(0, 5)) {
    const title = (opp?.title || opp?.contractName || opp?.solicitationTitle || '').toString();
    if (title) pushUnique(title);
    if (angles.length >= 5) break;
  }

  // 2. Lead headline / theme if present (some briefing shapes have this)
  if (typeof briefing.headline === 'string') pushUnique(briefing.headline);
  if (typeof briefing.leadStory === 'string') pushUnique(briefing.leadStory);
  if (Array.isArray(briefing.themes)) {
    for (const t of briefing.themes.slice(0, 3)) {
      if (typeof t === 'string') pushUnique(t);
      if (angles.length >= 5) break;
    }
  }

  // 3. Multisite + teaming-play titles (secondary signal)
  for (const m of (briefing.multisiteOpps || []).slice(0, 3)) {
    if (m?.title) pushUnique(m.title.toString());
    if (angles.length >= 5) break;
  }
  for (const t of (briefing.teamingPlays || []).slice(0, 3)) {
    if (t?.title) pushUnique(t.title.toString());
    if (angles.length >= 5) break;
  }

  return angles.slice(0, 5);
}

// ---- Persist (fire-and-forget) -------------------------------------

/**
 * Insert an angle-history row for this profile + briefing. Failures
 * are logged but never thrown — repetition memory degrading gracefully
 * is fine; blocking briefing generation is not.
 */
export async function persistAngles(opts: {
  naicsProfileHash: string;
  briefingType: 'daily' | 'weekly' | 'pursuit';
  briefingDate: string; // ISO date YYYY-MM-DD
  angles: string[];
}): Promise<void> {
  if (!opts.naicsProfileHash || opts.angles.length === 0) return;
  const supabase = getSupabase();
  if (!supabase) return;

  try {
    const { error } = await supabase.from('briefing_angle_history').insert({
      naics_profile_hash: opts.naicsProfileHash,
      briefing_type: opts.briefingType,
      briefing_date: opts.briefingDate,
      angles: opts.angles,
    });
    if (error) {
      console.warn('[angle-history] persist failed (non-fatal):', error.message);
    }
  } catch (err) {
    console.warn('[angle-history] persist threw (non-fatal):', err);
  }
}

// ---- Retrieve ------------------------------------------------------

/**
 * Fetch the last N angles for this profile + briefing type.
 * Used at prompt-build time to tell the AI which angles to prefer
 * away from.
 *
 * Returns flat string[] (duplicates removed across rows) capped at
 * 25 angles. Cron-safe — silent fallback to [] on any failure.
 */
export async function getRecentAngles(opts: {
  naicsProfileHash: string;
  briefingType: 'daily' | 'weekly' | 'pursuit';
  limit?: number;
}): Promise<string[]> {
  if (!opts.naicsProfileHash) return [];
  const supabase = getSupabase();
  if (!supabase) return [];

  const limit = opts.limit ?? 10;

  try {
    const { data, error } = await supabase
      .from('briefing_angle_history')
      .select('angles')
      .eq('naics_profile_hash', opts.naicsProfileHash)
      .eq('briefing_type', opts.briefingType)
      .order('briefing_date', { ascending: false })
      .limit(limit);

    if (error) {
      console.warn('[angle-history] retrieve failed (non-fatal):', error.message);
      return [];
    }

    // Flatten + dedup + cap
    const out: string[] = [];
    const seen = new Set<string>();
    for (const row of data || []) {
      for (const a of (row.angles || []) as string[]) {
        const key = a.toLowerCase().trim();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(a);
        if (out.length >= 25) break;
      }
      if (out.length >= 25) break;
    }
    return out;
  } catch (err) {
    console.warn('[angle-history] retrieve threw (non-fatal):', err);
    return [];
  }
}

// ---- Prompt formatter ----------------------------------------------

/**
 * Format the angles into a prompt block. Returns '' if empty so the
 * caller can do `${maybeAngles ? maybeAngles + '\n' : ''}` cleanly.
 */
export function formatAnglesForPrompt(angles: string[]): string {
  if (angles.length === 0) return '';
  const numbered = angles.map((a, i) => `  ${i + 1}. ${a}`).join('\n');
  return `RECENT ANGLES THIS PROFILE HAS ALREADY SEEN (prefer FRESH framings — do not repeat unless an opportunity legitimately requires it):
${numbered}

When choosing today's opportunities + themes, lean toward angles NOT in the list above. If a specific opportunity is genuinely the top pick despite matching a recent angle, you may still surface it — but rephrase the framing.`;
}
