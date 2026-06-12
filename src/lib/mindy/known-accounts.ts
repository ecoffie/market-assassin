import { createClient } from '@supabase/supabase-js';
import { verifyMIAccess } from '@/lib/api-auth';

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) return null;
  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/**
 * True when this email has real Mindy entitlement — paid/team/pro, staff, any
 * access source flag, or an existing user_notification_settings row (beta cohort).
 */
export async function isKnownMindyAccount(email: string): Promise<boolean> {
  try {
    const access = await verifyMIAccess(email);
    const hasPaidEntitlement =
      access.tier === 'pro' ||
      access.tier === 'team' ||
      access.isStaff === true ||
      Object.values(access.sources || {}).some(Boolean);
    if (hasPaidEntitlement) return true;
  } catch {
    // fall through
  }

  const supabase = getSupabaseAdmin();
  if (!supabase) return false;

  try {
    const { data } = await supabase
      .from('user_notification_settings')
      .select('user_email')
      .eq('user_email', email)
      .maybeSingle();
    return Boolean(data);
  } catch {
    return false;
  }
}

export async function findAuthUserByEmail(email: string): Promise<{ id: string } | null> {
  const supabase = getSupabaseAdmin();
  if (!supabase) return null;

  let page = 1;
  for (;;) {
    const { data: list } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    const users = list?.users || [];
    const match = users.find((u) => (u.email || '').toLowerCase() === email);
    if (match) return { id: match.id };
    if (users.length < 1000) break;
    page += 1;
    if (page > 20) break;
  }
  return null;
}

export async function ensureAuthUserForEmail(email: string): Promise<void> {
  const supabase = getSupabaseAdmin();
  if (!supabase) throw new Error('Supabase service role is not configured');

  const existing = await findAuthUserByEmail(email);
  if (existing) return;

  const randomPassword = `${crypto.randomUUID()}${crypto.randomUUID()}`;
  const { error } = await supabase.auth.admin.createUser({
    email,
    password: randomPassword,
    email_confirm: true,
    user_metadata: { source: 'mindy_magic_link' },
  });

  if (error) {
    throw new Error(error.message);
  }
}
