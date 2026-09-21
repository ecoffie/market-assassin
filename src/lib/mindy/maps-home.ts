/**
 * THE ONE PLACE that says where "home" is for the Maps product.
 *
 * WHY THIS EXISTS: the Mindy logo appeared on ten Maps surfaces, each hardcoding `href="/app"` —
 * so the single most-clicked navigation element on every page of the NEW product ejected the user
 * into the LEGACY one. Fixing that in ten files would have meant editing ten files again at
 * cutover. It is defined once here instead.
 *
 * ⚠️ `/app` IS THE LEGACY PRODUCT WE ARE REPLACING. Nothing in the Maps ecosystem should link to
 * it as a destination. The target journey is:
 *
 *     /today → Map → Listing → Players → Pursuits → Proposal → Vault
 *
 * ── THE APEX FLIP — EXECUTED 2026-08-24 ────────────────────────────────────────────────────
 * `getmindy.ai/` now serves Today's Intel. This is the cutover: the product itself is the
 * homepage, replacing the marketing page that used to stand in front of it.
 *
 *   MAPS_HOME_PATH  '/today'  →  '/'          ← DONE
 *   MAPS_HOME_URL   '…/today' →  apex         ← DONE (derived below)
 *
 * Rolling back is the same one-line edit in reverse, plus the `/` rewrite in next.config.ts.
 * `/mindy-landing` is deliberately kept reachable as rollback insurance — do not delete it.
 *
 * The canonical URL matters as much as the link. Two pages must never both claim the apex:
 * before the flip `/mindy-landing` owns `https://getmindy.ai` and `/today` self-canonicals;
 * after it, `/` owns the apex and `/today` canonicalizes TO the apex rather than to itself.
 * A homepage that canonicals away to a subpath tells Google the apex is not the real page.
 */

/** Where the logo, "back to home", and post-signout landings go. Relative, for in-app links. */
// Typed as `string`, not the literal: the whole point is that this value CHANGES at cutover,
// and a narrowed literal type makes `MAPS_HOME_PATH === '/'` a compile error today.
export const MAPS_HOME_PATH: string = '/';

/** Absolute origin of the site. Used for canonical/og:url, which must be absolute. */
export const MINDY_ORIGIN = 'https://getmindy.ai';

/** Absolute URL of the Maps front door — the canonical identity of Today's Intel. */
export const MAPS_HOME_URL = `${MINDY_ORIGIN}${MAPS_HOME_PATH === '/' ? '' : MAPS_HOME_PATH}`;

/**
 * True once Today's Intel is served from the apex. Read this instead of testing the path
 * literal, so the flip is a single edit above rather than a search for `=== '/today'`.
 */
export const MAPS_HOME_IS_APEX = MAPS_HOME_PATH === '/';
