/**
 * R2 — run the $99 membership reconciler by hand. Dry run by default (reads Stripe only).
 *   npx tsx scripts/reconcile-entitlement-sources.ts          # preview
 *   npx tsx scripts/reconcile-entitlement-sources.ts --go     # write entitlement_source_observations
 * Writes nothing outside entitlement_source_observations. Prints counts, never emails.
 */
import { config } from 'dotenv';
config({ path: '.env.local', quiet: true });
import { reconcileMembershipObservations } from '../src/lib/entitlements/membership-reconciler';

const go = process.argv.includes('--go');
reconcileMembershipObservations({ go })
  .then((p) => {
    console.log(JSON.stringify({
      mode: go ? 'GO' : 'dry-run', observed: p.observed, bySourceStatus: p.bySourceStatus,
      toEnd: p.end.length, missingEmail: p.missingEmail, wrote: p.wrote, openRowsUnknown: p.openRowsUnknown ?? false,
    }, null, 2));
    process.exit(0);
  })
  .catch((e) => { console.error(e); process.exit(1); });
