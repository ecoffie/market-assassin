/**
 * Alert delivery email — where opportunity alerts go, separate from login identity.
 *
 * Cassy-class tickets: user wants alerts at work@… without changing login or moving
 * credits. Verified pool = account_linked_emails (OTP-proven). Selected destination =
 * user_notification_settings.alert_recipient_email. Watches (saved_searches) stay keyed
 * on the login email; only the send `to:` changes.
 *
 * Coach Mode writes client inboxes without linked-email proof (synthetic row email) —
 * callers pass `skipOwnershipProof` for that path only.
 */
import { createClient } from '@supabase/supabase-js';
import { normalizeEmail } from '@/lib/mindy/linked-emails';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _sb: any = null;
function db() {
  if (!_sb) {
    _sb = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } },
    );
  }
  return _sb;
}

export type AlertDeliverySettings = {
  alert_recipient_email?: string | null;
};

/** Resolve the inbox to send opportunity alerts to. Never invents an address. */
export function resolveAlertDeliveryEmail(
  ownerEmail: string,
  settings: AlertDeliverySettings | null | undefined,
): string {
  const owner = normalizeEmail(ownerEmail);
  const recipient = normalizeEmail(settings?.alert_recipient_email || '');
  return recipient || owner;
}

export type SelectableDeliveryReason =
  | 'empty'
  | 'account'
  | 'verified_linked'
  | 'unverified'
  | 'foreign'
  | 'error';

export type AssertSelectableResult =
  | { ok: true; reason: 'account' | 'verified_linked' }
  | { ok: false; reason: Exclude<SelectableDeliveryReason, 'account' | 'verified_linked'>; error?: string };

/**
 * Self-serve may only select the account email or a verified linked address for that owner.
 * Empty / null clears delivery back to the account email (caller writes null).
 */
export async function assertSelectableDeliveryEmail(
  ownerEmail: string,
  candidate: string | null | undefined,
): Promise<AssertSelectableResult> {
  const owner = normalizeEmail(ownerEmail);
  const target = normalizeEmail(candidate || '');
  if (!owner) return { ok: false, reason: 'error', error: 'owner email required' };
  if (!target) return { ok: false, reason: 'empty' };
  if (target === owner) return { ok: true, reason: 'account' };

  try {
    const { data, error } = await db()
      .from('account_linked_emails')
      .select('linked_email, verified_at')
      .ilike('owner_email', owner)
      .ilike('linked_email', target)
      .maybeSingle();
    if (error) {
      if (error.code === '42P01' || error.code === 'PGRST205') {
        return { ok: false, reason: 'error', error: 'account_linked_emails table missing' };
      }
      return { ok: false, reason: 'error', error: error.message };
    }
    if (!data) return { ok: false, reason: 'foreign' };
    if (!data.verified_at) return { ok: false, reason: 'unverified' };
    return { ok: true, reason: 'verified_linked' };
  } catch (e) {
    return { ok: false, reason: 'error', error: (e as Error).message };
  }
}

export type LinkedDeliveryRow = {
  email: string;
  verified_at: string | null;
};

/** Verified + pending links for the account (MCP list / Settings). */
export async function listDeliveryEmailCandidates(ownerEmail: string): Promise<{
  account_email: string;
  linked: LinkedDeliveryRow[];
  pending: LinkedDeliveryRow[];
}> {
  const owner = normalizeEmail(ownerEmail);
  if (!owner) return { account_email: '', linked: [], pending: [] };

  const { data, error } = await db()
    .from('account_linked_emails')
    .select('linked_email, verified_at')
    .ilike('owner_email', owner);
  if (error) {
    console.error('[alert-delivery] list candidates:', error.message);
    return { account_email: owner, linked: [], pending: [] };
  }

  const linked: LinkedDeliveryRow[] = [];
  const pending: LinkedDeliveryRow[] = [];
  for (const row of data || []) {
    const email = normalizeEmail(row.linked_email);
    if (!email || email === owner) continue;
    const entry = { email, verified_at: row.verified_at || null };
    if (row.verified_at) linked.push(entry);
    else pending.push(entry);
  }
  return { account_email: owner, linked, pending };
}

export type AlertDestinationKind = 'account_email' | 'delivery_email';

export function alertDestinationKind(
  ownerEmail: string,
  settings: AlertDeliverySettings | null | undefined,
): AlertDestinationKind {
  const resolved = resolveAlertDeliveryEmail(ownerEmail, settings);
  return resolved === normalizeEmail(ownerEmail) ? 'account_email' : 'delivery_email';
}

/** Load selected delivery for one owner (cron / MCP). */
export async function getAlertDeliverySettings(ownerEmail: string): Promise<AlertDeliverySettings | null> {
  const owner = normalizeEmail(ownerEmail);
  if (!owner) return null;
  const { data, error } = await db()
    .from('user_notification_settings')
    .select('alert_recipient_email')
    .eq('user_email', owner)
    .maybeSingle();
  if (error) {
    console.error('[alert-delivery] settings read:', error.message);
    return null;
  }
  return data;
}

/** Persist selected delivery (null = account email). Caller must have already asserted. */
export async function setAlertDeliveryEmail(
  ownerEmail: string,
  deliveryEmail: string | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const owner = normalizeEmail(ownerEmail);
  if (!owner) return { ok: false, error: 'owner email required' };
  const recipient = deliveryEmail ? normalizeEmail(deliveryEmail) : null;
  // Writing the account email is equivalent to clear — store null so cron fallback is clean.
  const value = recipient && recipient !== owner ? recipient : null;

  const { data: existing, error: readErr } = await db()
    .from('user_notification_settings')
    .select('user_email')
    .eq('user_email', owner)
    .maybeSingle();
  if (readErr) return { ok: false, error: readErr.message };

  if (existing) {
    const { error } = await db()
      .from('user_notification_settings')
      .update({ alert_recipient_email: value, updated_at: new Date().toISOString() })
      .eq('user_email', owner);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  }

  const { error } = await db().from('user_notification_settings').insert({
    user_email: owner,
    alert_recipient_email: value,
    updated_at: new Date().toISOString(),
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** Batch-load delivery overrides for cron (owner → recipient or null). */
export async function loadAlertDeliveryMap(
  ownerEmails: string[],
): Promise<Map<string, string | null>> {
  const map = new Map<string, string | null>();
  const owners = [...new Set(ownerEmails.map(normalizeEmail).filter(Boolean))];
  if (owners.length === 0) return map;

  // PostgREST .in() is fine for a cron batch (≤200).
  const { data, error } = await db()
    .from('user_notification_settings')
    .select('user_email, alert_recipient_email')
    .in('user_email', owners);
  if (error) {
    console.error('[alert-delivery] batch load:', error.message);
    return map;
  }
  for (const row of data || []) {
    map.set(
      normalizeEmail(row.user_email),
      row.alert_recipient_email ? normalizeEmail(row.alert_recipient_email) : null,
    );
  }
  return map;
}
