/**
 * Universal OAuth callback contract. Google and Microsoft share this.
 *
 * redirectTo is ALWAYS `/auth/callback?next=…` — never `/`, `/today`, `/signin`,
 * or anything under `/app`. The callback mints the Mindy session, then
 * `postSignupPath` picks the destination.
 */
import type { DestinationInput } from './post-signup-destination';

export const OAUTH_CALLBACK_PATH = '/auth/callback';

/** Cookie the browser client writes so the server can exchange a PKCE `code`. */
export const PKCE_VERIFIER_COOKIE = 'sb-pkce-code-verifier';

/** sessionStorage key so a Site-URL fallback to `/` can still recover `next`. */
export const MINDY_OAUTH_NEXT_KEY = 'mindy_oauth_next';

export function oauthCallbackUrl(origin: string, input: DestinationInput = {}): string {
  const dest = new URL(OAUTH_CALLBACK_PATH, origin);
  const rawNext = (input.next || '').trim();
  if (rawNext) dest.searchParams.set('next', rawNext);
  const intent = (input.intent || '').trim();
  if (intent) dest.searchParams.set('intent', intent);
  const purchase = (input.purchaseNext || '').trim();
  if (purchase) dest.searchParams.set('purchase_next', purchase);
  return dest.toString();
}

/** supabase-js may store `verifier` or `verifier/PASSWORD_RECOVERY`. */
export function readPkceVerifier(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let value = raw;
  try {
    value = decodeURIComponent(raw);
  } catch {
    /* keep raw */
  }
  const verifier = value.split('/')[0].trim();
  return verifier || null;
}

/**
 * Belt-and-suspenders consumer for an implicit `#access_token=` leftover
 * (Site URL still `https://getmindy.ai`) or a `?code=` that landed on `/today`.
 *
 * Clears the hash BEFORE the mint fetch. Then hops to `/auth/callback?next=`
 * so `postSignupPath` — not a second validator — picks the destination.
 * Never mentions `/app`.
 */
export function oauthFragmentConsumerScript(): string {
  return (
    '<script>(function(){' +
    'var hash=location.hash||"";' +
    'var q=new URLSearchParams(location.search);' +
    'var stored="";try{stored=sessionStorage.getItem("' + MINDY_OAUTH_NEXT_KEY + '")||"";}catch(e){}' +
    'if(q.get("code")&&location.pathname!=="' + OAUTH_CALLBACK_PATH + '"){' +
      'location.replace("' + OAUTH_CALLBACK_PATH + '"+location.search);return;' +
    '}' +
    'if(hash.indexOf("access_token=")===-1){' +
      'if(location.pathname==="' + OAUTH_CALLBACK_PATH + '") location.replace("/signin");' +
      'return;' +
    '}' +
    'var hp=new URLSearchParams(hash.replace(/^#/,""));' +
    'var access=hp.get("access_token");' +
    'if(!access)return;' +
    'history.replaceState(null,"",location.pathname+location.search);' +
    'var next=q.get("next")||stored||"";' +
    'var intent=q.get("intent")||"";' +
    'fetch("/api/auth/mindy-session",{method:"POST",headers:{Authorization:"Bearer "+access},credentials:"same-origin"})' +
    '.then(function(r){return r.json().catch(function(){return {};});})' +
    '.then(function(d){' +
      'if(d&&d.sessionToken){try{localStorage.setItem("mi_beta_auth_token",d.sessionToken);if(d.authenticatedAt)localStorage.setItem("mi_beta_authenticated_at",d.authenticatedAt);if(d.email)localStorage.setItem("mi_beta_email",d.email);}catch(e){}}' +
      'var p=new URLSearchParams();' +
      'if(next)p.set("next",next);' +
      'if(intent)p.set("intent",intent);' +
      'var qs=p.toString();' +
      'location.replace("' + OAUTH_CALLBACK_PATH + '"+(qs?("?"+qs):""));' +
    '})' +
    '.catch(function(){location.replace("/signin");});' +
    '})();</script>'
  );
}

export function oauthFragmentConsumerHtml(): string {
  return (
    '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<title>Signing you in…</title></head><body>' +
    '<p style="font:500 15px Inter,system-ui,sans-serif;color:#334;padding:48px 24px;text-align:center">Signing you in…</p>' +
    oauthFragmentConsumerScript() +
    '</body></html>'
  );
}
