/**
 * Bounded second planner tool round for Ask Mindy (multi-hop research).
 *
 * Round 1 often resolves a notice / prior award but cannot also call the hop
 * (competitors, contacts, capable contractors, solicitation documents) in the
 * same planner turn. A second round is offered only when round 1 already returned
 * a successful seed tool — never as a blank-slate retry, never a third round.
 *
 * Hygiene: skip plain lookups and already-complete R1 turns; R2 callers must use
 * tool_choice:auto and drop R2 calls identical to R1 (name + normalized args).
 * Pagination fields stay in the identity key so page-2 of the same filters is kept.
 *
 * Policy, write caps, confirmations, timeouts and billing stay with the executor;
 * this module only decides whether to ask the planner again and how to dedupe.
 */

/**
 * Tools whose success can unlock a useful follow-on hop in the same customer turn.
 * Open/expiring *list* tools are deliberately excluded — they usually finish the
 * turn as a rendered list and must not spend a second planner pass by default.
 */
export const SECOND_ROUND_SEED_TOOLS: ReadonlySet<string> = new Set([
  'lookup_solicitation',
  'get_solicitation_incumbent',
  'search_past_contracts',
]);

/**
 * Tools that already complete the common multi-hop. If round 1 succeeded on any of
 * these, a second planner pass adds no customer value for the usual hop shapes.
 */
export const SECOND_ROUND_COMPLETE_TOOLS: ReadonlySet<string> = new Set([
  'find_capable_contractors',
  'search_federal_contacts',
]);

/**
 * Customer-question cues that still need a hop after a seed:
 * - competitors / capable firms
 * - contacts / buying office
 * - solicitation document / SOW / PWS / attachment text
 *
 * Plain "what is this solicitation / due date / largest awards" do not match —
 * those are answerable from round 1 and must not buy a second planner pass
 * (T6/T7/T8 class). Document *research* cues do match so lookup→documents works.
 */
export const SECOND_ROUND_HOP_CUE =
  /\b(compet(?:e|es|ing|itor|itors)?|who else|similar (?:firms?|companies|contractors)|capable contractors?|contacts?|poc|points? of contact|buying[- ]?offices?|roster|contracting officers?|who (?:do i|should i) (?:call|email|contact)|emails? for|sow|pws|statement of work|performance work statement|attachments?|solicitation documents?|rfp (?:text|docs?|documents?)|full (?:document |attachment )?text|document (?:text|body|contents?|pack)|download(?:able)? (?:the )?(?:docs?|documents?|pdf|attachments?))\b/i;

export interface SecondRoundSeed {
  tool: string;
  status: string;
}

export type SecondRoundSkipReason =
  | 'empty'
  | 'timeout'
  | 'planner_unavailable'
  | 'no_seed'
  | 'already_complete'
  | 'no_hop_cue'
  | 'documents_already_fetched';

export type SecondRoundDecision =
  | { offer: true }
  | { offer: false; reason: SecondRoundSkipReason };

const DOCUMENT_HOP_CUE =
  /\b(sow|pws|statement of work|performance work statement|attachments?|solicitation documents?|rfp (?:text|docs?|documents?)|full (?:document |attachment )?text|document (?:text|body|contents?|pack)|download(?:able)? (?:the )?(?:docs?|documents?|pdf|attachments?))\b/i;

/**
 * Decide whether to spend a second planner pass. Preserves clean multi-hop
 * (seed + hop cue, hop not already run); skips plain lookups and complete R1.
 */
export function decideSecondToolRound(
  round1: ReadonlyArray<SecondRoundSeed>,
  opts: {
    turnTimedOut?: boolean;
    plannerUnavailable?: boolean;
    /** Customer question (not the map preamble). Hop cues are matched against this. */
    customerText?: string;
  } = {},
): SecondRoundDecision {
  if (opts.turnTimedOut) return { offer: false, reason: 'timeout' };
  if (opts.plannerUnavailable) return { offer: false, reason: 'planner_unavailable' };
  if (!round1.length) return { offer: false, reason: 'empty' };

  const success = round1.filter((r) => r.status === 'success');
  if (!success.some((r) => SECOND_ROUND_SEED_TOOLS.has(r.tool))) {
    return { offer: false, reason: 'no_seed' };
  }
  if (success.some((r) => SECOND_ROUND_COMPLETE_TOOLS.has(r.tool))) {
    return { offer: false, reason: 'already_complete' };
  }
  const text = String(opts.customerText || '').trim();
  if (!text || !SECOND_ROUND_HOP_CUE.test(text)) {
    return { offer: false, reason: 'no_hop_cue' };
  }
  // Document-only questions: if R1 already pulled solicitation documents, do not
  // spend another planner pass unless a non-document hop cue remains.
  const docOnly = DOCUMENT_HOP_CUE.test(text) && !/\b(compet(?:e|es|ing|itor|itors)?|who else|contacts?|poc|buying[- ]?offices?|roster|contracting officers?)\b/i.test(text);
  if (docOnly && success.some((r) => r.tool === 'get_solicitation_documents')) {
    return { offer: false, reason: 'documents_already_fetched' };
  }
  return { offer: true };
}

