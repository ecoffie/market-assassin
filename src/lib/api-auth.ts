import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createHmac } from 'crypto';
import { observeVerifyResult } from '@/lib/auth-observability';
import {
  getMarketAssassinAccessResilient,
  hasBriefingsAccessResilient,
  hasContentGeneratorAccessResilient,
  hasContractorDbAccessResilient,
  hasOHProAccessResilient,
  hasRecompeteAccessResilient,
} from '@/lib/kv-resilience';

// Legacy imports for backward compatibility (now with try-catch fallback)
import { hasBriefingAccess } from '@/lib/access-codes';

// Lazy Supabase client for auth verification
let _supabaseAuth: ReturnType<typeof createClient> | null = null;
function getSupabaseAuth() {
  if (!_supabaseAuth) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) return null;
    _supabaseAuth = createClient(url, key, { auth: { persistSession: false } });
  }
  return _supabaseAuth;
}

export interface AuthResult {
  authenticated: boolean;
  email: string | null;
  error?: string;
  method?: 'session' | 'token' | 'cookie';
  // Populated only on the Supabase-session path (verifyUserSession). Lets a route
  // tell an OAuth login (provider = 'google'|'azure'|'apple') from a password one
  // (provider = 'email'), and read the assurance level. Used by the paid-MFA gate:
  // an OAuth session already satisfied MFA upstream at Google/Microsoft.
  provider?: string | null;   // app_metadata.provider
  aal?: string | null;        // 'aal1' | 'aal2' from the session JWT, if present
  // auth.users.created_at — when the account was created. Session path only. Lets the
  // share-attribution claim tell a brand-new account from an existing one signing in.
  createdAt?: string | null;
}

export type MIAccessTier = 'free' | 'pro' | 'team' | 'enterprise' | 'none';
export type MIStaffRole = 'none' | 'staff' | 'admin';

export interface MIAccessSources {
  marketAssassin: boolean;
  marketAssassinPremium: boolean;
  contentReaper: boolean;
  opportunityHunterPro: boolean;
  recompete: boolean;
  contractorDb: boolean;
  briefings: boolean;
}

export interface MIAuthResult {
  tier: MIAccessTier;
  email: string | null;
  isStaff?: boolean;
  staffRole?: MIStaffRole;
  sources?: MIAccessSources;
  error?: string;
}

/**
 * Extract user email from cookie or request body.
 * Checks `ma_access_email` cookie first, then `userEmail` in body.
 */
export function getEmailFromRequest(
  request: NextRequest,
  body?: Record<string, unknown>
): string | null {
  // Check cookie first
  const cookieEmail = request.cookies.get('ma_access_email')?.value;
  if (cookieEmail) return cookieEmail.toLowerCase();

  // Fall back to request body
  const bodyEmail = body?.userEmail as string | undefined;
  if (bodyEmail) return bodyEmail.toLowerCase();

  return null;
}

/**
 * Verify that an email has Market Assassin access via resilient KV layer.
 * Uses: Local Cache → KV (with circuit breaker) → Supabase fallback
 */
export async function verifyMAAccess(email: string | null): Promise<AuthResult> {
  if (!email) {
    return { authenticated: false, email: null, error: 'Email required for access verification' };
  }

  const hasAccess = !!(await getMarketAssassinAccessResilient(email));
  if (!hasAccess) {
    return { authenticated: false, email, error: 'No Market Assassin access found for this email' };
  }

  return { authenticated: true, email };
}

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

/**
 * Prototype / case-study demo surfaces (Vehicle Expiry Watch, SMB Market Research,
 * Market Research Report) are gated behind an EXPLICIT allowlist — NOT the broad
 * staff flag. This keeps company accounts (govcongiants.com / getmindy.ai) and demo
 * accounts on the clean Pro-member view by default. Add an email to
 * MINDY_PROTOTYPE_EMAILS (comma-separated) only when you want those tabs visible for it.
 */
export function canSeePrototypeSurfaces(email: string): boolean {
  const normalizedEmail = (email || '').toLowerCase().trim();
  if (!normalizedEmail) return false;
  return parseEmailList(process.env.MINDY_PROTOTYPE_EMAILS).has(normalizedEmail);
}

/**
 * Verify Market Intelligence access level.
 * - 'pro': Has any legacy paid GovCon tool or MI/briefings access.
 * - staff/admin is tracked separately from the customer tier.
 * - 'free': Any email (free MI surface)
 * - 'none': No email provided
 */
