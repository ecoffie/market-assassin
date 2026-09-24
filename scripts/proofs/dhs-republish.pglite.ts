/**
 * Post-migration DHS republish proof — executes the sync's upsert shape in an in-process Postgres (PGlite).
 * Never touches a real database.
 *
 *   mkdir -p /tmp/pgl && cd /tmp/pgl && npm i @electric-sql/pglite
 *   NODE_PATH=/tmp/pgl/node_modules npx tsx scripts/proofs/dhs-republish.pglite.ts
 *
 * The daily sync upserts with onConflict 'source_agency,external_id' and its DHS payload carries no created_at
 * (both pinned by dhs-identity.unit.test.ts). So after the migration, a republished '*F…' record must UPDATE the
 * existing canonical row: same uuid, same created_at, new content, no new row.
 */
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { canonicalDhsExternalId } from '../../src/lib/forecasts/dhs-identity';

const require = createRequire(process.env.NODE_PATH ? join(process.env.NODE_PATH, 'x') : __filename);
const { PGlite } = require('@electric-sql/pglite');

(async () => {
  const db = new PGlite();
  let failed = 0;
  const check = (n: string, ok: boolean, d = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ` — ${d}` : ''}`); if (!ok) failed++; };
  await db.exec(`CREATE TABLE agency_forecasts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source_agency text NOT NULL, external_id text NOT NULL,
    title text, last_synced_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (source_agency, external_id));`);
  // The migrated canonical row (plain uuid + original created_at kept).
  await db.exec(`INSERT INTO agency_forecasts (source_agency, external_id, title, created_at) VALUES ('DHS','F2026073903','PR 20154333 Situational awareness','2026-08-14T13:01:12.296431+00:00')`);
  const before = (await db.query(`SELECT id, created_at FROM agency_forecasts`)).rows[0] as { id: string; created_at: Date };

  // DHS republishes it: the feed now says '*F2026073903' with new content.
  const upsert = (externalId: string, title: string) => db.query(
    `INSERT INTO agency_forecasts (source_agency, external_id, title, last_synced_at) VALUES ('DHS', $1, $2, now())
     ON CONFLICT (source_agency, external_id) DO UPDATE SET title = EXCLUDED.title, last_synced_at = EXCLUDED.last_synced_at`,
    [externalId, title]);
  await upsert(canonicalDhsExternalId('*F2026073903', 73903, 'x'), 'Communications Network Enhancement Technology (C-NET)');
  const after = (await db.query(`SELECT id, created_at, title FROM agency_forecasts`)).rows as Array<{ id: string; created_at: Date; title: string }>;
  check('republish UPDATES the canonical row — still exactly 1 row', after.length === 1, String(after.length));
  check('uuid unchanged', after[0].id === before.id);
  check('created_at unchanged (so it is NOT a new Forecast)', +after[0].created_at === +before.created_at);
  check('content taken from the republished record', after[0].title === 'Communications Network Enhancement Technology (C-NET)');

  // Negative control: the pre-fix raw id mints a second row with a fresh created_at — the defect being fixed.
  await upsert('*F2026073903', 'old ingest behaviour');
  const n = (await db.query(`SELECT count(*)::int AS c FROM agency_forecasts`)).rows[0] as { c: number };
  check('control: the raw starred id WOULD have created a new row', n.c === 2);
  console.log(failed ? `${failed} FAILED` : 'all passed');
  process.exit(failed ? 1 : 0);
})();
