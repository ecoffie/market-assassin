/**
 * R2 — SHADOW comparison of the current gate decision against the canonical policy.
 *
 * NEVER CHANGES A DECISION. The route has already decided (and may already have
 * responded) by the time this runs:
 *   - it is scheduled with `after()`, so it runs once the response is sent and adds no
 *     latency to the request;
 *   - every failure is swallowed; nothing it does can throw into the route;
 *   - it is OFF unless ENTITLEMENT_SHADOW=true (literal 'true', like every repo flag).
 *
 * WHAT IT LOGS (entitlement_shadow_log) — the minimum the disagreement report needs:
 *   route · capability · current allow/deny · canonical allow/deny/unknown ·
 *   source categories · reason · subject_key
 * `subject_key` is a keyed hash, not an email: enough to count DISTINCT accounts per
 * disagreement, never enough to identify one without the server secret.
 */
import { after } from 'next/server';
import { createHmac } from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { canonicalDecision, sourceCategory, type Capability } from './policy';
import { resolveEntitlementSources } from './sources';

export function shadowEnabled(): boolean {
  return (process.env.ENTITLEMENT_SHADOW || '').trim().toLowerCase() === 'true';
}

/** Keyed, truncated hash. null when no server secret exists — then the row is still useful, just not countable. */
export function subjectKey(email: string): string | null {
  const secret = process.env.ENTITLEMENT_SHADOW_SALT || process.env.CRON_SECRET;
  if (!secret || !email) return null;
  return createHmac('sha256', secret).update(email.toLowerCase().trim()).digest('hex').slice(0, 20);
}

export interface ShadowInput {
  route: string;
  capability: Capability;
  /** The VERIFIED email the route authorized against. Never a claimed one. */
  email: string | null | undefined;
  /** What the route actually decided. */
  currentAllow: boolean;
  /** true only when `email` came from a verified session / signed link / key. */
  identityVerified: boolean;
}

export interface ShadowRow {
  route: string;
  capability: Capability;
  current_allow: boolean;
  canonical: 'allow' | 'deny' | 'unknown';
  agrees: boolean | null;
  source_categories: string[];
  reason: string;
  subject_key: string | null;
}

/** Pure-ish core (does the reads, never writes) — exported for tests and the offline report. */
export async function computeShadowRow(input: ShadowInput): Promise<ShadowRow> {
  const email = (input.email || '').toLowerCase().trim();
  const resolved = await resolveEntitlementSources(email, { identityVerified: input.identityVerified });
  const categories = [...new Set(resolved.sources.map(sourceCategory))].sort();
  if (!resolved.complete) {
    return {
      route: input.route, capability: input.capability, current_allow: input.currentAllow,
      canonical: 'unknown', agrees: null, source_categories: categories,
      reason: `resolver_incomplete:${resolved.failures.join(',')}`, subject_key: subjectKey(email),
    };
  }
  const d = canonicalDecision(input.capability, email ? 'LOGGED_IN' : 'LOGGED_OUT', resolved.sources);
  return {
    route: input.route, capability: input.capability, current_allow: input.currentAllow,
    canonical: d.allow ? 'allow' : 'deny', agrees: d.allow === input.currentAllow,
    source_categories: categories, reason: d.reason, subject_key: subjectKey(email),
  };
}

async function writeRow(row: ShadowRow): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return;
  const sb = createClient(url, key, { auth: { persistSession: false } });
  const { error } = await sb.from('entitlement_shadow_log').insert(row);
  if (error) console.error('[entitlement-shadow] insert failed:', error.message);
}

/**
 * Fire-and-forget. Call it right where the route has its decision in hand:
 *   shadowEntitlement({ route: 'app/pricing-intel', capability: 'pricing_intel.view',
 *                       email: identity.email, identityVerified: true, currentAllow: !denied });
 */
export function shadowEntitlement(input: ShadowInput): void {
  if (!shadowEnabled()) return;
  try {
    after(async () => {
      try {
        await writeRow(await computeShadowRow(input));
      } catch (err) {
        console.error('[entitlement-shadow] compare failed:', err instanceof Error ? err.message : err);
      }
    });
  } catch {
    // Outside a request scope (scripts, tests): do nothing rather than run inline.
  }
}
