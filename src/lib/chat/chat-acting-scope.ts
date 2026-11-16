/**
 * Ask Mindy — whose private data is this chat turn acting on?
 *
 * The Vault, pipeline and draft screens answer this with `resolveActiveWorkspace`:
 * a coach (or org admin) who switched into a client workspace sends
 * `x-active-workspace`, and — only when org_clients + org_members authorize it —
 * operates as that client. Chat must give the SAME answer, or a coach looking at a
 * client's workspace gets their own Vault back from Ask Mindy (or, worse, a
 * different rule than the screens use).
 *
 * Rules (mirroring the screens, never widening them):
 *   - No header → the caller's own data. No database call is made, so a normal
 *     user's chat turn is unchanged.
 *   - Header + authorized → the CLIENT's data only: pipeline rows with that
 *     workspace_id, the Vault stored under clientNotificationEmail(workspaceId).
 *     The coach's own pursuits are NOT mixed in (same as pipeline GET).
 *   - Header + not authorized → resolveActiveWorkspace ignores the header and the
 *     caller gets their own data (same as every screen).
 *   - Header + the resolver throws → 'unavailable': private tools refuse honestly
 *     rather than guess whose data to show.
 */
import { resolveActiveWorkspace, clientNotificationEmail } from '@/lib/app/workspace';

type HeaderSource = { headers: { get(name: string): string | null } };

export type ChatActingScope =
  | { kind: 'own'; email: string }
  | { kind: 'client'; email: string; workspaceId: string; vaultEmail: string }
  | { kind: 'unavailable'; email: string };

export async function resolveChatActingScope(
  email: string,
  request: HeaderSource,
  resolve: typeof resolveActiveWorkspace = resolveActiveWorkspace,
): Promise<ChatActingScope> {
  const caller = email.trim().toLowerCase();
  if (!request.headers.get('x-active-workspace')) return { kind: 'own', email: caller };
  try {
    const { workspaceId, asClient } = await resolve(caller, request);
    if (asClient && workspaceId) {
      return { kind: 'client', email: caller, workspaceId, vaultEmail: clientNotificationEmail(workspaceId) };
    }
    return { kind: 'own', email: caller };
  } catch (err) {
    console.error('[chat-acting-scope] workspace resolution failed:', (err as Error)?.message || err);
    return { kind: 'unavailable', email: caller };
  }
}

/** The email whose Vault grounds private reads and drafts in this scope (null = refuse). */
export function vaultEmailFor(scope: ChatActingScope): string | null {
  if (scope.kind === 'client') return scope.vaultEmail;
  if (scope.kind === 'own') return scope.email;
  return null;
}
