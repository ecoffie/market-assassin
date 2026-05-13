import { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createHmac } from 'crypto';
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

function getStaffRole(email: string): MIStaffRole {
  const normalizedEmail = email.toLowerCase();
  const domain = normalizedEmail.split('@')[1] || '';
  const configuredStaff = parseEmailList(process.env.MI_STAFF_EMAILS);
  const configuredAdmins = parseEmailList(process.env.MI_ADMIN_EMAILS);

  if (normalizedEmail === 'eric@govcongiants.com' || configuredAdmins.has(normalizedEmail)) {
    return 'admin';
  }

  if (
    domain === 'govcongiants.com'
    || domain === 'govcongiants.com'
    || configuredStaff.has(normalizedEmail)
  ) {
    return 'staff';
  }

  return 'none';
}

/**
 * Verify Market Intelligence access level.
 * - 'pro': Has any legacy paid GovCon tool or MI/briefings access.
 * - staff/admin is tracked separately from the customer tier.
 * - 'free': Any email (free MI surface)
 * - 'none': No email provided
 */
export async function verifyMIAccess(email: string | null): Promise<MIAuthResult> {
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
  ] = await Promise.all([
    getMarketAssassinAccessResilient(normalizedEmail),
    hasContentGeneratorAccessResilient(normalizedEmail),
    hasOHProAccessResilient(normalizedEmail),
    hasRecompeteAccessResilient(normalizedEmail),
    hasContractorDbAccessResilient(normalizedEmail),
    hasBriefingsAccessResilient(email),
    hasBriefingAccess(normalizedEmail), // Legacy function still has its own fallback
  ]);

  const staffRole = getStaffRole(normalizedEmail);
  const sources: MIAccessSources = {
    marketAssassin: !!marketAssassinAccess,
    marketAssassinPremium: marketAssassinAccess?.tier === 'premium',
    contentReaper: hasContentReaper,
    opportunityHunterPro: hasOpportunityHunterPro,
    recompete: hasRecompete,
    contractorDb: hasContractorDb,
    briefings: hasBriefings || hasLegacyBriefing,
  };

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

    return { authenticated: true, email: user.email.toLowerCase(), method: 'session' };
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
export async function verifyUserOwnsEmail(
  request: NextRequest,
  claimedEmail: string
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

  // Method 3: Check cookie (legacy, weak auth)
  const cookieEmail = request.cookies.get('ma_access_email')?.value?.toLowerCase();
  if (cookieEmail && cookieEmail === normalized) {
    return { authenticated: true, email: normalized, method: 'cookie' };
  }

  return { authenticated: false, email: null, error: 'Unauthorized - please sign in' };
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
