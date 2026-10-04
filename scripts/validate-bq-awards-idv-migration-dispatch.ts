/**
 * Fail-closed dispatch gate for bq-awards-idv-migration.yml. Runs BEFORE GCP auth.
 * Never prints the confirmation or any secret value.
 *
 * The env → input mapping is `idvMigrationDispatchFromEnv`, shared with the runner, so the gate
 * validates exactly what the runner will execute (it previously dropped window_from/window_to).
 */
import {
  idvMigrationDispatchFromEnv,
  validateIdvMigrationDispatch,
} from '../src/lib/awards-ingest/idv-migration-control';

try {
  const result = validateIdvMigrationDispatch(
    idvMigrationDispatchFromEnv(process.env, process.env.HAS_GCP_SA_JSON === 'true'),
  );
  console.log(`step=${result.step}`
    + (result.fiscalYear ? ` fiscal_year=${result.fiscalYear}` : '')
    + (result.window ? ` window=${result.window.from}..${result.window.to}` : ''));
  console.log('confirmation accepted; GCP_SA_JSON present (value never printed)');
} catch (error) {
  console.error(error instanceof Error ? error.message : 'dispatch validation failed');
  process.exit(1);
}
