/**
 * Print which service-account key a credential env var holds — identifiers only, never the key.
 *
 *   GCP_SA_JSON=… node scripts/gcp-credential-identity.mjs [--scope <label>] [--expect-prefix <hex>]
 *
 * Used by .github/workflows/gcp-credential-identity.yml (the rotation probe) so the question
 * "which key does the GitHub secret hold?" is answered from the secret itself, never inferred from
 * timestamps. No network, no dependencies.
 */
import { identifyCredential, matchesKeyPrefix } from './lib/gcp-credential-identity.mjs';

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const scope = opt('scope') ?? 'unspecified';

const id = identifyCredential(process.env.GCP_SA_JSON);
if (!id.ok) {
  console.error(`[credential-identity] scope=${scope} FAILED: ${id.reason}`);
  process.exit(1);
}
console.log(`[credential-identity] scope=${scope}`);
console.log(`[credential-identity] client_email=${id.clientEmail}`);
console.log(`[credential-identity] private_key_id=${id.keyId}`);
console.log(`[credential-identity] project_id=${id.projectId ?? 'unknown'}`);
let match;
try {
  match = matchesKeyPrefix(id.keyId, opt('expect-prefix'));
} catch (error) {
  console.error(`[credential-identity] ${error instanceof Error ? error.message : 'bad prefix'}`);
  process.exit(2);
}
if (match !== null) console.log(`[credential-identity] matches_expected_prefix=${match ? 'yes' : 'no'}`);