export async function verifyMIAccess(
  email: string | null,
  /**
   * Set ONLY when the caller has proved the user owns this email (a verified session or a
   * signed token — see verifyUserOwnsEmail). Defaults to false so every existing caller is
   * safe-by-default: an unproven email can still earn Pro through real entitlements, but can
   * never earn STAFF through its domain.
   */
  identityVerified = false,
): Promise<MIAuthResult> {
  if (!email) {
    return { tier: 'none', email: null, error: 'Email required for access' };
  }

  const normalizedEmail = email.toLowerCase();

  // Use resilient functions with LRU cache + circuit breaker + Supabase fallback
  const [
    marketAssassinAccess,
    hasContentReaper,
    hasOpportunityHunterPro,
    hasRecompete,
    hasContractorDb,
    hasBriefings,
    hasLegacyBriefing,
    hasTeam,
  ] = await Promise.all([
    getMarketAssassinAccessResilient(normalizedEmail),
    hasContentGeneratorAccessResilient(normalizedEmail),
    hasOHProAccessResilient(normalizedEmail),
    hasRecompeteAccessResilient(normalizedEmail),
    hasContractorDbAccessResilient(normalizedEmail),
    hasBriefingsAccessResilient(email),
    hasBriefingAccess(normalizedEmail), // Legacy function still has its own fallback
    // Mindy Team — direct Supabase check against user_profiles.access_team.
    // Returns false on connection failure (graceful degrade — they'd just
    // see Pro features which Team includes anyway).
    hasMindyTeamAccess(normalizedEmail),
  ]);

  // STAFF PRIVILEGE REQUIRES PROOF OF IDENTITY.
  //
  // getStaffRole() decides from the email STRING alone — anything @govcongiants.com,
  // @govconedu.com or @getmindy.ai is 'staff', and every Pro gate reads
  // `if (tier === 'free' && !isStaff)`. Callers that pass a client-supplied ?email= were
  // therefore handing out Pro data to anyone who typed a domain we own.
  //
  // VERIFIED LIVE 2026-08-23 before this fix:
  //   /api/app/pricing-intel?naics=541512&email=nonexistent-probe@getmindy.ai  -> 200 + real
  //   labor-rate intel (136 records, medians, percentiles). That address does not exist in
  //   user_profiles. /api/app/market-dossier was reachable the same way.
  //
  // The email is now trusted for staff ONLY when the caller proved they own it. Paid access
  // is unchanged — the `sources` union below still decides Pro/Team from real entitlements,
  // so no paying customer loses anything. Callers that cannot prove identity simply do not
  // get the staff bypass.
  const staffRole = identityVerified ? getStaffRole(normalizedEmail) : 'none';
  const sources: MIAccessSources = {
    marketAssassin: !!marketAssassinAccess,
    marketAssassinPremium: marketAssassinAccess?.tier === 'premium',
    contentReaper: hasContentReaper,
    opportunityHunterPro: hasOpportunityHunterPro,
    recompete: hasRecompete,
    contractorDb: hasContractorDb,
    briefings: hasBriefings || hasLegacyBriefing,
  };

  // Team gate first — Team is a superset of Pro, so checking it
  // before the Pro union avoids the user getting downgraded to
  // 'pro' display when they actually paid for Team.
  if (hasTeam) {
    return {
      tier: 'team',
      email: normalizedEmail,
      isStaff: staffRole !== 'none',
      staffRole,
      sources,
    };
  }

  const hasUnifiedProAccess = Object.values(sources).some(Boolean) || staffRole !== 'none';

  if (hasUnifiedProAccess) {
    return {
      tier: 'pro',
      email: normalizedEmail,
      isStaff: staffRole !== 'none',
      staffRole,
      sources,
    };
  }

  // Free tier for any email
  return {
    tier: 'free',
    email: normalizedEmail,
    isStaff: staffRole !== 'none',
    staffRole,
    sources,
  };
}

/**
 * Direct check against user_profiles.access_team for Mindy Team
 * subscribers. Used by verifyMIAccess() to upgrade the dashboard
 * tier label from 'pro' to 'team' for Team buyers.
 *
 * Returns false on any Supabase failure — graceful degrade means
 * the user falls through to 'pro' (which Team includes), losing
 * only the Team-specific UI labels until the next request.
 */
