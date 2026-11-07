'use client';

/**
 * Runs only inside the Mindy iOS/Android app (Capacitor shell in /mobile). No-op on the web.
 *
 *  1. Deep links  — `ai.getmindy.app://auth?to=/path#tokens` from /app/auth/native-return:
 *     close the system browser and load the destination (with the Supabase token fragment)
 *     inside the WebView, so OAuth sign-in finishes IN the app.
 *  2. Android back button — walk WebView history, exit at the root.
 *  3. Push — once signed in, ask permission, register the device token with
 *     /api/app/push-token, and open the notification's `url` (same-site path) on tap.
 */
import { useEffect } from 'react';
import { isNativeApp, nativePlatform, safeReturnPath, NATIVE_SCHEME } from '@/lib/native/platform';
import { getMIApiHeaders, storedMIEmail } from '@/components/app/authHeaders';

const REGISTERED_KEY = 'mindy_push_registered';

/**
 * Push is OFF until a platform is listed in NEXT_PUBLIC_MOBILE_PUSH_PLATFORMS ("ios,android").
 * ⚠️ Android must not be listed before mobile/android/app/google-services.json ships in the
 * store build: PushNotifications.register() without Firebase crashes the Android app.
 */
function pushEnabledFor(platform: string): boolean {
  const raw = process.env.NEXT_PUBLIC_MOBILE_PUSH_PLATFORMS || '';
  return raw.split(',').map((p) => p.trim().toLowerCase()).includes(platform);
}

function openDeepLink(raw: string) {
  if (!raw.startsWith(`${NATIVE_SCHEME}://`)) return;
  let to = '/app';
  let hash = '';
  try {
    // Custom-scheme URLs parse fine with a dummy base swap.
    const u = new URL(raw.replace(`${NATIVE_SCHEME}://`, 'https://native.invalid/'));
    to = safeReturnPath(u.searchParams.get('to'));
    hash = u.hash || '';
  } catch { /* fall back to /app */ }
  void import('@capacitor/browser').then(({ Browser }) => Browser.close()).catch(() => {});
  window.location.href = `${to}${hash}`;
}

async function registerPush(email: string) {
  const platform = nativePlatform();
  if (!platform || !pushEnabledFor(platform)) return;
  const { PushNotifications } = await import('@capacitor/push-notifications');

  await PushNotifications.addListener('registration', async ({ value }) => {
    const marker = `${email}|${value}`;
    try { if (localStorage.getItem(REGISTERED_KEY) === marker) return; } catch { /* storage blocked */ }
    const headers = getMIApiHeaders(email, { 'Content-Type': 'application/json' });
    const res = await fetch('/api/app/push-token', {
      method: 'POST',
      headers,
      body: JSON.stringify({ email, token: value, platform }),
    }).catch(() => null);
    if (res?.ok) { try { localStorage.setItem(REGISTERED_KEY, marker); } catch { /* ignore */ } }
  });
  await PushNotifications.addListener('registrationError', (err) => {
    console.error('[NativeBridge] push registration failed', err);
  });
  await PushNotifications.addListener('pushNotificationActionPerformed', ({ notification }) => {
    const url = (notification.data as { url?: string } | undefined)?.url;
    window.location.href = safeReturnPath(url);
  });

  let perm = await PushNotifications.checkPermissions();
  if (perm.receive === 'prompt' || perm.receive === 'prompt-with-rationale') {
    perm = await PushNotifications.requestPermissions();
  }
  if (perm.receive === 'granted') await PushNotifications.register();
}

export default function NativeBridge() {
  useEffect(() => {
    if (!isNativeApp()) return;
    const cleanups: Array<() => void> = [];

    void (async () => {
      try {
        const { App } = await import('@capacitor/app');
        const link = await App.addListener('appUrlOpen', ({ url }) => openDeepLink(url));
        cleanups.push(() => { void link.remove(); });
        const back = await App.addListener('backButton', ({ canGoBack }) => {
          if (canGoBack) window.history.back();
          else void App.exitApp();
        });
        cleanups.push(() => { void back.remove(); });
      } catch (err) {
        console.error('[NativeBridge] app listeners failed', err);
      }

      const email = storedMIEmail();
      if (email) {
        try { await registerPush(email); } catch (err) { console.error('[NativeBridge] push setup failed', err); }
      }
    })();

    return () => { cleanups.forEach((fn) => fn()); };
  }, []);

  return null;
}
