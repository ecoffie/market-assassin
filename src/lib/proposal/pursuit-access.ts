/**
 * Pursuit access — the one decision for "may this signed-in caller read this pursuit?"
 *
 * A pursuit (user_pipeline row) is readable by its owner, or by a member of the
 * workspace it belongs to (including an authorized coach working inside a client
 * workspace — `resolveActiveWorkspace` already enforces that relationship).
 *
 * Same rule the pursuit-docs and compliance-state routes apply; any route that
 * loads pursuit-scoped data with the service-role key MUST pass through this
 * first, because the service-role key bypasses RLS.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveActiveWorkspace } from '@/lib/app/workspace';

type HeaderSource = { headers: { get(name: string): string | null } };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isPipelineId(value: string): boolean {
  return UUID_RE.test(value);
}

export async function canAccessPursuit(
  row: { user_email?: string | null; workspace_id?: string | null },
  email: string,
  request: HeaderSource,
  resolveWorkspace: typeof resolveActiveWorkspace = resolveActiveWorkspace,
): Promise<boolean> {
  const caller = email.trim().toLowerCase();
  if (!caller) return false;
  if (row.user_email && row.user_email.trim().toLowerCase() === caller) return true;
  if (row.workspace_id) {
    try {
      const { workspaceId } = await resolveWorkspace(caller, request);
      if (workspaceId && row.workspace_id === workspaceId) return true;
    } catch {
      /* deny */
    }
  }
  return false;
}

/**
 * Load the pursuit and decide access. A pursuit that does not exist and one the
 * caller may not read return the SAME result, so the answer cannot be used to
 * probe which pursuit ids exist.
 */
export async function authorizePursuitRead(
  sb: SupabaseClient,
  request: HeaderSource,
  email: string,
  pipelineId: string,
  resolveWorkspace: typeof resolveActiveWorkspace = resolveActiveWorkspace,
): Promise<{ ok: true } | { ok: false; reason: 'not_found' | 'error' }> {
  if (!isPipelineId(pipelineId)) return { ok: false, reason: 'not_found' };
  const { data, error } = await sb
    .from('user_pipeline')
    .select('id, user_email, workspace_id')
    .eq('id', pipelineId)
    .maybeSingle();
  if (error) {
    console.error('[pursuit-access] pursuit query error:', error.message);
    return { ok: false, reason: 'error' };
  }
  if (!data) return { ok: false, reason: 'not_found' };
  if (!(await canAccessPursuit(data, email, request, resolveWorkspace))) return { ok: false, reason: 'not_found' };
  return { ok: true };
}
