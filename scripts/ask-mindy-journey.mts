#!/usr/bin/env -S npx tsx
/**
 * Ask Mindy customer-journey capture — one multi-turn conversation through the REAL /api/app/chat route on a
 * preview (or local dev) with an already signed-in TEST account. Captures what the customer got; never grades.
 *
 *   npx tsx scripts/ask-mindy-journey.mts --host <preview url> --email <test email> [--token <MI token>|MI_AUTH_TOKEN]
 *       --scenario <scenario.json> --intent before|after [--expect strategy_plan,recipes,vault_generate]
 *       [--sha <served commit>] [--out <dir>]
 *   npx tsx scripts/ask-mindy-journey.mts --compare <beforeDir> <afterDir> [--html <file>]
 *
 * - Scenario: { id, turns: [customer wording, ...] }. The repo ships only a synthetic one
 *   (tests/fixtures/ask-mindy-journey/ridgeline.json). A real company's wording stays outside the repo.
 * - Flags are OBSERVED from the turn notices. A run is labeled AFTER only when every --expect flag was observed on;
 *   otherwise UNCONFIRMED, and the script exits 1. Setting preview flags is not this script's job.
 * - The target must serve trace events (ASK_MINDY_TRACE_EVENTS=true, ASK_MINDY_TRACE_RESULT_CHARS=200000); production
 *   ignores them by design, so this never runs against production.
 * - After the last turn the conversation is reopened exactly as History does (GET /api/app/chat-sessions) and its
 *   continuity is recorded (every question, answer, citation count and document chip kept); a difference exits 1.
 * - Output goes OUTSIDE the repo by default (answers can carry customer-adjacent data). Never commit it.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { runJourney, observeFlags, labelRun, runWarnings, reopenConversation, reopenContinuity, type FlagKey, type JourneyScenario } from '../src/lib/chat/eval/journey';
import { writeTurnArtifacts, compareIndexHtml, type ArtifactRecord } from '../src/lib/chat/eval/journey-artifacts';

const arg = (k: string, d?: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > -1 ? process.argv[i + 1] : d;
};

const compareIdx = process.argv.indexOf('--compare');
if (compareIdx > -1) {
  const [before, after] = process.argv.slice(compareIdx + 1, compareIdx + 3);
  if (!before || !after) { console.error('Usage: --compare <beforeDir> <afterDir> [--html <file>]'); process.exit(2); }
  const html = arg('html', join(dirname(after), 'journey-compare.html'))!;
  const base = dirname(html);
  writeFileSync(html, compareIndexHtml([
    { name: 'Before', dir: before, relDir: relative(base, before) || '.' },
    { name: 'After', dir: after, relDir: relative(base, after) || '.' },
  ]));
  console.log(`Side-by-side: ${html}`);
  process.exit(0);
}

const host = arg('host');
const email = arg('email');
const token = arg('token', process.env.MI_AUTH_TOKEN);
const scenarioPath = arg('scenario');
const intent = arg('intent') as 'before' | 'after' | undefined;
if (!host || !email || !token || !scenarioPath || (intent !== 'before' && intent !== 'after')) {
  console.error('Required: --host, --email, --token (or MI_AUTH_TOKEN), --scenario <file>, --intent before|after');
  process.exit(2);
}
if (/(^|\/\/)(www\.)?getmindy\.ai(\/|$)|mcp\.getmindy\.ai/.test(host)) {
  console.error('Refusing to run against production: use a preview deployment or local dev.');
  process.exit(2);
}
const KNOWN_FLAGS: readonly FlagKey[] = ['strategy_plan', 'recipes', 'vault_generate'];
const expectedRaw = (arg('expect', '') || '').split(',').map((s) => s.trim()).filter(Boolean);
const unknown = expectedRaw.filter((k) => !KNOWN_FLAGS.includes(k as FlagKey));
if (unknown.length) { console.error(`Unknown --expect flag(s): ${unknown.join(', ')}. Known: ${KNOWN_FLAGS.join(', ')}`); process.exit(2); }
const expected = expectedRaw as FlagKey[];
const scenario = JSON.parse(readFileSync(scenarioPath, 'utf8')) as JourneyScenario;
if (!Array.isArray(scenario.turns) || !scenario.turns.length) { console.error('Scenario has no turns.'); process.exit(2); }

const outDir = arg('out', join(tmpdir(), `ask-mindy-journey-${scenario.id}-${intent}-${new Date().toISOString().replace(/[:.]/g, '-')}`))!;
mkdirSync(outDir, { recursive: true });
const artifacts: ArtifactRecord[] = [];
const startedAt = new Date().toISOString();

const turns = await runJourney({
  host, email, token, scenario,
  onTurn: async (c) => {
    console.log(`turn ${c.turn}: ${c.error ? `ERROR ${c.error}` : `${c.answer.length} chars, ${c.tools.length} tool call(s), ${(c.ms / 1000).toFixed(1)}s`}`);
    artifacts.push(...await writeTurnArtifacts({ dir: outDir, host, email, token }, c));
  },
});

// Track A ends with a saved conversation the customer can reopen: reopen it exactly as History does.
const sessionId = turns.map((t) => t.sessionId).find(Boolean) ?? null;
const reopened = sessionId ? await reopenConversation({ host, email, token, sessionId }) : null;
const continuity = reopened ? reopenContinuity(turns, reopened) : { ok: false, differences: ['no session id was returned, so the conversation could not be reopened'] };
if (reopened) writeFileSync(join(outDir, 'reopen.json'), JSON.stringify(reopened, null, 2));

const flags = observeFlags(turns);
const label = labelRun(intent, expected, flags);
const warnings = runWarnings(turns);
writeFileSync(join(outDir, 'manifest.json'), JSON.stringify({
  scenario: { id: scenario.id, file: scenarioPath },
  intent,
  label: label.label,
  label_reasons: label.reasons,
  expected_flags: expected,
  flags,
  target: { host, served_sha: arg('sha') ?? null },
  started_at: startedAt,
  finished_at: new Date().toISOString(),
  turns: turns.map((t) => ({ turn: t.turn, prompt: t.prompt, ms: t.ms, http_status: t.httpStatus, error: t.error, tools: t.tools.map((x) => `${x.tool}:${x.status}`), notices: t.notices, deliverables: t.deliverables, market_report: t.marketReport ? { url: t.marketReport.url, report_id: t.marketReport.report_id, title: t.marketReport.title } : null })),
  artifacts,
  reopen: { session_id: sessionId, http_status: reopened?.httpStatus ?? null, title: reopened?.title ?? null, ok: continuity.ok, differences: continuity.differences },
  warnings,
  graded: false,
}, null, 2));

console.log(`\nRun label: ${label.label}${label.reasons.length ? ` (${label.reasons.join('; ')})` : ''}`);
for (const [k, v] of Object.entries(flags)) console.log(`  ${k}: ${v.state}${v.evidence.length ? `  [${v.evidence.slice(0, 3).join(', ')}]` : ''}`);
console.log(`Saved conversation reopen: ${continuity.ok ? 'every turn kept' : 'DIFFERENCES'}`);
for (const x of continuity.differences) console.log(`  ${x}`);
for (const w of warnings) console.warn(`  warning: ${w}`);
console.log(`Artifacts: ${outDir}`);
process.exit(label.label === 'UNCONFIRMED' || turns.some((t) => t.error) || !continuity.ok ? 1 : 0);
