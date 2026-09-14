/**
 * Stable account identity.
 *
 * account_id IS Supabase auth.users.id (also stored as user_profiles.user_id).
 * Email is a mutable attribute used for lookup + delivery — never invent a
 * parallel ID, and never add customer-specific billing-email remaps.
 * See docs/PRD-identity-model.md + docs/engineering/account-id-migration-2026-09-14.md.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/** UUID from auth.users.id / user_profiles.user_id — THE canonical account key. */
export type AccountId = string;

export function normalizeEmail(email: string): string {
  return (email || '').toLowerCase().trim();
}

function getServiceClient(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}

/**
 * Resolve the canonical account_id for an email.
 * Prefers user_profiles.user_id (auth UUID). Also resolves verified
 * account_linked_emails (buy≠login without remaps). Returns null when unknown.
 */
export async function resolveAccountId(
  email: string,
  // Accept service client OR getWriteClient() (compatible PostgREST surface).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any = getServiceClient(),
): Promise<AccountId | null> {
  const e = normalizeEmail(email);
  if (!e || !e.includes('@')) return null;

  const { data, error } = await client
    .from('user_profiles')
    .select('user_id')
    .eq('email', e)
    .maybeSingle();

  if (error) {
    console.error('[identity] resolveAccountId profile lookup failed:', e, error.message);
  } else if (typeof data?.user_id === 'string' && data.user_id.length > 0) {
    return data.user_id as string;
  }

  // Proven linked email → owner's account_id.
  const { data: link, error: linkErr } = await client
    .from('account_linked_emails')
    .select('owner_email')
    .ilike('linked_email', e)
    .not('verified_at', 'is', null)
    .limit(1)
    .maybeSingle();
  if (!linkErr && link?.owner_email) {
    const owner = normalizeEmail(link.owner_email);
    const { data: ownerProfile } = await client
      .from('user_profiles')
      .select('user_id')
      .eq('email', owner)
      .maybeSingle();
    if (typeof ownerProfile?.user_id === 'string' && ownerProfile.user_id) {
      return ownerProfile.user_id as string;
    }
  }

  // Fallback: Auth admin getUserByEmail, then listUsers.
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = client.auth?.admin as any;
    if (admin && typeof admin.getUserByEmail === 'function') {
      const { data: byEmail } = await admin.getUserByEmail(e);
      if (byEmail?.user?.id) return byEmail.user.id as string;
    }
  } catch {
    // fall through
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: listed } = await (client.auth.admin as any).listUsers({ page: 1, perPage: 1000 });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const match = (listed?.users || []).find((u: any) => normalizeEmail(u.email || '') === e);
    return match?.id ?? null;
  } catch (err) {
    console.error('[identity] resolveAccountId auth fallback failed:', e, err);
    return null;
  }
}

export async function requireAccountId(email: string): Promise<AccountId> {
  const id = await resolveAccountId(email);
  if (!id) {
    throw new Error(`No account_id for email ${normalizeEmail(email)}`);
  }
  return id;
}

/** Primary email attribute for an account (user_profiles.email). */
export async function resolvePrimaryEmail(
  accountId: AccountId,
  client: SupabaseClient = getServiceClient(),
): Promise<string | null> {
  const { data, error } = await client
    .from('user_profiles')
    .select('email')
    .eq('user_id', accountId)
    .maybeSingle();
  if (error) {
    console.error('[identity] resolvePrimaryEmail failed:', accountId, error.message);
    return null;
  }
  return data?.email ? normalizeEmail(data.email) : null;
}
