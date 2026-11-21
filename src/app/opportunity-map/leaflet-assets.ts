/**
 * Leaflet is served from our own origin, never a third-party CDN.
 *
 * The Map's whole UI is one inline script that starts with `L.map(...)`. When Leaflet came
 * from unpkg.com and that host was blocked or down (corporate / agency proxies, ad and
 * script blockers, a CDN outage), `L` was undefined, the script died on its first line and
 * the page sat on "Building your market" forever with no message: no pins, no list, no
 * retry. The tile layer already fails soft ("Map tiles blocked by your network. Pins still
 * work"); that promise only holds if the library itself is guaranteed to load.
 *
 * Files under public/vendor/leaflet/<version>/ are the unmodified npm `leaflet@<version>`
 * dist (the same bytes unpkg served), with Leaflet's BSD-2 LICENSE. The path is versioned,
 * so next.config.ts gives it a year-long immutable cache; a new version ships as a new folder.
 *
 * route.ts inserts PIN_JS / EARLY_INJECT right after LEAFLET_JS_TAG with a string replace
 * that silently does nothing when the anchor is missing, so template.html must contain this
 * exact tag (leaflet-self-hosted.unit.test.ts enforces it).
 */
export const LEAFLET_VERSION = '1.9.4';
export const LEAFLET_BASE = `/vendor/leaflet/${LEAFLET_VERSION}`;
export const LEAFLET_JS_TAG = `<script src="${LEAFLET_BASE}/leaflet.js"></script>`;
export const LEAFLET_CSS_TAG = `<link rel="stylesheet" href="${LEAFLET_BASE}/leaflet.css"/>`;
