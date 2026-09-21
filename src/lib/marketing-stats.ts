/**
 * Marketing corpus counts — ONE source of truth for every public "N+ forecasts" claim.
 *
 * RE-VERIFIED 2026-08-21. Three figures had drifted low (safe but underselling); ONE was
 * overstating. See CONTRACTOR_COUNT.
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
 *   SELECT count(*) FROM agency_forecasts;   -- 33,290 on 2026-08-21
 *   SELECT count(*) FROM sam_opportunities;  -- 178,343
 *   SELECT count(*) FROM federal_contacts;   -- 217,765
 *   -- contractors live in BigQuery, not Supabase:
 *   SELECT COUNT(*) FROM `market-assasin.usaspending.recipients_rollup_merged`;  -- 292,848
 * Then round DOWN to the nearest sensible band and update both the value and the comment.
 */

/** Verified 2026-08-21: agency_forecasts = 33,290 rows. */
export const FORECAST_COUNT = 33_000;

/** Verified 2026-08-21: sam_opportunities = 178,343 rows (was 147,344 on 08-02). */
export const OPPORTUNITY_COUNT = 178_000;

/** Verified 2026-08-21: federal_contacts = 217,765 rows (was 187,909 on 08-02). */
export const CONTACT_COUNT = 217_000;

/**
 * Contractors in the BigQuery warehouse (`recipients_rollup_merged`, one row per company).
 * NOT a Supabase table, and NOT the ~2.7K figure from the /contractors SEO pages — that is
 * a curated subset.
 *
 * CORRECTED 2026-08-21: this said 317,000. The live table holds **292,848**, so the claim
 * OVERSTATED the corpus by ~24,000 — the one direction this file exists to prevent. Every
 * other constant here is a rounded-down floor; this one was a ceiling nobody re-checked.
 * CLAUDE.md still says "always cite 317K"; that instruction is now wrong and should be
 * updated to point here instead of naming a number.
 *
 *   SELECT COUNT(*) FROM `market-assasin.usaspending.recipients_rollup_merged`;  -- 292,848
 */
export const CONTRACTOR_COUNT = 290_000;

/** "33,000+" — the form that appears in copy. Rounded down, so always true. */
export const forecastsLabel = `${FORECAST_COUNT.toLocaleString()}+`;
export const opportunitiesLabel = `${OPPORTUNITY_COUNT.toLocaleString()}+`;
export const contactsLabel = `${CONTACT_COUNT.toLocaleString()}+`;
export const contractorsLabel = `${CONTRACTOR_COUNT.toLocaleString()}+`;
