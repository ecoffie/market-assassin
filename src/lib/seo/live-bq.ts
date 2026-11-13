/**
 * SEO live-BigQuery kill switch.
 *
 * The public SEO/crawler pages (contractor profiles, /awards/[id],
 * /contracts/[piid], the sitemap) fire LIVE BigQuery scans on a cold render —
 * a cold contractor overview alone runs ~10 parallel scans. Under heavy
 * Googlebot crawl of the long-tail (the sitemap advertises ~37K contractor
 * URLs), this exhausted the BigQuery `QueryUsagePerDay` custom quota, which in
 * turn took the AUTHENTICATED Contractors panel down (it shares the same GCP
 * project quota).
 *
 * This flag gates ONLY the crawler-facing cold scans. It defaults to OFF
 * ("turned off") so the burn stops on deploy. When off:
 *   - cold contractor overviews / award / contract pages serve from KV cache
 *     only (warmed top-N pages still render fully).
 *   - 2026-11-12: an unwarmed contractor slug no longer returns notFound() — that
 *     404'd valid contractors and drove the July 2026 index collapse. The profile
 *     and contracts pages now take ONE unit of a fail-closed daily budget for a
 *     bounded live lookup, or answer 5xx and queue a warm. This flag does not gate
 *     that path; the budget does (src/lib/seo/seo-unavailable.ts).
 *   - the sitemap serves its last cached recipient set instead of re-scanning.
 *
 * The authenticated product paths (search-bq, osbp/smb-search, chat tier-2,
 * micc) are NOT gated by this — they keep `liveBq:true` and work as soon as the
 * daily quota has headroom.
 *
 * Re-enable (e.g. after raising the BQ quota or adding a proper warm cron) with
 * `ENABLE_SEO_LIVE_BQ=1` in the environment.
 */
export function seoLiveBqEnabled(): boolean {
  const v = process.env.ENABLE_SEO_LIVE_BQ;
  return v === '1' || v === 'true';
}
