#!/usr/bin/env node
/**
 * Ask Mindy regression baseline — sends the 10 regression prompts to a running Ask Mindy
 * route, records each full answer, the server notices, and deterministic pass/fail signals.
 *
 * Usage:
 *   node scripts/ask-mindy-baseline.mjs --host http://localhost:3000 \
 *     --email <staff pro account> --token <MI auth token> [--out <dir>] [--only R1,R3]
 *
 * - Each prompt is a fresh conversation (no history), so results are independent.
 * - Output goes OUTSIDE the repo by default (answers can contain customer-adjacent data).
 * - Exits non-zero if any deterministic check fails. A pass here is a floor, not the
 *   release benchmark (see the Safety/Phase 0 plan, section 7).
 * - Costs: each prompt is one planner + one answer LLM call (~$0.05-0.10 on gpt-4o).
 *   Tools run through the chat path, which deducts no credits (observation period).
 */
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > -1 ? process.argv[i + 1] : d;
};
const host = arg('host', 'http://localhost:3000');
const email = arg('email');
const token = arg('token', process.env.MI_AUTH_TOKEN);
const outDir = arg('out', join(tmpdir(), `ask-mindy-baseline-${new Date().toISOString().replace(/[:.]/g, '-')}`));
const only = arg('only') ? new Set(arg('only').split(',')) : null;
if (!email || !token) {
  console.error('Required: --email <account> --token <MI auth token> (or MI_AUTH_TOKEN env)');
  process.exit(2);
}

const fixture = JSON.parse(readFileSync(new URL('../tests/fixtures/ask-mindy-regression.json', import.meta.url), 'utf8'));
mkdirSync(outDir, { recursive: true });

async function ask(prompt) {
  const started = Date.now();
  const res = await fetch(`${host}/api/app/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-mi-auth-token': token },
    body: JSON.stringify({ email, message: prompt, history: [] }),
  });
  if (!res.ok || !res.body) return { http: res.status, answer: '', notices: [], error: (await res.text()).slice(0, 300), ms: Date.now() - started };
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let answer = '';
  const notices = [];
  let sessionId = null;
  let error = null;
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
        else if (e.type === 'session') sessionId = e.sessionId;
        else if (e.type === 'error') error = e.message;
      } catch { /* keep-alive */ }
    }
  }
  return { http: res.status, answer, notices, sessionId, error, ms: Date.now() - started };
}

function check(s, answer) {
  const a = answer.toLowerCase();
  const fails = [];
  if (s.require_any?.length && !s.require_any.some((t) => a.includes(t.toLowerCase()))) fails.push(`missing any of: ${s.require_any.join(' | ')}`);
  for (const t of s.require_all || []) if (!a.includes(t.toLowerCase())) fails.push(`missing: ${t}`);
  for (const t of s.forbid || []) if (a.includes(t.toLowerCase())) fails.push(`forbidden: "${t}"`);
  return fails;
}

const rows = [];
for (const s of fixture.scenarios) {
  if (only && !only.has(s.id)) continue;
  const r = await ask(s.prompt);
  const fails = r.error ? [`error: ${r.error}`] : check(s, r.answer);
  rows.push({ id: s.id, pass: fails.length === 0, fails, ms: r.ms, notices: r.notices, sessionId: r.sessionId, manual: s.manual || null });
  writeFileSync(join(outDir, `${s.id}.json`), JSON.stringify({ scenario: s, ...r, fails }, null, 2));
  console.log(`${fails.length ? 'FAIL' : 'pass'}  ${s.id}  ${(r.ms / 1000).toFixed(1)}s  ${r.notices.join(',')}  ${fails.join('; ')}`);
}
writeFileSync(join(outDir, 'summary.json'), JSON.stringify({ host, at: new Date().toISOString(), rows }, null, 2));
const passed = rows.filter((r) => r.pass).length;
console.log(`\n${passed}/${rows.length} passed deterministic checks. Full answers: ${outDir}`);
console.log('Traces: mindy_chat_messages.trace and mcp_call_log (channel app_chat) by sessionId.');
process.exit(passed === rows.length ? 0 : 1);
