/**
 * Audit log — the "CloudTrail" for Mindy.
 *
 * Records sensitive admin/security actions (grant/revoke access, tier changes,
 * migrations, admin-auth failures) into the `audit_log` table so we can answer
 * "who did what, when" for compliance and forensics — instead of scattered
 * console.log lines that only land in Vercel's ephemeral logs.
 *
 * Best-effort by design: recordAudit() NEVER throws and never blocks the caller.
 * A failure to write the audit row must not break the underlying admin action.
 *
 * Usage:
 *   import { recordAudit } from '@/lib/audit-log';
 *   await recordAudit({
 *     action: 'grant_ma_access',
 *     targetEmail: email,
 *     detail: { tokenPrefix: token.slice(0, 6) },  // never log full secrets
 *     request,
 *   });
 *
 * Requires the `audit_log` table (migrations/20260709_audit_log.sql).
 */
import { createClient, SupabaseClient } from '@supabase/supabase-js';

export interface AuditEntry {
  /** What happened, snake_case verb_noun. e.g. 'grant_ma_access', 'revoke_access'. */
  action: string;
  /** Who performed it. Defaults to 'admin' until per-user admin (P3) lands. */
  actorEmail?: string;
  /** The user the action was performed on, if any. */
  targetEmail?: string;
  /** Table/resource affected, if any. */
  targetTable?: string;
  /** Action-specific payload. NEVER put full tokens/passwords/keys here. */
  detail?: Record<string, unknown>;
  /** Pass the incoming request to auto-capture IP + user-agent. */
  request?: Request;
  /** Explicit overrides (used when there's no request object). */
  actorIp?: string;
  userAgent?: string;
  requestId?: string;
}

let supabase: SupabaseClient | null = null;

function getSupabase(): SupabaseClient {
  if (!supabase) {
    supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
  }
  return supabase;
}

function ipFrom(request?: Request): string | undefined {
  if (!request) return undefined;
  const fwd = request.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim();
  return request.headers.get('x-real-ip') || undefined;
}

function uaFrom(request?: Request): string | undefined {
  return request?.headers.get('user-agent') || undefined;
}

/**
 * Record an audit entry. Non-blocking, never throws.
 * Returns the row id on success, or null if it could not be written.
 */
export async function recordAudit(entry: AuditEntry): Promise<string | null> {
  try {
    const db = getSupabase();

    const { data, error } = await db
      .from('audit_log')
      .insert({
        actor_email: entry.actorEmail?.toLowerCase() || 'admin',
        actor_ip: entry.actorIp ?? ipFrom(entry.request) ?? null,
        action: entry.action,
        target_email: entry.targetEmail?.toLowerCase() || null,
        target_table: entry.targetTable || null,
        detail: entry.detail || {},
        user_agent: entry.userAgent ?? uaFrom(entry.request) ?? null,
        request_id: entry.requestId || null,
      })
      .select('id')
      .single();

    if (error) {
      console.error('[audit] failed to record:', entry.action, error.message);
      return null;
    }
    return data?.id || null;
  } catch (err) {
    console.error('[audit] exception recording:', entry.action, (err as Error).message);
    return null;
  }
}
