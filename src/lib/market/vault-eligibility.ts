/**
 * Batch-load Vault certifications for the alert crons, so eligibility can come
 * from BOTH sources (business_type + the Vault array) without a per-user query.
 *
 * WHY BATCH: daily-alerts iterates ~774 alert-enabled users inside a cron with a
 * hard timeout. A per-user `user_identity_profile` lookup would add 774 sequential
 * round-trips to a job that already pages the whole notification table. One IN()
 * query keyed by email is O(1) round-trips and costs nothing measurable.
 *
 * WHY IT EXISTS AT ALL: alerts derive eligibility from
 * user_notification_settings.business_type — a single free-text string. Users
 * maintain the Vault instead, which is an ARRAY and routinely richer:
 *   business_type "Small Business"  vault ["WOSB","EDWOSB"]
 * That firm was being filtered to plain small-business work and never shown the
 * WOSB/EDWOSB pools RESERVED FOR IT. See set-aside-eligibility.ts for the
 * incident this class of bug already caused once (145 matches -> 0 returned).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { eligibleSetAsides as vaultEligible } from '@/lib/vault/certifications';

/** email (lowercased) → normalized vault set-aside codes (NOT SAM codes). */
export type VaultEligibilityMap = Map<string, string[]>;

/**
 * Load + normalize certifications for the given emails.
 *
 * Fails SOFT: on any error this returns an empty map, so callers fall back to
 * business_type-only eligibility — exactly today's behaviour. A Vault read
 * problem must never narrow (or widen) someone's alerts by accident, and must
 * never take the cron down.
 */
export async function loadVaultEligibility(
  supabase: SupabaseClient,
  emails: string[],
): Promise<VaultEligibilityMap> {
  const out: VaultEligibilityMap = new Map();
  const unique = [...new Set(emails.map((e) => (e || '').toLowerCase().trim()).filter(Boolean))];
  if (!unique.length) return out;

  // Chunked: a PostgREST IN() list is a URL, and ~800 emails would blow the
  // length limit. 200 per request keeps it well inside.
  const CHUNK = 200;
  for (let i = 0; i < unique.length; i += CHUNK) {
    const slice = unique.slice(i, i + CHUNK);
    const { data, error } = await supabase
      .from('user_identity_profile')
      .select('user_email, certifications')
      .in('user_email', slice);
    if (error) {
      console.warn('[vault-eligibility] load failed, falling back to business_type only:', error.message);
      return new Map();
    }
    for (const row of data || []) {
      const certs = (row as { certifications?: unknown }).certifications;
      if (!Array.isArray(certs) || !certs.length) continue;
      // Strip 'Full & Open' — it is the universal baseline the query already ORs
      // in, not a lane the crosswalk should translate.
      const codes = vaultEligible(certs).filter((c) => c !== 'Full & Open');
      if (codes.length) {
        out.set(String((row as { user_email: string }).user_email).toLowerCase(), codes);
      }
    }
  }
  return out;
}
