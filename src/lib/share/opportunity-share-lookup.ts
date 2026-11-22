/**
 * Existence check for a legacy briefings share link (`opportunity_shares`,
 * public page /shared/opp/<shareId>).
 *
 * Three outcomes, on purpose:
 *  - 'found'   — the row exists.
 *  - 'missing' — the query succeeded and there is no row: a real dead link.
 *                The page answers HTTP 404 (no soft 404 for crawlers).
 *  - 'unknown' — the lookup failed (query error, throw, no env). Unknown is
 *                never "not found": the caller must NOT 404 on it, or a
 *                transient DB blip would tell crawlers a live link is dead.
 */
import { createClient } from '@supabase/supabase-js';

export type ShareLookup = 'found' | 'missing' | 'unknown';

/** Minimal slice of the Supabase client this check needs (keeps it testable). */
export interface ShareLookupClient {
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: string): {
        maybeSingle(): PromiseLike<{ data: unknown; error: unknown }>;
      };
    };
  };
}

export function classifyShareLookup(result: { data: unknown; error: unknown }): ShareLookup {
  if (result.error) return 'unknown';
  return result.data ? 'found' : 'missing';
}

function defaultClient(): ShareLookupClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key) as unknown as ShareLookupClient;
}

/**
 * Read-only: does NOT increment view_count (the GET API does that when the
 * client renders the page).
 */
export async function lookupOpportunityShare(
  shareId: string,
  client: ShareLookupClient | null = defaultClient(),
): Promise<ShareLookup> {
  if (!shareId) return 'missing';
  if (!client) return 'unknown';
  try {
    const result = await client
      .from('opportunity_shares')
      .select('share_id')
      .eq('share_id', shareId)
      .maybeSingle();
    return classifyShareLookup(result);
  } catch {
    return 'unknown';
  }
}
