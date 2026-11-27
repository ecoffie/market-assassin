/**
 * Eric (2026-11-27): "remove unsourced numbers everywhere". A number in a system prompt, host rule, help answer,
 * tool description, serverInfo or MCP page copy is something the model can repeat to a customer as fact. It is
 * allowed only when it comes from marketing-stats.ts, live data, packages.ts prices, the opportunity's own facts,
 * or an official figure that names its source. Everything else is worded without a number.
 *
 * This scans the customer- and model-facing copy (comment lines are skipped) for market-stat shapes:
 *   "37% of forecasts", "$700B+", "6–18 months before", "~167K rows", "200 primes".
 * A sourced exception goes in ALLOWED with its source; never add one without a source.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const FILES = [
  'src/app/api/app/chat/route.ts',
  'src/lib/ask-mindy/research-mode.ts',
  'src/lib/ask-mindy/outreach-rules.ts',
  'src/lib/ask-mindy/how-they-buy-now.ts',
  'src/lib/ask-mindy/competition-playbook.ts',
  'src/lib/ask-mindy/help-answers.ts',
  'src/lib/chat/generate-document-tool.ts',
  'src/lib/chat/app-actions/propose.ts',
  'src/lib/mcp/tool-registry.ts',
  'src/lib/mcp/tool-schemas.ts',
  'src/lib/mcp/potato-journey.ts',
  'src/lib/mcp/chatgpt-profile.ts',
  'src/lib/opportunities/find-opportunities.ts',
  'src/app/mcp/[transport]/route.ts',
  'src/app/mcp/about/page.tsx',
  'src/app/mcp/setup/page.tsx',
  'src/app/mcp/setup/setup-copy.ts',
  'src/app/oauth/authorize/page.tsx',
];

/** Market-stat shapes the model could repeat as fact. */
const STAT_SHAPES: Array<[string, RegExp]> = [
  ['share of a population', /\b\d{1,3}(?:\.\d+)?%\s+of\s+(?:all\s+)?(?:forecasts|contracts|awards|agencies|buyers|opportunities|small businesses|firms|companies|contractors|spend|bids|proposals|cos|contracting officers)\b/i],
  ['dollar market size', /\$\d[\d.,]*\s?(?:B|T|billion|trillion)\+?(?![\w])/],
  ['lead-time range', /\b\d{1,2}\s?[–-]\s?\d{1,2}\s+months?\s+(?:before|early|ahead|prior)/i],
  ['corpus size typed in copy', /~?\d{2,3}K\+?\s+(?:rows|records|contacts|primes|firms|contractors)\b/i],
  ['typed prime count', /\b\d{2,4}\s+primes\b/i],
  ['generalisation', /\b(?:most|the majority of|nearly all|half of)\s+(?:cos|contracting officers|agencies|buyers|federal contracts|small businesses|winners)\b/i],
];

/** Sourced exceptions: [file, exact substring, source]. */
const ALLOWED: Array<[string, string, string]> = [];

const codeLines = (src: string) =>
  src.split('\n').map((l, i) => ({ l, n: i + 1 })).filter(({ l }) => !/^\s*(\/\/|\*|\/\*\*?)/.test(l));

describe('no unsourced market statistics in model- or customer-facing copy', () => {
  for (const f of FILES) {
    it(f, () => {
      const src = readFileSync(join(process.cwd(), f), 'utf8');
      const hits: string[] = [];
      for (const { l, n } of codeLines(src)) {
        for (const [label, re] of STAT_SHAPES) {
          const m = l.match(re);
          if (!m) continue;
          if (ALLOWED.some(([af, sub]) => af === f && l.includes(sub))) continue;
          hits.push(`${f}:${n} ${label}: "${m[0]}"`);
        }
      }
      expect(hits).toEqual([]);
    });
  }

  it('the removed claims stay removed', () => {
    const all = FILES.map((f) => readFileSync(join(process.cwd(), f), 'utf8')).join('\n');
    for (const gone of ['$700B+', '37% of forecasts', '6-18 months before', '6–18 months before', '6–18 months early', '~167K rows', '200 primes', 'orders under about $250K draw fewer bidders', 'not $7M', 'identical $2.09B', 'USASpending posts awards with about a 90-day delay']) {
      expect(all).not.toContain(gone);
    }
  });

  it('the statutory small-business goals name their source', () => {
    const reg = readFileSync(join(process.cwd(), 'src/lib/mcp/tool-registry.ts'), 'utf8');
    expect(reg).toMatch(/15 U\.S\.C\. 644\(g\): Small ' \+\n\s*'Business 23%/);
  });
});
