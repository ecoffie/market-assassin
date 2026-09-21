/**
 * PHASE 0 SPIKE — Mindy Chat v2 (tasks/PRD-mindy-chat-data-core.md)
 *
 * ONE JOB: prove a streamed tool-call round-trip works on BOTH providers the
 * flagship chat uses (OpenAI gpt-4o primary, Groq llama-3.1-8b-instant fallback)
 * WITHOUT breaking the existing SSE parse shape in src/app/api/app/chat/route.ts.
 *
 * This is throwaway de-risking, NOT product code. It touches no route, no DB.
 * It mimics the route's exact request/stream pattern:
 *   body: { model, messages, temperature, max_tokens, stream, stream_options, tools }
 *   parse: for each `data:` line, JSON.parse, read choices[0].delta
 * ...and adds the ONE new thing v2 needs: accumulate streamed `tool_calls` deltas
 * (fragmented .arguments JSON), execute the tool, feed the result back as a
 * `role:'tool'` message, and stream the model's final grounded answer.
 *
 * A fake tool `get_earliest_pursuit` stands in for the real Tier-0
 * `get_my_pipeline` — the spike proves the MECHANICS, not the data path.
 *
 * PASS = both providers: (1) emit a tool_call for the tool question, (2) we parse
 * it, (3) round-trip returns a final answer that used the tool's return value,
 * AND (4) a pure teaching question still streams plain content (no regression).
 *
 * Usage:  node scripts/spike-chat-v2-toolcall.mjs
 *   reads OPENAI_API_KEY + GROQ_API_KEY from .env.local
 */
import fs from 'node:fs';
import path from 'node:path';

// --- load .env.local (no dep; just the two keys we need) ---
const envPath = path.join(process.cwd(), '.env.local');
const env = {};
for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const OPENAI_KEY = env.OPENAI_API_KEY;
const GROQ_KEY = env.GROQ_API_KEY;

const PROVIDERS = [
  { name: 'openai', url: 'https://api.openai.com/v1/chat/completions', key: OPENAI_KEY, model: 'gpt-4o' },
  { name: 'groq',   url: 'https://api.groq.com/openai/v1/chat/completions', key: GROQ_KEY, model: 'llama-3.1-8b-instant' },
];

// --- the tool the model may call (mimics Tier-0 get_my_pipeline shape) ---
const TOOLS = [{
  type: 'function',
  function: {
    name: 'get_earliest_pursuit',
    description: "Return the caller's pipeline pursuit with the nearest deadline. Call this whenever the user asks about their own pursuits, pipeline, or deadlines.",
    parameters: { type: 'object', properties: {}, required: [] }, // NO email arg — Tier-0 rule: caller identity is server-side only
  },
}];

// The fake tool's return value. In production this is a user_email-scoped query.
function runTool(name) {
  if (name === 'get_earliest_pursuit') {
    return { title: 'DLA Aviation — Aircraft Tubing IDIQ', agency: 'Defense Logistics Agency', deadline: '2026-07-18', stage: 'proposal' };
  }
  return { error: 'unknown tool' };
}

const SYSTEM = "You are Mindy, a federal contracting assistant. If the user asks about their own pipeline/pursuits/deadlines, you MUST call get_earliest_pursuit. For general teaching questions, just answer in 1-2 sentences — do not call any tool.";