async function hasMindyTeamAccess(email: string): Promise<boolean> {
  const supabase = getSupabaseAuth();
  if (!supabase) return false;
  try {
    const { data } = await supabase
      .from('user_profiles')
      .select('access_team')
      .eq('email', email)
      .maybeSingle();
    return !!(data as { access_team?: boolean } | null)?.access_team;
  } catch {
    return false;
  }
}

// ========================================================================
// USER IDENTITY VERIFICATION
// These functions verify the REQUESTER owns the claimed email address.
// Use these for routes that read/write user-specific data.
// ========================================================================

/**
 * Verify user identity via Supabase Auth session.
 *
 * The client must include the Authorization header with a valid access token:
 * Authorization: Bearer <supabase_access_token>
 *
 * Usage:
 * ```ts
 * const auth = await verifyUserSession(request);
 * if (!auth.authenticated) {
 *   return NextResponse.json({ error: auth.error }, { status: 401 });
 * }
 * // auth.email is the VERIFIED user email
 * ```
 */
export async function verifyUserSession(request: NextRequest): Promise<AuthResult> {
  const authHeader = request.headers.get('authorization');

  if (!authHeader?.startsWith('Bearer ')) {
    return { authenticated: false, email: null, error: 'Missing or invalid authorization header' };
  }

  const token = authHeader.substring(7); // Remove 'Bearer '
  const supabase = getSupabaseAuth();

  if (!supabase) {
    return { authenticated: false, email: null, error: 'Auth service unavailable' };
  }

  try {
    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error || !user?.email) {
      return { authenticated: false, email: null, error: 'Invalid or expired session' };
    }

    // Surface provider + AAL so the paid-MFA gate can distinguish an OAuth login
    // (MFA already done upstream by Google/Microsoft) from a password login.
    // app_metadata.provider is the primary provider; identities[] would hold all.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const provider = ((user as any).app_metadata?.provider as string | undefined) ?? null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const aal = ((user as any).aal as string | undefined) ?? null;

    const createdAt = (user as { created_at?: string }).created_at ?? null;

    return { authenticated: true, email: user.email.toLowerCase(), method: 'session', provider, aal, createdAt };
  } catch {
    return { authenticated: false, email: null, error: 'Auth verification failed' };
  }
}

/**
 * Verify email from a signed token (for email action links).
 * Tokens are HMAC-signed with a secret and have a TTL.
 *
 * Usage in email links:
 * /api/actions/add-to-pipeline?email=user@example.com&token=xxx&ts=1234567890
 */
export function verifyEmailToken(
  email: string,
  token: string,
  timestamp: string | number,
  maxAgeSeconds = 86400 // 24 hours default
): AuthResult {
  const secret = process.env.EMAIL_ACTION_SECRET || process.env.ADMIN_PASSWORD;

  if (!secret) {
    console.error('[API Auth] EMAIL_ACTION_SECRET not configured');
    return { authenticated: false, email: null, error: 'Auth not configured' };
  }

  const ts = typeof timestamp === 'string' ? parseInt(timestamp, 10) : timestamp;
  const now = Math.floor(Date.now() / 1000);

  // Check timestamp isn't too old
  if (now - ts > maxAgeSeconds) {
    return { authenticated: false, email: null, error: 'Link expired' };
  }

  // Verify HMAC signature
  const expectedToken = createHmac('sha256', secret)
    .update(`${email.toLowerCase()}:${ts}`)
    .digest('hex')
    .substring(0, 32);

  if (token !== expectedToken) {
    return { authenticated: false, email: null, error: 'Invalid token' };
  }

  return { authenticated: true, email: email.toLowerCase(), method: 'token' };
}

/**
 * Generate a signed email action token for use in email links.
 */
export function generateEmailToken(email: string): { token: string; ts: number } {
  const secret = process.env.EMAIL_ACTION_SECRET || process.env.ADMIN_PASSWORD;

  if (!secret) {
    throw new Error('EMAIL_ACTION_SECRET not configured');
  }

  const ts = Math.floor(Date.now() / 1000);
  const token = createHmac('sha256', secret)
    .update(`${email.toLowerCase()}:${ts}`)
    .digest('hex')
    .substring(0, 32);

  return { token, ts };
}

