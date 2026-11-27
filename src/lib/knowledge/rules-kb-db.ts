/**
 * Rules KB reads for Ask Mindy / reports (server only). The register is small (16 rows), so it is read whole and
 * ranked with the same in-memory ranker the tests prove (rankRuleClaims). A failed read is `unavailable`, never an
 * empty answer that reads as "no rule applies".
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { checkClaims, rankRuleClaims, type ClaimCheck, type RegisterRow } from './rules-kb';

export type RegisterRead = { ok: true; rows: RegisterRow[] } | { ok: false; error: string };

export async function readRuleRegister(db: Pick<SupabaseClient, 'from'>): Promise<RegisterRead> {
  const { data, error } = await db.from('kb_rule_claims').select('*').order('entry_no');
  if (error) return { ok: false, error: error.message };
  return { ok: true, rows: (data ?? []) as RegisterRow[] };
}

export type RuleSearch =
  | { status: 'found'; claims: RegisterRow[] }
  | { status: 'none_found'; claims: [] }
  | { status: 'unavailable'; claims: []; error: string };

/** Find the rule entries for a question. Every returned row carries its sources (with official passages) and status. */
export async function searchRuleClaims(db: Pick<SupabaseClient, 'from'>, query: string, limit = 3): Promise<RuleSearch> {
  const read = await readRuleRegister(db);
  if (!read.ok) return { status: 'unavailable', claims: [], error: read.error };
  const claims = rankRuleClaims(query, read.rows, limit);
  return claims.length ? { status: 'found', claims } : { status: 'none_found', claims: [] };
}

/** Pre-ship check against the live register (Fix 1B). `today` is YYYY-MM-DD. */
export async function checkClaimsLive(
  db: Pick<SupabaseClient, 'from'>, ids: string[], today: string,
): Promise<{ ok: true; checks: ClaimCheck[] } | { ok: false; error: string }> {
  const read = await readRuleRegister(db);
  if (!read.ok) return { ok: false, error: read.error };
  return { ok: true, checks: checkClaims(ids, read.rows, today) };
}
