/**
 * Per-user CRM connection store (user_crm_connections). Holds the user's OWN
 * GoHighLevel credential so add_contacts_to_crm can write to THEIR location. The
 * token is encrypted at rest (secretbox / AES-256-GCM) and only ever decrypted
 * server-side at push time. Service-role Supabase client only.
 */
import { getWriteClient } from '@/lib/supabase/server-clients';
import { encryptSecret, decryptSecret } from '@/lib/crypto/secretbox';

export interface CrmConnection {
  provider: string;
  locationId: string;
  token: string; // decrypted — never return this to a client
  provisioned: boolean;
}

export interface CrmConnectionStatus {
  connected: boolean;
  provider?: string;
  location_id?: string;
  provisioned?: boolean;
  label?: string | null;
  updated_at?: string | null;
}

const norm = (email: string) => email.trim().toLowerCase();

/** Full connection incl. decrypted token — server-side push path only. */
export async function getCrmConnection(email: string): Promise<CrmConnection | null> {
  if (!email) return null;
  const sb = getWriteClient();
  const { data, error } = await sb
    .from('user_crm_connections')
    .select('provider, location_id, token_encrypted, provisioned')
    .eq('owner_email', norm(email))
    .maybeSingle();
  if (error || !data) return null;
  try {
    return {
      provider: data.provider,
      locationId: data.location_id,
      token: decryptSecret(data.token_encrypted),
      provisioned: !!data.provisioned,
    };
  } catch {
    // Token can't be decrypted (key rotated / corrupt) — treat as not connected.
    return null;
  }
}

/** Safe status for the UI — NEVER includes the token. */
export async function getCrmConnectionStatus(email: string): Promise<CrmConnectionStatus> {
  if (!email) return { connected: false };
  const sb = getWriteClient();
  const { data, error } = await sb
    .from('user_crm_connections')
    .select('provider, location_id, provisioned, label, updated_at')
    .eq('owner_email', norm(email))
    .maybeSingle();
  if (error || !data) return { connected: false };
  return {
    connected: true,
    provider: data.provider,
    location_id: data.location_id,
    provisioned: !!data.provisioned,
    label: data.label ?? null,
    updated_at: data.updated_at ?? null,
  };
}

export async function saveCrmConnection(
  email: string,
  opts: { token: string; locationId: string; provider?: string; provisioned?: boolean; label?: string | null },
): Promise<void> {
  const sb = getWriteClient();
  const { error } = await sb.from('user_crm_connections').upsert(
    {
      owner_email: norm(email),
      provider: opts.provider || 'ghl',
      token_encrypted: encryptSecret(opts.token),
      location_id: opts.locationId,
      provisioned: opts.provisioned ?? false,
      label: opts.label ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'owner_email' },
  );
  if (error) throw new Error(`saveCrmConnection: ${error.message}`);
}

export async function deleteCrmConnection(email: string): Promise<void> {
  const sb = getWriteClient();
  await sb.from('user_crm_connections').delete().eq('owner_email', norm(email));
}
