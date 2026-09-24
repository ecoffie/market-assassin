/**
 * Post-migration DHS republish proof — executes the sync's upsert shape in an in-process Postgres (PGlite, pinned
 * devDependency). Never touches a real database. Blocking in CI (`npm run test:unit`) and the pre-push gate.
 *
 * The daily sync upserts with onConflict 'source_agency,external_id' and its DHS payload carries no created_at
 * (both pinned by dhs-identity.unit.test.ts). So after the migration, a republished '*F…' record must UPDATE the
 * existing canonical row: same uuid, same created_at, new content, no new row.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { canonicalDhsExternalId } from './dhs-identity';

const db = new PGlite();
type R = { id: string; created_at: Date; title: string };
const upsert = (externalId: string, title: string) => db.query(
  `INSERT INTO agency_forecasts (source_agency, external_id, title, last_synced_at) VALUES ('DHS', $1, $2, now())
   ON CONFLICT (source_agency, external_id) DO UPDATE SET title = EXCLUDED.title, last_synced_at = EXCLUDED.last_synced_at`,
  [externalId, title]);
const rows = async () => (await db.query<R>(`SELECT id, created_at, title FROM agency_forecasts ORDER BY created_at`)).rows;

let before: R;
beforeAll(async () => {
  await db.exec(`CREATE TABLE agency_forecasts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source_agency text NOT NULL, external_id text NOT NULL,
    title text, last_synced_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (source_agency, external_id));`);
  // The migrated canonical row (plain uuid + original created_at kept).
  await db.exec(`INSERT INTO agency_forecasts (source_agency, external_id, title, created_at) VALUES ('DHS','F2026073903','PR 20154333 Situational awareness','2026-08-14T13:01:12.296431+00:00')`);
  before = (await rows())[0];
}, 60_000);

describe('DHS republish after the identity migration', () => {
  it('a republished *F record UPDATES the canonical row: 1 row, same uuid, same created_at, new content', async () => {
    await upsert(canonicalDhsExternalId('*F2026073903', 73903, 'x'), 'Communications Network Enhancement Technology (C-NET)');
    const after = await rows();
    expect(after).toHaveLength(1);
    expect(after[0].id).toBe(before.id);
    expect(+after[0].created_at).toBe(+before.created_at);   // so it is NOT a new Forecast
    expect(after[0].title).toBe('Communications Network Enhancement Technology (C-NET)');
  });
  it('control: the pre-fix raw starred id WOULD have minted a second row (the defect being fixed)', async () => {
    await upsert('*F2026073903', 'old ingest behaviour');
    expect(await rows()).toHaveLength(2);
  });
});
