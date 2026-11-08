/**
 * Mindy native app (Capacitor shell in /mobile) helpers.
 *
 * The iOS/Android apps load getmindy.ai/app in a WebView. The native bridge injects
 * `window.Capacitor`, so this is how the web app knows it is inside the app.
 * Everything here is a no-op on the normal website.
 */

/** Custom URL scheme registered by the native apps (Info.plist + AndroidManifest). */
export const NATIVE_SCHEME = 'ai.getmindy.app';

type CapGlobal = { isNativePlatform?: () => boolean; getPlatform?: () => string };

export function isNativeApp(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const cap = (window as unknown as { Capacitor?: CapGlobal }).Capacitor;
    return !!cap?.isNativePlatform?.();
  } catch {
    return false;
  }
}

export function nativePlatform(): 'ios' | 'android' | null {
  if (!isNativeApp()) return null;
  const p = (window as unknown as { Capacitor?: CapGlobal }).Capacitor?.getPlatform?.();
  return p === 'ios' || p === 'android' ? p : null;
}

/**
 * Only same-site relative paths may be followed from a deep link or a push payload.
 * Anything else (absolute URL, protocol-relative, javascript:) falls back to /app.
 */
export function safeReturnPath(raw: string | null | undefined): string {
  if (!raw || typeof raw !== 'string') return '/app';
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return '/app';
  if (/[\u0000-\u001f]/.test(raw)) return '/app';
  return raw;
}

/** Add `native=1` so /app/auth/callback bounces the OAuth result back into the app. */
export function withNativeFlag(redirectTo: string): string {
  try {
    const u = new URL(redirectTo);
    u.searchParams.set('native', '1');
    return u.toString();
  } catch {
    return redirectTo;
  }
}

/** Build the deep link the system browser uses to hand the session back to the app. */
export function nativeReturnUrl(to: string, hash: string): string {
  const path = safeReturnPath(to);
  const frag = hash && hash.startsWith('#') ? hash : '';
  return `${NATIVE_SCHEME}://auth?to=${encodeURIComponent(path)}${frag}`;
}

/**
 * Open an OAuth URL in the system browser (Google blocks sign-in inside WebViews).
 * Returns false when not in the app so callers can fall back to a normal redirect.
 */
export async function openInSystemBrowser(url: string): Promise<boolean> {
  if (!isNativeApp()) return false;
  const { Browser } = await import('@capacitor/browser');
  await Browser.open({ url, presentationStyle: 'popover' });
  return true;
}
