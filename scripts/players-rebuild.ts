/**
 * Proven Players rebuild + reconciliation (src/lib/players/*).
 *
 *   npm run players:rebuild                       dry run: gate + price, writes nothing
 *   npm run players:rebuild -- --go               build the PRODUCTION table (refused unless awards complete)
 *   npm run players:rebuild -- --reconcile        reconcile the production table vs truth, writes nothing
 *   npm run players:rebuild -- --reconcile --go   ... and stamp data_sources[bq_players] = reconciled on pass
 *
 * Required sequence: BQ awards repair → awards reconciliation → Players rebuild → Players
 * reconciliation. Only after `reconciled` may PLAYERS_SOURCE=canonical be set in Vercel.
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

const GO = process.argv.includes('--go');
const RECONCILE = process.argv.includes('--reconcile');
const log = (m: string) => console.log(`[players-rebuild] ${m}`);

(async () => {
  const { runPlayersRebuild, runPlayersReconcile } = await import('../src/lib/players/rebuild-run');
  if (RECONCILE) {
    const r = await runPlayersReconcile({ go: GO, log });
    process.exit(r.pass ? 0 : 1);
  }
  const rec = await runPlayersRebuild({ go: GO, log });
  process.exit(rec.status === 'failed' || rec.status === 'refused_incomplete_warehouse' ? 1 : 0);
})().catch((e) => { console.error('[players-rebuild] FAILED:', e?.message || e); process.exit(1); });
