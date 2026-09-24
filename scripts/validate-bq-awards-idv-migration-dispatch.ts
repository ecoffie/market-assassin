/**
 * Fail-closed dispatch gate for bq-awards-idv-migration.yml. Runs BEFORE GCP auth.
 * Never prints the confirmation or any secret value.
 */
import { validateIdvMigrationDispatch } from '../src/lib/awards-ingest/idv-migration-control';

try {
  const result = validateIdvMigrationDispatch({
    eventName: process.env.GITHUB_EVENT_NAME ?? '',
    step: process.env.IDV_MIGRATION_STEP ?? '',
    confirmation: process.env.IDV_MIGRATION_CONFIRMATION,
    fiscalYear: process.env.IDV_MIGRATION_FISCAL_YEAR,
    hasGcpSaJson: process.env.HAS_GCP_SA_JSON === 'true',
  });
  console.log(`step=${result.step}${result.fiscalYear ? ` fiscal_year=${result.fiscalYear}` : ''}`);
  console.log('confirmation accepted; GCP_SA_JSON present (value never printed)');
} catch (error) {
  console.error(error instanceof Error ? error.message : 'dispatch validation failed');
  process.exit(1);
}
