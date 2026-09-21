/**
 * Executable dispatch gate for bq-awards-ingest.yml — imports workflow-control.ts.
 * Never prints confirmation or secret values.
 */
import {
  parseSecretPresence,
  validateWorkflowDispatch,
} from '../src/lib/awards-ingest/workflow-control';

function main(): void {
  const mode = process.env.BQ_AWARDS_INGEST_MODE ?? '';
  const confirmation = process.env.BQ_AWARDS_INGEST_CONFIRMATION;
  const hasGcpSaJson = parseSecretPresence(process.env.HAS_GCP_SA_JSON);
  const hasSupabaseUrl = parseSecretPresence(process.env.HAS_SUPABASE_URL);
  const hasSupabaseServiceKey = parseSecretPresence(process.env.HAS_SUPABASE_SERVICE_KEY);

  try {
    const result = validateWorkflowDispatch({
      mode,
      confirmation,
      hasGcpSaJson,
      hasSupabaseUrl,
      hasSupabaseServiceKey,
    });
    console.log(`mode=${result.mode}`);
    if (result.confirmationAccepted) {
      console.log('confirmation accepted');
    }
    console.log(
      `required secret names present: ${result.requiredSecretNames.join(', ')} (values never printed)`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'dispatch validation failed';
    console.error(message);
    process.exit(1);
  }
}

main();
