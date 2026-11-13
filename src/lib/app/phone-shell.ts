/**
 * The Mindy phone app (/app/phone) shows the Mindy app (/app) and the Opportunity Map
 * inside its own tabs. Those pages hide the website's top bar when — and only when —
 * they are running INSIDE that shell: framed by another page AND this browser has the
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

/** Same check as isInPhoneShell, as inline script for pages that are not React (the map). */
export const PHONE_SHELL_INLINE_JS =
  `(function(){try{if(window.self!==window.top&&localStorage.getItem(${JSON.stringify(PHONE_SHELL_KEY)})==="1")document.documentElement.classList.add("phone-shell")}catch(e){}})();`;
