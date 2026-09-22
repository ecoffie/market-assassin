/**
 * Fresh host probe — PATHWAY FIT packaging (not merge gate).
 * Uses fixture CAI + company via runMcpTool when possible; falls back to pure matcher.
 */
import Anthropic from '@anthropic-ai/sdk';
import { config } from 'dotenv';
import { resolve } from 'node:path';

config({ path: resolve(process.cwd(), '.env.local') });
config({ path: resolve(process.cwd(), '../../.env.local') });

import { matchCompanyToPathwaysPure } from '@/lib/pathways/pathway-fit-match';
import { caiSocomCyber, companyCyberRelevant } from '@/lib/pathways/pathway-fit-fixtures';
import { listMcpTools, isMcpTool, creditsFor } from '@/lib/mcp/tool-registry';
import { HOST_RULES_PATHWAY_FIT } from '@/lib/pathways/pathway-fit-types';

const USER =
  'Here is Current Acquisition Intelligence for SOCOM cybersecurity. Using only that package and my company’s public record, which doors can we actually walk through and what proof should I lead with? Do not invent a win. Ask only one missing-proof question.';

async function main() {
  const pkg = matchCompanyToPathwaysPure(caiSocomCyber(), companyCyberRelevant());
  console.log(
    'PROOF',
    JSON.stringify({
      catalog: listMcpTools().length,
      pathway_registered: isMcpTool('match_company_to_pathways'),
      credits: creditsFor('match_company_to_pathways'),
      no_proven_door: pkg.summary.no_proven_door,
      positive: pkg.doors
        .filter((d) => d.determination === 'SUPPORTED_FIT' || d.determination === 'POSSIBLE_FIT')
        .map((d) => ({ door: d.door, det: d.determination, score: d.rank.score })),
      _next: pkg._next,
    }),
  );

  if (!process.env.ANTHROPIC_API_KEY) {
    console.log('\n(no ANTHROPIC_API_KEY — printing host-ready package only)\n');
    console.log(JSON.stringify(pkg, null, 2).slice(0, 8000));
    return;
  }

  const client = new Anthropic();
  const system = [
    'You are connected to Mindy. Present PATHWAY FIT results for a customer.',
    'Use only the tool JSON provided. Obey presentation.host_rules.',
    ...HOST_RULES_PATHWAY_FIT,
    'Structure: Here are the doors I can support → for each: WHY IT MAY FIT / WHAT PROVES IT / WHAT I CANNOT VERIFY / WHAT I WOULD DO NEXT.',
    'End with exactly the _next prompt. No win claims. No vehicle hold claims without evidence.',
  ].join('\n');

  const resp = await client.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 2500,
    system,
    messages: [
      {
        role: 'user',
        content:
          USER +
          '\n\nPATHWAY_FIT_JSON:\n' +
          JSON.stringify({
            summary: pkg.summary,
            doors: pkg.doors.filter(
              (d) =>
                d.determination === 'SUPPORTED_FIT' ||
                d.determination === 'POSSIBLE_FIT' ||
                d.determination === 'NOT_ESTABLISHED',
            ),
            _next: pkg._next,
            host_rules: pkg.presentation.host_rules,
          }),
      },
    ],
  });

  const text = resp.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
  console.log('\n=== HOST_FINAL_TEXT ===\n');
  console.log(text);

  const lower = text.toLowerCase();
  const bans = ['you can win', 'qualified to win', 'you hold this vehicle', 'you have a prototype'];
  console.log(
    '\n=== HOST_GRADE ===\n',
    JSON.stringify({
      banned_hits: bans.filter((b) => lower.includes(b)),
      ends_with_question: /\?\s*$/.test(text.trim()),
      mentions_teaming_or_demo: /teaming|demonstrat/i.test(text),
    }),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
