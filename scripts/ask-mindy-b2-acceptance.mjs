#!/usr/bin/env node
/**
 * Ask Mindy B2 — bounded live-provider acceptance against a NON-PRODUCTION deployment (a Vercel preview).
 *
 *   ASK_MINDY_BASE=https://<preview>.vercel.app \
 *   ASK_MINDY_EMAIL=<pro test account> ASK_MINDY_TOKEN=<that account's x-mi-auth-token> \
 *   node scripts/ask-mindy-b2-acceptance.mjs [--max 8] [--budget-usd 1.00] [--out report.json]
 *
 * Requires ASK_MINDY_TRACE_EVENTS=true on the PREVIEW environment (it is ignored on production by design),
 * so each turn reports planner tools, result sizes, notices and token usage.
 *
 * Safety: refuses getmindy.ai / mi.govcongiants.com hosts; never prints the token; stops before the next
 * question once the estimated spend reaches --budget-usd. Prices are OpenAI list prices per 1M tokens
 * (verify against openai.com/api/pricing before relying on the totals).
 */
import { writeFileSync } from 'node:fs';

export const PRICES = { // USD per 1M tokens: [input, output]
  'gpt-4o': [2.5, 10], 'gpt-4o-mini': [0.15, 0.6],
  'gpt-6-luna': [0.1, 0.5], 'gpt-6.1-terra': [1, 5], 'gpt-6.1-sol': [2, 10],
  'openai/gpt-oss-120b': [0.15, 0.6],
};

export const QUESTIONS = [
  // The original incident shape: an OPEN-opportunity question that was routed to get_expiring_contracts.
  { id: 'security-guard-open', q: 'What security guard opportunities are open right now?', expect: { notTool: 'get_expiring_contracts', anyTool: true } },
  { id: 'security-guard-state', q: 'Show me open security guard solicitations in Texas', expect: { notTool: 'get_expiring_contracts', anyTool: true } },
  { id: 'recompete-keeps-tool', q: 'Which security guard contracts are expiring in the next 12 months?', expect: { tool: 'get_expiring_contracts' } },
  { id: 'broad-oversize', q: 'List all janitorial contracts expiring in the next 24 months nationwide', expect: { anyTool: true } },
  { id: 'buying-offices-dod', q: 'Which Navy offices buy facilities support services?', expect: { anyTool: true } },
  { id: 'teaching', q: 'How do I write a capability statement?', expect: {} },
  { id: 'nonsense-search', q: 'Find open opportunities for zzqx widget polishing', expect: { anyTool: true } },
  { id: 'follow-up-context', q: 'What about in Florida?', history: [
    { role: 'user', content: 'What security guard opportunities are open right now?' },
    { role: 'assistant', content: 'Here are open security guard opportunities.' },
  ], expect: { notTool: 'get_expiring_contracts' } },
];

function arg(name, dflt) { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : dflt; }

async function ask(base, email, token, item) {
  const started = Date.now();
  const res = await fetch(`${base}/api/app/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-mi-auth-token': token, 'x-user-email': email },
    body: JSON.stringify({ email, message: item.q, history: item.history ?? [] }),
  });
  const out = { id: item.id, q: item.q, status: res.status, ms: 0, tools: [], resultChars: [], notices: [], errors: [], answer: '', usage: null };
  if (!res.ok || !res.body) { out.errors.push(`http_${res.status}`); out.ms = Date.now() - started; return out; }
  const text = await res.text();
  for (const line of text.split('\n')) {
    if (!line.startsWith('data:')) continue;
    let e; try { e = JSON.parse(line.slice(5)); } catch { continue; }
    if (e.type === 'token') out.answer += e.content;
    if (e.type === 'notice') out.notices.push(e.code);
    if (e.type === 'error') out.errors.push(`${e.code}: ${e.message}`);
    if (e.type === 'trace') for (const t of e.tools ?? []) { out.tools.push(`${t.tool}:${t.status}`); out.resultChars.push(t.result_chars); }
    if (e.type === 'trace_usage') { out.usage = { planner: e.planner, answer: e.answer }; out.notices.push(...(e.notices ?? [])); }
  }
  out.ms = Date.now() - started;
  return out;
}

export function cost(u) {
  let usd = 0;
  for (const step of [u?.planner, u?.answer]) {
    if (!step?.usage) continue;
    const p = PRICES[step.model]; if (!p) continue;
    usd += ((step.usage.prompt_tokens ?? 0) * p[0] + (step.usage.completion_tokens ?? 0) * p[1]) / 1e6;
  }
  return usd;
}

export function judge(r, expect) {
  const names = r.tools.map((t) => t.split(':')[0]);
  const fails = [];
  if (r.errors.length) fails.push(`errors: ${r.errors.join(' | ')}`);
  if (/\b(AI \d{3}|openai|groq|context_length|req_[a-z0-9]+|stack)\b/i.test(r.answer + r.errors.join(' '))) fails.push('provider text visible to customer');
  if (expect.notTool && names.includes(expect.notTool)) fails.push(`used ${expect.notTool}`);
  if (expect.tool && !names.includes(expect.tool)) fails.push(`did not use ${expect.tool}`);
  if (expect.anyTool && !names.length) fails.push('no tool used (answer not grounded in a lookup)');
  if (!r.usage) fails.push('no trace_usage (is ASK_MINDY_TRACE_EVENTS=true on the preview?)');
  return fails;
}

async function main() {
  const base = String(process.env.ASK_MINDY_BASE || '').replace(/\/$/, '');
  const email = process.env.ASK_MINDY_EMAIL; const token = process.env.ASK_MINDY_TOKEN;
  if (!base || !email || !token) { console.error('Set ASK_MINDY_BASE, ASK_MINDY_EMAIL, ASK_MINDY_TOKEN.'); process.exit(2); }
  if (/getmindy\.ai|govcongiants\.com/i.test(base)) { console.error('Refusing a production host. Use a preview deployment.'); process.exit(2); }
  const max = Number(arg('max', QUESTIONS.length)); const budget = Number(arg('budget-usd', '1.00'));
  const results = []; let spent = 0;
  for (const item of QUESTIONS.slice(0, max)) {
    if (spent >= budget) { console.log(`Budget $${budget} reached; stopping.`); break; }
    const r = await ask(base, email, token, item);
    r.usd = cost(r.usage); spent += r.usd; r.fails = judge(r, item.expect);
    results.push(r);
    console.log(`${r.fails.length ? 'FAIL' : 'PASS'} ${r.id} · ${r.ms}ms · $${r.usd.toFixed(4)} · tools=[${r.tools.join(', ')}] · answer=${r.usage?.answer?.model}${r.usage?.answer?.fallback ? ' (fallback)' : ''}${r.fails.length ? ` · ${r.fails.join('; ')}` : ''}`);
  }
  const summary = { base, ran: results.length, passed: results.filter((r) => !r.fails.length).length, usd: Number(spent.toFixed(4)), results };
  writeFileSync(arg('out', 'ask-mindy-b2-acceptance.json'), JSON.stringify(summary, null, 2));
  console.log(`\n${summary.passed}/${summary.ran} passed · est. spend $${summary.usd} · answers saved for grounding review`);
  process.exit(summary.passed === summary.ran ? 0 : 1);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
