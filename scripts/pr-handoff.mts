#!/usr/bin/env -S npx tsx
/**
 * PR handoff summary for the reviewer / release queue.
 *   npx tsx scripts/pr-handoff.mts <pr-number> [--repo owner/name] [--no-overlap]
 *
 * Prints: head SHA, CI `verify` state, changed files, other OPEN PRs touching the same files, and a
 * release-risk hint (payments/Stripe, auth, migrations, customer data → RED; env/flags, cron,
 * release tooling → YELLOW). Read-only: uses `gh api` (REST) and changes nothing.
 */
import { execFileSync } from 'node:child_process';
import { riskHint, overlappingPrs } from './lib/pr-risk.mjs';

const args = process.argv.slice(2);
const num = Number(args.find((a) => /^\d+$/.test(a)));
const repoIdx = args.indexOf('--repo');
const REPO = repoIdx >= 0 ? args[repoIdx + 1] : 'ecoffie/market-assassin';
const OVERLAP = !args.includes('--no-overlap');
if (!num) {
  console.error('usage: npx tsx scripts/pr-handoff.mts <pr-number> [--repo owner/name] [--no-overlap]');
  process.exit(2);
}

function api<T>(path: string): T {
  return JSON.parse(execFileSync('gh', ['api', path], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })) as T;
}
/** Explicit page loop (gh's --paginate can stop after the first page). */
function pages<T>(path: string): T[] {
  const out: T[] = [];
  for (let page = 1; page <= 30; page++) {
    const sep = path.includes('?') ? '&' : '?';
    const batch = api<T[]>(`${path}${sep}per_page=100&page=${page}`);
    out.push(...batch);
    if (batch.length < 100) break;
  }
  return out;
}

type Pr = { number: number; title: string; draft: boolean; head: { sha: string; ref: string }; mergeable_state?: string };
const pr = api<Pr>(`repos/${REPO}/pulls/${num}`);
const files = pages<{ filename: string }>(`repos/${REPO}/pulls/${num}/files`).map((f) => f.filename);
const runs = api<{ check_runs: { name: string; status: string; conclusion: string | null }[] }>(
  `repos/${REPO}/commits/${pr.head.sha}/check-runs?per_page=100`,
).check_runs;
const verify = runs.filter((r) => r.name === 'verify');
const verifyState = verify.length === 0
  ? 'no verify run'
  : verify.some((r) => r.conclusion === 'success') ? 'success'
  : verify.some((r) => r.status !== 'completed') ? 'in progress'
  : verify.map((r) => r.conclusion).join(', ');

const risk = riskHint(files);
console.log(`#${pr.number} ${pr.title}${pr.draft ? '  [draft]' : ''}`);
console.log(`head        ${pr.head.sha}  (${pr.head.ref})`);
console.log(`verify      ${verifyState}`);
console.log(`mergeable   ${pr.mergeable_state ?? 'unknown'}`);
console.log(`risk hint   ${risk.level}${risk.reasons.length ? '' : ' (no sensitive paths)'}`);
for (const r of risk.reasons) console.log(`  ${r.level.padEnd(6)} ${r.label}: ${r.files.slice(0, 5).join(', ')}${r.files.length > 5 ? ` (+${r.files.length - 5})` : ''}`);
console.log(`files (${files.length})`);
for (const f of files) console.log(`  ${f}`);

if (OVERLAP) {
  const open = pages<{ number: number; title: string }>(`repos/${REPO}/pulls?state=open`).filter((o) => o.number !== num);
  const others = open.map((o) => ({ number: o.number, title: o.title, files: pages<{ filename: string }>(`repos/${REPO}/pulls/${o.number}/files`).map((f) => f.filename) }));
  const overlap = overlappingPrs(num, files, others);
  console.log(`overlapping open PRs (${overlap.length} of ${open.length} open)`);
  for (const o of overlap) console.log(`  #${o.number} ${o.title}\n      ${o.files.join(', ')}`);
}
console.log('\nA risk hint is not an approval. RED/YELLOW need independent review + Eric approval (CLAUDE.md rule 15).');