async function streamOnce(provider, messages, useTools) {
  const body = {
    model: provider.model,
    messages,
    temperature: 0.3,
    max_tokens: 400,
    stream: true,
    stream_options: { include_usage: true },
  };
  if (useTools) { body.tools = TOOLS; body.tool_choice = 'auto'; }

  const res = await fetch(provider.url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${provider.key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) {
    throw new Error(`${provider.name} HTTP ${res.status}: ${(await res.text().catch(() => '')).slice(0, 160)}`);
  }

  // Parse SSE exactly like the route does, PLUS accumulate tool_calls deltas.
  let content = '';
  const toolCalls = []; // [{ id, name, argsStr }] indexed by tool_call index
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let leftover = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunkStr = leftover + decoder.decode(value, { stream: true });
    const lines = chunkStr.split('\n');
    leftover = lines.pop() || '';
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (payload === '[DONE]') continue;
      let parsed;
      try { parsed = JSON.parse(payload); } catch { continue; }
      const delta = parsed?.choices?.[0]?.delta;
      if (!delta) continue;
      // existing path — plain content
      if (typeof delta.content === 'string' && delta.content.length) content += delta.content;
      // NEW path — tool_calls arrive fragmented across chunks
      if (Array.isArray(delta.tool_calls)) {
        for (const tc of delta.tool_calls) {
          const i = tc.index ?? 0;
          if (!toolCalls[i]) toolCalls[i] = { id: '', name: '', argsStr: '' };
          if (tc.id) toolCalls[i].id = tc.id;
          if (tc.function?.name) toolCalls[i].name += tc.function.name;
          if (tc.function?.arguments) toolCalls[i].argsStr += tc.function.arguments;
        }
      }
    }
  }
  return { content, toolCalls: toolCalls.filter(Boolean) };
}

async function testProvider(provider) {
  const out = { provider: provider.name, model: provider.model };
  if (!provider.key) return { ...out, skip: 'no API key' };

  // (A) TOOL question — must emit a tool_call, then round-trip to a grounded answer
  try {
    const base = [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: 'Which of my pursuits is due first?' },
    ];
    const first = await streamOnce(provider, base, true);
    out.emittedToolCall = first.toolCalls.length > 0;
    if (out.emittedToolCall) {
      const call = first.toolCalls[0];
      // args must be valid JSON (even if empty {}) — proves fragmented accumulation reassembled
      let argsOk = true;
      try { JSON.parse(call.argsStr || '{}'); } catch { argsOk = false; }
      out.toolName = call.name;
      out.argsReassembled = argsOk;
      const result = runTool(call.name);
      // Second turn: feed the tool result back, stream the final answer
      const followup = [
        ...base,
        { role: 'assistant', content: null, tool_calls: [{ id: call.id || 'call_0', type: 'function', function: { name: call.name, arguments: call.argsStr || '{}' } }] },
        { role: 'tool', tool_call_id: call.id || 'call_0', content: JSON.stringify(result) },
      ];
      const second = await streamOnce(provider, followup, true);
      out.finalAnswer = second.content.trim();
      // grounded == the answer references the tool's returned data
      out.usedToolData = /DLA|Aviation|Tubing|Logistics|07-18|July 18|18/i.test(second.content);
    }
  } catch (e) { out.toolError = e.message; }

  // (B) TEACHING question — must NOT call a tool, must return plain content (no regression)
  try {
    const teach = await streamOnce(provider, [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: 'What is a capability statement?' },
    ], true);
    out.teachingNoTool = teach.toolCalls.length === 0;
    out.teachingAnswered = teach.content.trim().length > 20;
  } catch (e) { out.teachingError = e.message; }

  return out;
}

const results = [];
for (const p of PROVIDERS) {
  process.stdout.write(`\n▶ ${p.name} (${p.model})…\n`);
  const r = await testProvider(p);
  results.push(r);
  console.log(JSON.stringify(r, null, 2));
}

console.log('\n================ SPIKE VERDICT ================');
for (const r of results) {
  if (r.skip) { console.log(`  ${r.provider}: SKIPPED (${r.skip})`); continue; }
  const pass = r.emittedToolCall && r.argsReassembled && r.usedToolData && r.teachingNoTool && r.teachingAnswered;
  console.log(`  ${r.provider}: ${pass ? '✅ PASS' : '❌ FAIL'}` +
    `  [toolCall=${!!r.emittedToolCall} argsJSON=${!!r.argsReassembled} usedData=${!!r.usedToolData} teachNoTool=${!!r.teachingNoTool} teachAns=${!!r.teachingAnswered}]`);
  if (r.toolError) console.log(`     toolError: ${r.toolError}`);
  if (r.teachingError) console.log(`     teachingError: ${r.teachingError}`);
}
console.log('==============================================');
