/**
 * The Mindy phone app (/app/phone) shows the Mindy app (/app and /app?panel=map) inside
 * its own tabs. /app trims its header to the menu button when — and only when —
 * it is running INSIDE that shell: framed by another page AND this browser has the
 * shell flag (set by /app/phone, which only the phone app opens). The frame check means
 * a desktop browser that once opened /app/phone still shows every page normally.
 */
export const PHONE_SHELL_KEY = 'mindy_phone_shell';

export function markPhoneShell(): void {
  try { localStorage.setItem(PHONE_SHELL_KEY, '1'); } catch { /* storage blocked */ }
}

export function isInPhoneShell(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.self !== window.top && localStorage.getItem(PHONE_SHELL_KEY) === '1';
  } catch {
    return false;
  }
}
