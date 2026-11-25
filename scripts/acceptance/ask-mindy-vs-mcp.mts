/**
 * Ask Mindy vs Claude + the Mindy MCP: blind side-by-side scoring of two answers to the SAME question.
 *
 * Eric, 2026-11-25: native Ask Mindy should match Claude using Mindy's MCP. This scores both answers on the same
 * rubric without telling the judge which is which (labels are shuffled per run), and records the evidence for each
 * score. It does not decide what is true: tool-grounded facts are checked by the reader against the tool results.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/acceptance/ask-mindy-vs-mcp.mts \
 *     --q "What open opportunities are there for janitorial services in Florida?" \
 *     --mindy <answer.md | ask-mindy message id> --mcp <answer.md> [--out report.md]
 * A message id is read from mindy_chat_messages (read-only).
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import Anthropic from '@anthropic-ai/sdk';
import { getReadClient } from '@/lib/supabase/server-clients';

const arg = (k: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : undefined; };
const question = arg('q'); const mindyArg = arg('mindy'); const mcpArg = arg('mcp'); const out = arg('out');
if (!question || !mindyArg || !mcpArg) { console.error('usage: --q "<question>" --mindy <file|message id> --mcp <file> [--out file]'); process.exit(2); }

async function load(ref: string): Promise<string> {
  if (existsSync(ref)) return readFileSync(ref, 'utf8');
  const { data, error } = await getReadClient().from('mindy_chat_messages').select('content, role').eq('id', ref).maybeSingle();
  if (error || !data || data.role !== 'assistant') throw new Error(`answer ${ref} not found`);
  return String(data.content || '');
}

const AXES = ['grounded_specificity', 'decision_usefulness', 'accuracy_and_caveats', 'completeness', 'clarity'] as const;
const scoreObj = {
  type: 'object', additionalProperties: false, required: [...AXES, 'overall', 'strengths', 'weaknesses'],
  properties: {
    ...Object.fromEntries(AXES.map((a) => [a, { type: 'integer', description: '1 (poor) to 10 (excellent)' }])),
    overall: { type: 'integer', description: '1 to 10' },
    strengths: { type: 'array', items: { type: 'string' } },
    weaknesses: { type: 'array', items: { type: 'string' } },
  },
};
const SCHEMA = {
  type: 'object', additionalProperties: false, required: ['answer_1', 'answer_2', 'better', 'margin', 'why'],
  properties: {
    answer_1: scoreObj, answer_2: scoreObj,
    better: { type: 'string', enum: ['answer_1', 'answer_2', 'tie'] },
    margin: { type: 'string', enum: ['clear', 'slight', 'none'] },
    why: { type: 'string', description: 'What specifically makes the better answer more useful to a small federal contractor.' },
  },
} as const;

type Scores = Record<(typeof AXES)[number] | 'overall', number> & { strengths: string[]; weaknesses: string[] };
type Verdict = { answer_1: Scores; answer_2: Scores; better: 'answer_1' | 'answer_2' | 'tie'; margin: string; why: string };

async function main() {
  const [mindy, mcp] = await Promise.all([load(mindyArg!), load(mcpArg!)]);
  const mindyFirst = Math.random() < 0.5;
  const [a1, a2] = mindyFirst ? [mindy, mcp] : [mcp, mindy];
  const client = new Anthropic();
  const msg = await client.messages.create({
    model: 'claude-opus-5-5',
    max_tokens: 4000,
    system: 'You are an experienced federal capture manager reviewing two answers to the same question from a small government contractor. Score each answer on the rubric. Reward specific, sourced facts (contract numbers, incumbents, dollar values, dates, set-asides), a clear recommendation with reasons, honest caveats, and concrete next steps. Penalize vagueness, unsupported claims, padding, and recommending something the evidence does not support. You do not know which system wrote which answer; judge only the text.',
    output_config: { format: { type: 'json_schema', schema: SCHEMA } },
    messages: [{ role: 'user', content: `QUESTION:\n${question}\n\nANSWER 1:\n${a1}\n\nANSWER 2:\n${a2}` }],
  });
  const t = msg.content.find((c) => c.type === 'text');
  const v = JSON.parse(t && 'text' in t ? t.text : '{}') as Verdict;
  const mindyS = mindyFirst ? v.answer_1 : v.answer_2;
  const mcpS = mindyFirst ? v.answer_2 : v.answer_1;
  const winner = v.better === 'tie' ? 'tie' : (v.better === 'answer_1') === mindyFirst ? 'Ask Mindy' : 'Claude + MCP';
  const row = (k: string) => `| ${k} | ${(mindyS as Record<string, unknown>)[k]} | ${(mcpS as Record<string, unknown>)[k]} |`;
  const report = [
    `# Ask Mindy vs Claude + Mindy MCP`,
    `Question: ${question}`,
    '',
    '| Axis | Ask Mindy | Claude + MCP |', '|---|---:|---:|',
    ...[...AXES, 'overall'].map(row),
    '',
    `**Better: ${winner}** (${v.margin}). ${v.why}`,
    '',
    `Ask Mindy strengths: ${mindyS.strengths.join('; ')}`,
    `Ask Mindy weaknesses: ${mindyS.weaknesses.join('; ')}`,
    `Claude + MCP strengths: ${mcpS.strengths.join('; ')}`,
    `Claude + MCP weaknesses: ${mcpS.weaknesses.join('; ')}`,
    '',
    `Judge: claude-opus-5-5, blind (Ask Mindy shown as answer ${mindyFirst ? 1 : 2}); ${msg.usage.input_tokens} in / ${msg.usage.output_tokens} out tokens.`,
  ].join('\n');
  console.log(report);
  if (out) writeFileSync(out, report);
}
main().catch((e) => { console.error(e); process.exit(1); });
