/**
 * The ONE Mindy sign-in URL for every surface that is not /app.
 *
 * /app is being retired. MCP, OAuth authorize, and Maps hand-offs must not
 * send people there to prove who they are. `/signin` is the universal page
 * (the getmindy.ai rewrite that used to dump /signin → /app is removed).
 *
 * `next` is open-redirect guarded by withNext/safeNext. /mcp and /mcp/setup
 * are first-class safe destinations.
 */
import { withNext } from './safe-next';

export const UNIVERSAL_SIGNIN_PATH = '/signin';

export function mindySignInUrl(next?: string | null): string {
  return withNext(UNIVERSAL_SIGNIN_PATH, next);
}

export function mindySignUpUrl(next?: string | null): string {
  return withNext(`${UNIVERSAL_SIGNIN_PATH}?signup=1`, next);
}
