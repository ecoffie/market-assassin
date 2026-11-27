/**
 * Remove a pursuit the verified caller owns — ONE definition shared by DELETE /api/pipeline and the Ask Mindy
 * `remove_from_pursuits` action. Ownership is the active workspace OR the caller's own email (coach mode: the client
 * workspace from resolveActiveWorkspace). Never authenticates: the caller passes an already-verified identity.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

/** PostgREST filter-value quoting: wrap in double quotes, escape backslash and double quote. */
export function pgrstQuote(v: string): string {
  return `"${String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

export type RemovePursuitResult =
  | { kind: 'removed'; row: { id: string; title: string; stage: string | null } }
  | { kind: 'not_found' }
  | { kind: 'error'; message: string };

export async function removeOwnedPursuit(
  db: Pick<SupabaseClient, 'from'>,
  owner: { workspaceId: string; email: string },
  target: { id?: string | null; noticeId?: string | null },
): Promise<RemovePursuitResult> {
  const email = owner.email.toLowerCase();
  // Values are double-quoted (PostgREST reserved-character quoting) so an email containing ',', '.', '(' or ')'
  // cannot alter the filter (Agent 4 review of #2504).
  const ownership = `workspace_id.eq.${pgrstQuote(owner.workspaceId)},user_email.eq.${pgrstQuote(email)}`;
  if (!target.id && !target.noticeId) return { kind: 'not_found' };

  let find = db.from('user_pipeline').select('id,title,stage');
  find = target.id ? find.eq('id', target.id) : find.eq('notice_id', String(target.noticeId));
  const { data: rows, error: findErr } = await find.or(ownership).limit(2);
  if (findErr) return { kind: 'error', message: findErr.message };
  const list = (rows || []) as Array<{ id: string; title: string; stage: string | null }>;
  if (!list.length) return { kind: 'not_found' };
  // A notice id should map to one pursuit (UNIQUE(user_email, notice_id)); if a workspace somehow holds two, refuse
  // rather than guess which to delete.
  if (list.length > 1) return { kind: 'error', message: 'More than one pursuit matches this notice; remove it from My Pursuits.' };
  const row = list[0];

  const { error } = await db.from('user_pipeline').delete().eq('id', row.id).or(ownership);
  if (error) return { kind: 'error', message: error.message };
  return { kind: 'removed', row };
}
