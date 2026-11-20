/**
 * One Actions step: exchange a GitHub OIDC token for a 30-minute reader URL,
 * mask it, and run the scorecard. The URL is not written to GITHUB_ENV.
 * A second cron the same Eastern day does not publish again after a success.
 */
import { spawn } from 'node:child_process';
import { appendFileSync } from 'node:fs';

const AUDIENCE = 'scorecard-reader';
const REASONS = new Set([
  'credential is missing',
  'credential is rejected',
  'oidc token request failed',
  'oidc key rejected',
  'oidc signature rejected',
  'oidc issuer rejected',
  'oidc audience rejected',
  'oidc repository rejected',
  'oidc ref rejected',
  'oidc event rejected',
  'oidc workflow rejected',
  'oidc token expired',
  'oidc token rejected',
  'rotator is not configured',
  'reader host is not configured',
  'rotator connection failed',
  'rotation replay',
  'rotation rate limited',
  'rotation refused',
]);

export function publicationDay(date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export function priorSuccessToday(runs, now, currentRunId) {
  const day = publicationDay(now);
  return (runs || []).some((run) => {
    if (String(run.id) === String(currentRunId)) return false;
    if (run.conclusion !== 'success') return false;
    if (run.event !== 'schedule' && run.event !== 'workflow_dispatch') return false;
    const created = new Date(run.created_at || run.createdAt || 0);
    if (Number.isNaN(created.getTime()) || publicationDay(created) !== day) return false;
    if (!Array.isArray(run.jobs)) return false;
    return run.jobs.some((job) => job.name === 'Acquisition scorecard' && job.conclusion === 'success');
  });
}

/** Print only an allowlisted reason. Never the token, the URL, or the response body. */
export function credentialFailureMessage(status, bodyText) {
  let reason = '';
  try { reason = JSON.parse(bodyText || '{}').reason || ''; } catch { reason = ''; }
  if (!REASONS.has(reason)) reason = 'credential is rejected';
  const http = Number.isInteger(status) ? ` (http ${status})` : '';
  return `scorecard numbers are unknown: ${reason}${http}`;
}

function fail(reason, code = 1) {
  console.error(reason.startsWith('scorecard numbers are unknown:') ? reason : `scorecard numbers are unknown: ${reason}`);
  process.exit(code);
}

async function oidcToken() {
  const tokenUrl = process.env.ACTIONS_ID_TOKEN_REQUEST_URL || '';
  const bearer = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN || '';
  if (!tokenUrl || !bearer) fail('credential is missing', 2);
  const join = tokenUrl.includes('?') ? '&' : '?';
  const res = await fetch(`${tokenUrl}${join}audience=${AUDIENCE}`, {
    headers: { Authorization: `bearer ${bearer}` },
  });
  if (!res.ok) fail(`oidc token request failed (http ${res.status})`);
  const body = await res.json().catch(() => null);
  if (!body?.value) fail('oidc token request failed');
  return body.value;
}

async function readerUrl(oidc) {
  const endpoint = process.env.SCORECARD_CREDENTIAL_URL || 'https://getmindy.ai/api/scorecard/credential';
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${oidc}` },
  });
  const text = await res.text();
  if (!res.ok) fail(credentialFailureMessage(res.status, text));
  let body;
  try { body = JSON.parse(text); } catch { fail('credential is rejected'); }
  if (!body?.database_url) fail('credential is rejected');
  return body.database_url;
}

async function alreadyPublished() {
  const token = process.env.GITHUB_TOKEN || '';
  const repo = process.env.GITHUB_REPOSITORY || '';
  const runId = process.env.GITHUB_RUN_ID || '';
  if (!token || !repo || !runId) return false;
  try {
    return await publishedEarlier(token, repo, runId);
  } catch {
    return false;
  }
}

async function publishedEarlier(token, repo, runId) {
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' };
  const list = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/daily-acquisition-scorecard.yml/runs?per_page=20&exclude_pull_requests=true&status=success`, { headers });
  if (!list.ok) return false;
  const body = await list.json();
  const now = new Date();
  const candidates = (body.workflow_runs || []).filter((run) => (
    String(run.id) !== String(runId)
    && run.conclusion === 'success'
    && (run.event === 'schedule' || run.event === 'workflow_dispatch')
    && publicationDay(new Date(run.created_at)) === day
  )).slice(0, 5);
  const detailed = [];
  for (const run of candidates) {
    const jobs = await fetch(`https://api.github.com/repos/${repo}/actions/runs/${run.id}/jobs`, { headers });
    if (!jobs.ok) continue;
    const jobBody = await jobs.json();
    detailed.push({ ...run, jobs: jobBody.jobs || [] });
  }
  return priorSuccessToday(detailed, now, runId);
}

function markSkip() {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, 'skip=true\n');
}

async function main() {
  const outFlag = process.argv.indexOf('--out-dir');
  const outDir = outFlag >= 0 ? process.argv[outFlag + 1] : '';
  if (!outDir) fail('credential is missing', 2);
  if (await alreadyPublished()) {
    markSkip();
    console.log('Scorecard already published today. No second report.');
    return;
  }
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

if (process.argv[1] && process.argv[1].endsWith('scorecard-run.mjs')) {
  main().catch(() => fail('credential is rejected'));
}