/**
 * True when round 1 produced at least one successful seed tool, the question still
 * needs a hop, and R1 did not already complete that hop.
 */
export function shouldOfferSecondToolRound(
  round1: ReadonlyArray<SecondRoundSeed>,
  opts: {
    turnTimedOut?: boolean;
    plannerUnavailable?: boolean;
    customerText?: string;
  } = {},
): boolean {
  return decideSecondToolRound(round1, opts).offer;
}

/**
 * Cross-round identity ignores nothing about which page of a list the customer asked
 * for. `display_offset` / `page` / `__page` / `offset` stay in the key so a page-2
 * follow-up is not dropped as a duplicate of page 1.
 *
 * `limit` alone still does not distinguish two searches (same filters, different
 * row caps) — matching the R1 `dedupeToolCalls` contract.
 */
const DEDUPE_IGNORE_KEYS = new Set([
  'limit',
]);

/**
 * Stable identity for a tool call: tool name + normalized JSON args.
 * Changed arguments (e.g. a different NAICS, state, or display_offset) keep a
 * different key so legitimate follow-on searches and pagination are preserved.
 */
export function toolCallIdentityKey(tool: string, args: string | Record<string, unknown> | null | undefined): string {
  const name = String(tool || '').trim();
  let parsed: Record<string, unknown> = {};
  if (args && typeof args === 'object' && !Array.isArray(args)) {
    parsed = { ...args };
  } else {
    try {
      const raw = JSON.parse(typeof args === 'string' ? args || '{}' : '{}');
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) parsed = raw as Record<string, unknown>;
      else return `${name}|${String(args ?? '')}`;
    } catch {
      return `${name}|${String(args ?? '')}`;
    }
  }
  const norm: Record<string, unknown> = {};
  for (const k of Object.keys(parsed).sort()) {
    if (DEDUPE_IGNORE_KEYS.has(k)) continue;
    const v = parsed[k];
    if (v == null) continue;
    // Omit zero offsets so "no display_offset" and "display_offset:0" compare equal
    // (avoids a harmless redundant page-1 replay when the planner restates offset 0).
    if ((k === 'display_offset' || k === 'offset' || k === 'page' || k === '__page') && Number(v) === 0) continue;
    if (Array.isArray(v)) {
      norm[k] = [...v].map((x) => String(x).trim().toUpperCase()).filter(Boolean).sort();
    } else if (typeof v === 'string') {
      // Comma-joined code/state lists compare as sets.
      if (/^(naics|state|states|psc|psc_codes)$/i.test(k) && v.includes(',')) {
        norm[k] = v.split(',').map((x) => x.trim().toUpperCase()).sort();
      } else {
        norm[k] = v.trim();
      }
    } else if (typeof v === 'number' || typeof v === 'boolean') {
      norm[k] = v;
    } else {
      norm[k] = v;
    }
  }
  return `${name}|${JSON.stringify(norm)}`;
}

export interface Round1CallFingerprint {
  tool: string;
  args: string | Record<string, unknown> | null | undefined;
}

/**
 * Drop round-2 planned calls whose (tool, normalized args) already ran in round 1.
 * Calls with changed arguments (including pagination offset) are kept.
 */
export function dropDuplicateRound2Calls<T extends { id?: string; function?: { name?: string; arguments?: string } }>(
  round2Calls: ReadonlyArray<T>,
  round1: ReadonlyArray<Round1CallFingerprint>,
): { keep: T[]; duplicates: Array<{ id: string; tool: string; key: string }> } {
  const seen = new Set(round1.map((r) => toolCallIdentityKey(r.tool, r.args)));
  const keep: T[] = [];
  const duplicates: Array<{ id: string; tool: string; key: string }> = [];
  for (const tc of round2Calls) {
    const tool = String(tc.function?.name || '');
    const args = String(tc.function?.arguments ?? '');
    const key = toolCallIdentityKey(tool, args);
    if (seen.has(key)) {
      duplicates.push({ id: String(tc.id || tool), tool, key });
    } else {
      keep.push(tc);
    }
  }
  return { keep, duplicates };
}
