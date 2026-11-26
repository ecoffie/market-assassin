/**
 * Send one push to every active device a user has registered (mobile_push_tokens).
 * Dead tokens (uninstalled app, revoked permission) are disabled so we stop retrying them.
 *
 * Returns counts, never throws for a delivery failure — the caller decides what a 0 means.
 * A DB read error DOES throw: "couldn't read tokens" is not "user has no devices".
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { sendApns, apnsConfigured } from './apns';
import { sendFcm, fcmConfigured } from './fcm';
import type { PushMessage } from './types';

export interface DeviceRow { token: string; platform: 'ios' | 'android' }

export interface UserPushOutcome { devices: number; sent: number; failed: number; disabled: number; errors: string[] }

export function pushProvidersConfigured() {
  return { ios: apnsConfigured(), android: fcmConfigured() };
}

export async function sendPushToDevices(
  db: SupabaseClient,
  devices: DeviceRow[],
  msg: PushMessage,
): Promise<UserPushOutcome> {
  const ios = apnsConfigured() ? devices.filter((d) => d.platform === 'ios').map((d) => d.token) : [];
  const android = fcmConfigured() ? devices.filter((d) => d.platform === 'android').map((d) => d.token) : [];
  const [a, f] = await Promise.all([sendApns(ios, msg), sendFcm(android, msg)]);
  const results = [...a, ...f];

  const dead = results.filter((r) => r.dead).map((r) => r.token);
  let disabled = 0;
  if (dead.length) {
    const { error } = await db
      .from('mobile_push_tokens')
      .update({ disabled_at: new Date().toISOString(), disabled_reason: 'provider_rejected' })
      .in('token', dead);
    if (error) console.error('[push] could not disable dead tokens', error.message);
    else disabled = dead.length;
  }

  return {
    devices: ios.length + android.length,
    sent: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    disabled,
    errors: results.filter((r) => !r.ok && r.error).map((r) => r.error as string).slice(0, 5),
  };
}