/**
 * Verify user owns the claimed email address.
 * Tries multiple auth methods:
 * 1. Supabase session (from Authorization header)
 * 2. Signed email token (from URL params - for email action links)
 * 3. ma_access_email cookie (legacy, treat as weak auth)
 *
 * The claimedEmail MUST match the authenticated email.
 */
export interface VerifyOptions {
  /**
   * When true, ONLY cryptographically-strong methods are accepted: Supabase
   * session, signed email token, or the Mindy 2FA session token. The legacy
   * plaintext `ma_access_email` cookie and the token-less staff-domain bypass
   * are REFUSED. Use this for the highest-sensitivity data (the vault), where a
   * spoofable cookie or an unauthenticated staff-email claim is not acceptable
   * (Data Trust Phase 1.4). Default false = existing behavior for all other
   * routes, unchanged.
   */
  requireStrongAuth?: boolean;
}

/**
 * R0 observability wrapper (tasks/mindy-entitlement-audit-2026-09-26.md §14).
 *
 * Returns EXACTLY what verifyUserOwnsEmailCore returns — the same object, not a
 * copy. It only records which method authenticated (fire-and-forget, after the
 * response; see src/lib/auth-observability.ts). The core body below is pinned
 * byte-for-byte to its pre-R0 text by auth-observability.unit.test.ts.
 */
export async function verifyUserOwnsEmail(
  request: NextRequest,
  claimedEmail: string,
  options: VerifyOptions = {}
): Promise<AuthResult> {
  const result = await verifyUserOwnsEmailCore(request, claimedEmail, options);
  observeVerifyResult(request, claimedEmail, result as AuthResult & Record<string, unknown>);
  return result;
}

async function verifyUserOwnsEmailCore(
  request: NextRequest,
  claimedEmail: string,
  options: VerifyOptions = {}
): Promise<AuthResult> {
  const normalized = claimedEmail?.toLowerCase();

  if (!normalized) {
    return { authenticated: false, email: null, error: 'Email required' };
  }

  // Method 1: Check Supabase session (strongest)
  const sessionAuth = await verifyUserSession(request);
  if (sessionAuth.authenticated) {
    if (sessionAuth.email !== normalized) {
      return { authenticated: false, email: null, error: 'Email mismatch with session' };
    }
    return sessionAuth;
  }

  // Method 2: Check signed token (for email action links)
  const params = request.nextUrl.searchParams;
  const token = params.get('token');
  const ts = params.get('ts');

  if (token && ts) {
    const tokenAuth = verifyEmailToken(normalized, token, ts);
    if (tokenAuth.authenticated) {
      return tokenAuth;
    }
  }

  // Method 2.5: Check the Mindy 2FA session token (set by /app sign-in flow).
  // This lets OAuth users on getmindy.ai authenticate any route that's still
  // on cookie-auth — without it, the Market Research panel (and similar
  // /app components) get 401s on /api/alerts/preferences and the user
  // sees an empty saved profile even though the DB has their data.
  const miAuthHeader =
    request.headers.get('x-mi-auth-token') ||
    request.headers.get('x-mi-2fa-token');
  if (miAuthHeader) {
    try {
      // Lazy import to avoid a hard dep cycle with two-factor-session,
      // which imports from this file's siblings.
      const { verifyTwoFactorSessionToken } = await import('@/lib/two-factor-session');
      const tfaResult = verifyTwoFactorSessionToken(miAuthHeader, normalized);
      if (tfaResult.valid) {
        return { authenticated: true, email: normalized, method: 'session' };
      }
    } catch {
      // fall through to remaining methods
    }
  }

  // R1 (tasks/mindy-entitlement-audit-2026-09-26.md §12 E1, locked ruling):
  // the two former WEAK methods are REMOVED from authorization —
  //   Method 3: a plaintext `ma_access_email` cookie equal to the claimed email
  //             (user-settable: anyone can set a cookie to anyone's address), and
  //   Method 4: any claimed staff-domain email, with no proof at all.
  // Only a Supabase session, a signed email-action link or the Mindy MI session
  // identify a user. `requireStrongAuth` is therefore the default for every caller;
  // the option is kept so existing call sites compile unchanged.
  if (options.requireStrongAuth) {
    return {
      authenticated: false,
      email: null,
      error: 'Strong authentication required — please sign in',
    };
  }

  return { authenticated: false, email: null, error: 'Unauthorized - please sign in' };
}

