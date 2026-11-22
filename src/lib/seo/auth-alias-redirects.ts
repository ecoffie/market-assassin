/**
 * Sign-in / sign-up URLs people type from habit. Only `/signin` and `/signup` are
 * routed on getmindy.ai (rewrites in next.config.ts), so `/login`, `/sign-in` and
 * `/register` used to land on the bare 404 page.
 *
 * Every destination is a page that already exists: `/signin` (rewritten to the
 * /app sign-in screen) and `/pricing`. 307 (temporary) so the targets can change
 * later without permanent browser caching.
 */
export const AUTH_URL_ALIASES = {
  '/login': '/signin',
  '/sign-in': '/signin',
  '/register': '/pricing',
} as const;

export type AuthUrlAlias = keyof typeof AUTH_URL_ALIASES;

/** Temporary redirects for next.config, scoped to the getmindy.ai host like /signin. */
export function authAliasRedirects(): Array<{
  source: string;
  has: Array<{ type: 'host'; value: string }>;
  destination: string;
  permanent: false;
}> {
  return (Object.entries(AUTH_URL_ALIASES) as Array<[AuthUrlAlias, string]>).map(
    ([source, destination]) => ({
      source,
      has: [{ type: 'host', value: 'getmindy.ai' }],
      destination,
      permanent: false,
    }),
  );
}
