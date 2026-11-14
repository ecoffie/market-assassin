#!/usr/bin/env -S npx tsx
/**
 * Ask Mindy regression baseline — evidence-based.
 *
 * Sends the regression prompts to a running Ask Mindy route started with
 * ASK_MINDY_TRACE_EVENTS=true and ASK_MINDY_TRACE_RESULT_CHARS=200000 (full evidence; local/preview only), records each answer plus the turn's tool
 * evidence (tools, redacted args, result excerpts), and grades it with src/lib/chat/eval/grade.ts.
 *
 *   npx tsx scripts/ask-mindy-baseline.mts --host http://localhost:3000 --email <staff pro> [--token <MI token>|MI_AUTH_TOKEN] [--out <dir>] [--only R1,R3]
 *   npx tsx scripts/ask-mindy-baseline.mts --regrade <dir>      # re-score saved runs, no LLM calls
 *
 * - A partial is reported separately and never counted as a pass.
 * - Output goes OUTSIDE the repo by default (answers can carry customer-adjacent data).
 * - The fixture's official_baseline is the recorded result; this script compares, never overwrites it.
 * - Exits non-zero unless every scenario passes.
 */
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { grade, type Scenario, type ToolEvidence } from '../src/lib/chat/eval/grade';

const arg = (k: string, d?: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > -1 ? process.argv[i + 1] : d;
};
const fixture = JSON.parse(readFileSync(join(process.cwd(), 'tests/fixtures/ask-mindy-regression.json'), 'utf8')) as {
  scenarios: Scenario[];
  official_baseline?: { per_scenario: Record<string, string>; result: Record<string, number> };
};
const only = arg('only') ? new Set(arg('only')!.split(',')) : null;
const scenarios = fixture.scenarios.filter((s) => !only || only.has(s.id));

type Run = { answer: string; evidence: ToolEvidence[]; notices: string[]; ms: number; error: string | null; sessionId: string | null };

function evidenceFromTraces(traces: Array<{ tools?: Array<Record<string, unknown>> }>): ToolEvidence[] {
  return traces.flatMap((t) => (t.tools ?? []).map((x) => ({
    tool: String(x.tool ?? ''), status: String(x.status ?? ''), error_category: (x.error_category as string) ?? null,
    args: (x.args as Record<string, unknown>) ?? null, result_excerpt: String(x.result_excerpt ?? ''),
    truncated: typeof x.result_chars === 'number' && x.result_chars > String(x.result_excerpt ?? '').length,
  })));
}

async function ask(host: string, email: string, token: string, prompt: string): Promise<Run> {
  const started = Date.now();
  const res = await fetch(`${host}/api/app/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-mi-auth-token': token },
    body: JSON.stringify({ email, message: prompt, history: [] }),
  });
  if (!res.ok || !res.body) return { answer: '', evidence: [], notices: [], ms: Date.now() - started, error: `HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`, sessionId: null };
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '', answer = '', sessionId: string | null = null, error: string | null = null;
  const notices: string[] = [];
  const traces: Array<{ tools?: Array<Record<string, unknown>> }> = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() || '';
    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      try {
        const e = JSON.parse(line.slice(5).trim());
        if (e.type === 'token') answer += e.content;
        else if (e.type === 'notice' || e.type === 'truncated') notices.push(e.code || e.type);
        else if (e.type === 'trace') traces.push(e);
        else if (e.type === 'session') sessionId = e.sessionId;
        else if (e.type === 'error') error = e.message;
      } catch { /* keep-alive */ }
    }
  }
  return { answer, evidence: evidenceFromTraces(traces), notices, ms: Date.now() - started, error, sessionId };
}

function report(rows: Array<{ id: string; verdict: string; failures: string[]; partials: string[]; ms?: number }>) {
  const official = fixture.official_baseline?.per_scenario ?? {};
  for (const r of rows) {
    const base = official[r.id] ? `  (official baseline: ${official[r.id]})` : '';
    console.log(`${r.verdict.toUpperCase().padEnd(7)} ${r.id}${r.ms ? `  ${(r.ms / 1000).toFixed(1)}s` : ''}${base}`);
    for (const f of r.failures) console.log(`          fail: ${f}`);
    for (const p of r.partials) console.log(`          partial: ${p}`);
  }
  const n = (v: string) => rows.filter((r) => r.verdict === v).length;
  console.log(`\n${n('pass')} pass, ${n('partial')} partial, ${n('fail')} fail (partials are not passes)`);
  if (fixture.official_baseline) console.log(`official baseline: ${JSON.stringify(fixture.official_baseline.result)}`);
  return n('pass') === rows.length;
}

const regrade = arg('regrade');
if (regrade) {
  const rows = [];
  for (const s of scenarios) {
    let saved: Run & { traces?: Array<{ tools?: Array<Record<string, unknown>> }> };
    try { saved = JSON.parse(readFileSync(join(regrade, `${s.id}.json`), 'utf8')); } catch { continue; }
    const evidence = saved.evidence ?? evidenceFromTraces(saved.traces ?? []);
    const g = saved.error ? { verdict: 'fail', failures: [`error: ${saved.error}`], partials: [] } : grade(s, saved.answer || '', evidence);
    rows.push({ id: s.id, ...g });
  }
  process.exit(report(rows) ? 0 : 1);
}

const host = arg('host', 'http://localhost:3000')!;
const email = arg('email');
const token = arg('token', process.env.MI_AUTH_TOKEN);
if (!email || !token) {
  console.error('Required: --email <account> and --token <MI auth token> (or MI_AUTH_TOKEN), or --regrade <dir>');
  process.exit(2);
}
const outDir = arg('out', join(tmpdir(), `ask-mindy-baseline-${new Date().toISOString().replace(/[:.]/g, '-')}`))!;
mkdirSync(outDir, { recursive: true });
const rows = [];
for (const s of scenarios) {
  const r = await ask(host, email, token, s.prompt);
  if (!r.evidence.length && !r.error) console.warn(`  ${s.id}: no trace events — was the server started with ASK_MINDY_TRACE_EVENTS=true?`);
  if (r.evidence.some((e) => e.truncated)) console.warn(`  ${s.id}: evidence truncated — set ASK_MINDY_TRACE_RESULT_CHARS=200000 on the server for a full grade`);
  const g = r.error ? { verdict: 'fail', failures: [`error: ${r.error}`], partials: [] } : grade(s, r.answer, r.evidence);
  rows.push({ id: s.id, ms: r.ms, ...g });
  writeFileSync(join(outDir, `${s.id}.json`), JSON.stringify({ scenario: s, ...r, grade: g }, null, 2));
}
writeFileSync(join(outDir, 'summary.json'), JSON.stringify({ host, at: new Date().toISOString(), rows }, null, 2));
console.log(`Answers and evidence: ${outDir}`);
process.exit(report(rows) ? 0 : 1);