/**
 * R1 — the identity a request can PROVE, independent of any email it claims.
 *
 * Accepts only the strong methods (tasks/mindy-entitlement-audit-2026-09-26.md §13):
 *   - the Mindy MI session token (x-mi-auth-token / x-mi-2fa-token / MI Bearer)
 *   - a Supabase session (Authorization: Bearer <jwt>)
 *   - a signed email-action link (?token=&ts=) — only for the claimed email it signs
 * Never a cookie, never a claimed staff address, never a body/query email on its own.
 */
export interface VerifiedIdentity {
  email: string;
  method: 'session' | 'token';
}

export async function getVerifiedIdentity(
  request: NextRequest,
  claimedEmail?: string | null
): Promise<VerifiedIdentity | null> {
  try {
    const { getTwoFactorTokenFromRequest, verifyTwoFactorSessionToken } = await import('@/lib/two-factor-session');
    const miToken = getTwoFactorTokenFromRequest(request);
    if (miToken) {
      const r = verifyTwoFactorSessionToken(miToken);
      if (r.valid && r.email) return { email: r.email.toLowerCase(), method: 'session' };
    }
  } catch {
    // fall through
  }

  const auth = request.headers.get('authorization');
  if (auth?.startsWith('Bearer ')) {
    const session = await verifyUserSession(request);
    if (session.authenticated && session.email) return { email: session.email, method: 'session' };
  }

  const claimed = claimedEmail?.toLowerCase().trim();
  const token = request.nextUrl.searchParams.get('token');
  const ts = request.nextUrl.searchParams.get('ts');
  if (claimed && token && ts) {
    const link = verifyEmailToken(claimed, token, ts);
    if (link.authenticated && link.email) return { email: link.email, method: 'token' };
  }
  return null;
}

/**
 * R1 — reconcile a claimed email with the proven identity.
 *   verified   : the request proved an identity and the claim (if any) matches it.
 *                Use `email` — the VERIFIED address — for every downstream read/write.
 *   anonymous  : no proven identity. Callers answer 401, or serve the Free result.
 *   mismatch   : proven identity for a DIFFERENT address than claimed. Always 401.
 */
export type ClaimedIdentity =
  | { status: 'verified'; email: string; method: VerifiedIdentity['method'] }
  | { status: 'anonymous' }
  | { status: 'mismatch'; verifiedEmail: string };

export async function verifyClaimedIdentity(
  request: NextRequest,
  claimedEmail?: string | null
): Promise<ClaimedIdentity> {
  const claimed = claimedEmail?.toLowerCase().trim() || null;
  const identity = await getVerifiedIdentity(request, claimed);
  if (!identity) return { status: 'anonymous' };
  if (claimed && claimed !== identity.email) return { status: 'mismatch', verifiedEmail: identity.email };
  return { status: 'verified', email: identity.email, method: identity.method };
}

/** R1: the standard 401 for an anonymous or mismatched identity on a gated route. */
export function identityFailureResponse(identity: Exclude<ClaimedIdentity, { status: 'verified' }>) {
  return NextResponse.json(
    identity.status === 'mismatch'
      ? { error: 'Email mismatch with session', auth_required: true }
      : { error: 'Sign in required', auth_required: true },
    { status: 401 }
  );
}

/**
 * Require authenticated user for API route.
 * Extracts email from request and verifies ownership.
 *
 * Usage:
 * ```ts
 * const auth = await requireUserAuth(request);
 * if (!auth.authenticated) {
 *   return NextResponse.json({ error: auth.error }, { status: 401 });
 * }
 * // Use auth.email for database queries
 * ```
 */
export async function requireUserAuth(request: NextRequest): Promise<AuthResult> {
  let claimedEmail: string | null = null;

  // Try query param first
  claimedEmail = request.nextUrl.searchParams.get('email');

  // Try body if POST/PATCH/PUT/DELETE
  if (!claimedEmail && ['POST', 'PATCH', 'PUT', 'DELETE'].includes(request.method)) {
    try {
      const body = await request.clone().json();
      claimedEmail = body.email || body.user_email;
    } catch {
      // Not JSON body, that's okay
    }
  }

  if (!claimedEmail) {
    return { authenticated: false, email: null, error: 'Email required' };
  }

  return verifyUserOwnsEmail(request, claimedEmail);
}
