/**
 * One Actions step: exchange a GitHub OIDC token for a 30-minute reader URL,
 * mask it, and run the scorecard. The URL is not written to GITHUB_ENV.
 */
import { spawn } from 'node:child_process';

const AUDIENCE = 'scorecard-reader';

function fail(reason, code = 1) {
  console.error(`scorecard numbers are unknown: ${reason}`);
  process.exit(code);
}

async function oidcToken() {
  const tokenUrl = process.env.ACTIONS_ID_TOKEN_REQUEST_URL || '';
  const bearer = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN || '';
  if (!tokenUrl || !bearer) fail('credential is missing', 2);
  const res = await fetch(`${tokenUrl}&audience=${AUDIENCE}`, {
    headers: { Authorization: `bearer ${bearer}` },
  });
  if (!res.ok) fail('credential is rejected');
  const body = await res.json();
  if (!body?.value) fail('credential is rejected');
  return body.value;
}

async function readerUrl(oidc) {
  const endpoint = process.env.SCORECARD_CREDENTIAL_URL || 'https://getmindy.ai/api/scorecard/credential';
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${oidc}` },
  });
  if (!res.ok) fail('credential is rejected');
  const body = await res.json();
  if (!body?.database_url) fail('credential is rejected');
  return body.database_url;
}

async function main() {
  const outFlag = process.argv.indexOf('--out-dir');
  const outDir = outFlag >= 0 ? process.argv[outFlag + 1] : '';
  if (!outDir) fail('credential is missing', 2);
  const oidc = await oidcToken();
  const databaseUrl = await readerUrl(oidc);
  console.log(`::add-mask::${databaseUrl}`);
  const child = spawn(process.execPath, ['scripts/daily-acquisition-scorecard.mjs', '--out-dir', outDir], {
    env: { ...process.env, SCORECARD_DATABASE_URL: databaseUrl },
    stdio: 'inherit',
  });
  const code = await new Promise((resolve) => child.on('exit', (status) => resolve(status ?? 1)));
  process.exit(code);
}

main().catch(() => fail('credential is rejected'));
