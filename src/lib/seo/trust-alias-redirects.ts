/**
 * Short trust/security URLs people are sent to (a Mindy Day slide says getmindy.ai/trust). The
 * page lives at /app/trust (public, no sign-in), so /trust, /security and /trust/enterprise
 * returned the bare 404 page.
 *
 * Every destination is a page that already exists: src/app/app/trust/page.tsx and
 * src/app/app/trust/enterprise/page.tsx. 307 (temporary) so the targets can move later
 * without permanent browser caching. Same host scope as authAliasRedirects.
 */
export const TRUST_URL_ALIASES = {
  '/trust': '/app/trust',
  '/security': '/app/trust',
  '/trust/enterprise': '/app/trust/enterprise',
} as const;

export type TrustUrlAlias = keyof typeof TRUST_URL_ALIASES;

/** Temporary redirects for next.config, scoped to the getmindy.ai host like the auth aliases. */
export function trustAliasRedirects(): Array<{
  source: string;
  has: Array<{ type: 'host'; value: string }>;
  destination: string;
  permanent: false;
}> {
  return (Object.entries(TRUST_URL_ALIASES) as Array<[TrustUrlAlias, string]>).map(
    ([source, destination]) => ({
      source,
      has: [{ type: 'host', value: 'getmindy.ai' }],
      destination,
      permanent: false,
    }),
  );
}
