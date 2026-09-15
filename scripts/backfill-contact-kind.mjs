#!/usr/bin/env node
/**
 * One-time backfill of federal_contacts.contact_kind.
 *
 * DRY RUN BY DEFAULT — `--go` to write.
 *
 * Runs the whole classification in a SINGLE TRANSACTION so the table is never half-typed, and
 * re-measures every population INSIDE that transaction rather than trusting any figure from the
 * audit: the Decision Makers drain writes every 2 hours, so counts captured beforehand are stale
 * by definition.
 *
 * INVARIANT, asserted before any write: government ∩ vendor = 0. The two predicates are mutually
 * exclusive by construction (vendor needs department_ind_agency IS NULL, government needs IS NOT
 * NULL), so a non-zero overlap means the rules have drifted — the transaction ROLLS BACK rather
 * than typing the corpus on a broken premise.
 *
 * DOES NOT TOUCH: source_row_key, contact_email, contact_fullname, source_table, raw_data,
 * imported_at, updated_at. `updated_at` matters especially — federal_contacts has NO trigger on
 * it (verified), so it is writer-controlled, and bumping it here would destroy the drain's
 * "content actually changed" semantics and fake a data advance across 287K rows.
 *
 * The predicates are imported from the ONE classifier (src/lib/gov-contacts/contact-kind.ts) so
 * this script and the producer cannot disagree.
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import dotenv from 'dotenv';
import pg from 'pg';

const require = createRequire(import.meta.url);
dotenv.config({ path: join(dirname(fileURLToPath(import.meta.url)), '..', '.env.local') });
const { getDatabaseUrl } = require('./lib/db-url.js');

// Mirrors CONTACT_KIND_SQL in src/lib/gov-contacts/contact-kind.ts. Kept as literals here (this
// is a .mjs operational script outside the TS build) and asserted identical by the unit test.
const VENDOR_SQL =
  "raw_data ? 'uei' AND raw_data ? 'company' AND department_ind_agency IS NULL "
  + 'AND contact_email IS NULL AND solicitation_number IS NULL';
const GOVERNMENT_SQL =
  "source_row_key ~ '^[0-9a-f]{32}::[0-9]+$' AND department_ind_agency IS NOT NULL "
  + "AND raw_data ? 'fullName'";

const GO = process.argv.includes('--go');

async function main() {
  const client = new pg.Client({ connectionString: getDatabaseUrl(), ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    await client.query('BEGIN');

    const before = (await client.query(`
      SELECT count(*)::int AS total,
             count(*) FILTER (WHERE ${VENDOR_SQL})::int AS vendor,
             count(*) FILTER (WHERE ${GOVERNMENT_SQL})::int AS government,
             count(*) FILTER (WHERE (${VENDOR_SQL}) AND (${GOVERNMENT_SQL}))::int AS overlap,
             count(*) FILTER (WHERE NOT (${VENDOR_SQL}) AND NOT (${GOVERNMENT_SQL}))::int AS unresolved,
             count(*) FILTER (WHERE contact_kind IS NOT NULL)::int AS already_typed
      FROM federal_contacts`)).rows[0];

    console.log('── BEFORE (measured inside the transaction) ──');
    console.table(before);

    if (before.overlap !== 0) {
      throw new Error(`INVARIANT VIOLATED: government ∩ vendor = ${before.overlap}, expected 0 — rolling back`);
    }
    if (before.vendor + before.government + before.unresolved !== before.total) {
      throw new Error('classification does not partition the table — rolling back');
    }

    if (!GO) {
      await client.query('ROLLBACK');
      console.log('\nDRY RUN — nothing written. Re-run with --go to apply.');
      console.log(`Would set: government_buyer=${before.government}  vendor_entity_poc=${before.vendor}  leave NULL=${before.unresolved}`);
      return;
    }

    const gov = await client.query(
      `UPDATE federal_contacts SET contact_kind = 'government_buyer'
        WHERE contact_kind IS DISTINCT FROM 'government_buyer' AND (${GOVERNMENT_SQL})`);
    const ven = await client.query(
      `UPDATE federal_contacts SET contact_kind = 'vendor_entity_poc'
        WHERE contact_kind IS DISTINCT FROM 'vendor_entity_poc' AND (${VENDOR_SQL})`);

    const after = (await client.query(`
      SELECT count(*)::int AS total,
             count(*) FILTER (WHERE contact_kind = 'government_buyer')::int AS government_buyer,
             count(*) FILTER (WHERE contact_kind = 'vendor_entity_poc')::int AS vendor_entity_poc,
             count(*) FILTER (WHERE contact_kind IS NULL)::int AS unclassified
      FROM federal_contacts`)).rows[0];

    if (after.government_buyer + after.vendor_entity_poc + after.unclassified !== after.total) {
      throw new Error('post-write reconciliation failed — rolling back');
    }

    await client.query('COMMIT');
    console.log(`\n── WROTE ── government rows updated: ${gov.rowCount} · vendor rows updated: ${ven.rowCount}`);
    console.log('── AFTER ──');
    console.table(after);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('ROLLED BACK:', err.message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

main();
