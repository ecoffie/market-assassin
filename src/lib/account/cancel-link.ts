/**
 * getmindy.ai/account/cancel (served by src/app/account/cancel/route.ts): one stable address for "how do I cancel" (Eric, 2026-11-27: cancelling must be easy,
 * or it becomes a customer service issue). Help answers and support replies quote it.
 *
 * Signed in: straight to Settings, Billing (/app?panel=settings&section=billing), where "Manage / cancel" opens the
 * secure billing portal. Signed out (no session, or an expired one): sign in first, then back here, then Billing.
 *
 * The session lives in this browser (localStorage, as everywhere in /app), so the decision is made in the page. The
 * token is only DECODED for its expiry, never trusted: Settings verifies it on the server like every other call.
 * No Stripe call, no billing logic: routing only.
 */
export const BILLING_PATH = '/app?panel=settings&section=billing';
export const CANCEL_PATH = '/account/cancel';
/** /app returns to a safe `next` after sign-in; `next` may not be /app itself, so it is this page. */
export const SIGN_IN_THEN_BILLING = `/app?next=${encodeURIComponent(CANCEL_PATH)}`;

/** ES5, inline. Signed in with an unexpired token: Billing. Otherwise: sign in, then back here. */
export const CANCEL_REDIRECT_JS = '(function(){'
  + 'var dest=' + JSON.stringify(SIGN_IN_THEN_BILLING) + ';'
  + 'try{var t=localStorage.getItem("mi_beta_auth_token")||"";'
  + 'if(t){var p=t.split(".")[0].replace(/-/g,"+").replace(/_/g,"/");while(p.length%4)p+="=";'
  + 'var exp=null;try{exp=JSON.parse(atob(p)).exp;}catch(e){exp=null;}'
  + 'if(!(exp&&Number(exp)<Date.now()))dest=' + JSON.stringify(BILLING_PATH) + ';}'
  + '}catch(e){}'
  + 'location.replace(dest);'
  + '})();';

