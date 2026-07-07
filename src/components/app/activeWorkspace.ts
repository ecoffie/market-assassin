/**
 * Coach Mode active-workspace state (browser-local).
 *
 * The active-workspace key drives the `x-active-workspace` header on every
 * workspace-scoped request (see authHeaders.ts), so it must NEVER outlive the
 * user who set it. We stamp the owner email alongside the key and:
 *   - only attach the header when the owner matches the logged-in user
 *     (activeWorkspaceFor), and
 *   - auto-clear the key on login when it was set by a different user
 *     (reconcileActiveWorkspace).
 *
 * This is the single source of truth for these keys — all set/clear/read goes
 * through here so the owner stamp can't drift out of sync.
 */
export const ACTIVE_KEY = 'mindy_active_workspace';
export const OWNER_KEY = 'mindy_active_workspace_owner';
export const NAME_KEY = 'mindy_active_workspace_name';

/** Match the server's normalizeEmail (lib/app/workspace.ts) so comparisons line up. */
export function normalizeEmail(email: string): string {
  return email.toLowerCase().trim();
}

/** Switch into a client workspace, stamping the owner so it can't leak to another
 *  login. Optionally stash the client's display name so UI copy (empty states,
 *  CTAs) can name the client synchronously without an extra coach-API fetch. */
export function setActiveWorkspace(
  workspaceId: string,
  ownerEmail: string | null | undefined,
  clientName?: string | null,
): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(ACTIVE_KEY, workspaceId);
    if (ownerEmail) localStorage.setItem(OWNER_KEY, normalizeEmail(ownerEmail));
    else localStorage.removeItem(OWNER_KEY);
    if (clientName) localStorage.setItem(NAME_KEY, clientName);
    else localStorage.removeItem(NAME_KEY);
  } catch { /* localStorage unavailable — non-fatal */ }
}

/** Exit Coach Mode: drop the active workspace, its owner stamp, and client name. */
export function clearActiveWorkspace(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(ACTIVE_KEY);
    localStorage.removeItem(OWNER_KEY);
    localStorage.removeItem(NAME_KEY);
  } catch { /* */ }
}

/** Raw active workspace id (no ownership check) — for UI that just needs to display it. */
export function getActiveWorkspace(): string | null {
  if (typeof window === 'undefined') return null;
  try { return localStorage.getItem(ACTIVE_KEY); } catch { return null; }
}

/** The active client's display name, if one was stashed on switch (else null). */
export function getActiveWorkspaceName(): string | null {
  if (typeof window === 'undefined') return null;
  try { return localStorage.getItem(NAME_KEY); } catch { return null; }
}

/**
 * The active workspace for `email`, used to attach the `x-active-workspace`
 * header. Returns the key UNLESS it was demonstrably set by a DIFFERENT login
 * (owner stamp present AND mismatched) — in which case we withhold it so one
 * login never operates as another's client.
 *
 * Note: a missing owner stamp (legacy key from before stamping existed) or a
 * missing `email` at call time does NOT withhold the key. The server is the real
 * authority — resolveActiveWorkspace() re-verifies org_clients + org_members and
 * ignores any header the caller isn't authorized for. Over-withholding here was
 * silently dropping the header for legitimate coaches, so client-mode SAVES
 * landed on the coach's own profile and looked like "my data vanished"
 * (Eric, Jun 23 2026). reconcileActiveWorkspace() still clears foreign keys on
 * login, so a stale cross-login key is gone before this is read.
 */
export function activeWorkspaceFor(email: string | null | undefined): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const ws = localStorage.getItem(ACTIVE_KEY);
    if (!ws) return null;
    const owner = localStorage.getItem(OWNER_KEY);
    // Withhold ONLY on a definite different-owner mismatch. No stamp or no email
    // → trust the key (server re-verifies authorization regardless).
    if (owner && email && owner !== normalizeEmail(email)) return null;
    return ws;
  } catch { return null; }
}

/**
 * Call once on login/app-load. If an active workspace exists but was set by a
 * different user (or has no owner stamp — i.e. a legacy/pre-safeguard key),
 * clear it so the new login starts in their own workspace. Returns true if it
 * cleared something.
 */
export function reconcileActiveWorkspace(email: string | null | undefined): boolean {
  if (typeof window === 'undefined' || !email) return false;
  try {
    const ws = localStorage.getItem(ACTIVE_KEY);
    if (!ws) return false;
    const owner = localStorage.getItem(OWNER_KEY);
    if (!owner || owner !== normalizeEmail(email)) {
      clearActiveWorkspace();
      return true;
    }
  } catch { /* */ }
  return false;
}
