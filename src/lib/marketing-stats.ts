/**
 * Marketing corpus counts — ONE source of truth for every public "N+ forecasts" claim.
 *
 * WHY THIS EXISTS: on 2026-08-02 the forecast count was hand-typed in 32 places across 20
 * files — landing pages, the GovWin and SAM.gov comparison pages, the lifetime offer, a
 * signup email, the MCP tool description, and the /pricing SEO meta description. Every one
 * said "7,600+" or "7,700+" (written as 7-6-0-0 / 7-7-0-0). The real table held 33,075 rows.
 * We had been UNDERSELLING the product by 4.3x on every public surface, for months, with
 * nothing to catch it.
 *
 * Nothing failed, because a hardcoded number cannot fail — it just quietly stops being true.
 *
 * ── THE RULE ────────────────────────────────────────────────────────────────────────────
 * Never type a corpus size into copy. Import it from here. If you find yourself writing a
 * number followed by "+ forecasts" or "+ contacts", stop and add it to this file instead.
 *
 * ── KEEPING THESE HONEST ────────────────────────────────────────────────────────────────
 * These are STATIC and deliberately rounded DOWN, so a claim is never larger than reality
 * even as the tables grow between deploys. They are not live queries: a marketing page must
 * not hit the database on render, and a rounded floor is the honest way to state a number
 * that changes nightly.
 *
 * Re-verify with a direct count when a figure looks stale (that is what caught this):
 *   SELECT count(*) FROM agency_forecasts;   -- 33,075 on 2026-08-02
 *   SELECT count(*) FROM sam_opportunities;  -- 147,344
 *   SELECT count(*) FROM federal_contacts;   -- 187,909
 * Then round DOWN to the nearest sensible band and update both the value and the comment.
 */

/** Verified 2026-08-02: agency_forecasts = 33,075 rows. */
export const FORECAST_COUNT = 33_000;

/** Verified 2026-08-02: sam_opportunities = 147,344 rows. */
export const OPPORTUNITY_COUNT = 147_000;

/** Verified 2026-08-02: federal_contacts = 187,909 rows. */
export const CONTACT_COUNT = 187_000;

/**
 * Contractors in the BigQuery warehouse. NOT a Supabase table — per CLAUDE.md always cite
 * 317K here, never the ~2.7K figure from the /contractors SEO pages (that is a curated
 * subset, not the database).
 */
export const CONTRACTOR_COUNT = 317_000;

/** "33,000+" — the form that appears in copy. Rounded down, so always true. */
export const forecastsLabel = `${FORECAST_COUNT.toLocaleString()}+`;
export const opportunitiesLabel = `${OPPORTUNITY_COUNT.toLocaleString()}+`;
export const contactsLabel = `${CONTACT_COUNT.toLocaleString()}+`;
export const contractorsLabel = `${CONTRACTOR_COUNT.toLocaleString()}+`;
