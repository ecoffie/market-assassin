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

/** Match the server's normalizeEmail (lib/app/workspace.ts) so comparisons line up. */
export function normalizeEmail(email: string): string {
  return email.toLowerCase().trim();
}

/** Switch into a client workspace, stamping the owner so it can't leak to another login. */
export function setActiveWorkspace(workspaceId: string, ownerEmail: string | null | undefined): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(ACTIVE_KEY, workspaceId);
    if (ownerEmail) localStorage.setItem(OWNER_KEY, normalizeEmail(ownerEmail));
    else localStorage.removeItem(OWNER_KEY);
  } catch { /* localStorage unavailable — non-fatal */ }
}

/** Exit Coach Mode: drop both the active workspace and its owner stamp. */
export function clearActiveWorkspace(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(ACTIVE_KEY);
    localStorage.removeItem(OWNER_KEY);
  } catch { /* */ }
}

/** Raw active workspace id (no ownership check) — for UI that just needs to display it. */
export function getActiveWorkspace(): string | null {
  if (typeof window === 'undefined') return null;
  try { return localStorage.getItem(ACTIVE_KEY); } catch { return null; }
}

/**
 * The active workspace ONLY if it was set by `email`. Returns null otherwise, so
 * the header is never sent for a workspace another login selected.
 */
export function activeWorkspaceFor(email: string | null | undefined): string | null {
  if (typeof window === 'undefined' || !email) return null;
  try {
    const ws = localStorage.getItem(ACTIVE_KEY);
    if (!ws) return null;
    const owner = localStorage.getItem(OWNER_KEY);
    return owner && owner === normalizeEmail(email) ? ws : null;
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
