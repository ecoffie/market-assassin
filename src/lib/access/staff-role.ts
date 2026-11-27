/**
 * Staff role from an email address. Kept dependency-free (no Supabase, no Next) so access helpers
 * can use it without pulling in api-auth. api-auth re-exports everything here unchanged.
 *
 * The role is decided from the email STRING alone: only call it with an email the caller has
 * proved (verifyUserOwnsEmail). See verifyMIAccess in api-auth.ts.
 */
export type MIStaffRole = 'none' | 'staff' | 'admin';

function parseEmailList(value: string | undefined): Set<string> {
  return new Set(
    (value || '')
      .split(',')
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean)
  );
}

// Internal team members with non-govcongiants.com emails.
// Exported so the MCP monthly-credit grant can include the team (they get an ongoing comp
// allowance) — the grant audience can't enumerate the @govcongiants.com domain from KV.
export const INTERNAL_TEAM_EMAILS = new Set([
  'kashif6331@gmail.com',
  'kashifhameedvlogs@gmail.com',
  'evankoffdev@gmail.com',
  'usamashraf2@gmail.com',
  'muneebamehmood07@gmail.com',
  // I lowercase on read but normalize on write too so future copy-paste
  // adds (mixed case from email signatures) match the set.
  'sikandarphulpoto35@gmail.com',
]);

export function getStaffRole(email: string): MIStaffRole {
  const normalizedEmail = email.toLowerCase();
  const domain = normalizedEmail.split('@')[1] || '';
  const configuredStaff = parseEmailList(process.env.MI_STAFF_EMAILS);
  const configuredAdmins = parseEmailList(process.env.MI_ADMIN_EMAILS);

  if (normalizedEmail === 'eric@govcongiants.com' || configuredAdmins.has(normalizedEmail)) {
    return 'admin';
  }

  if (
    domain === 'govcongiants.com'
    || domain === 'govconedu.com'
    || domain === 'getmindy.ai'
    || INTERNAL_TEAM_EMAILS.has(normalizedEmail)
    || configuredStaff.has(normalizedEmail)
  ) {
    return 'staff';
  }

  return 'none';
}

