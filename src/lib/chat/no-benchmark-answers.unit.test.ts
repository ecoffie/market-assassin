/**
 * Benchmark integrity guard (Agent 4 audit, 2026-11-23). Production Ask Mindy code must not carry the answers of a
 * benchmark it is graded on: no project names, people, solicitation numbers or the benchmark company's UEI. Those
 * belong only in fixtures and tests. A rule must come from THIS customer's evidence, never from a known answer.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOTS = ['src/lib/chat', 'src/app/api/app/chat', 'src/lib/ask-mindy'];
const BENCHMARK_ANSWERS = [
  'Clara Barton', 'GWMP', 'JBAB', 'Capitol Perimeter',
  '693C73-27-R-000006', 'FA706027RXXX2', 'W912DR27H1CWY',
  'Helson Roman', 'David Bogner', 'Terry Agena', 'Kingman',
  'C9K6EE9JVDK7',
];

function productionFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === '__fixtures__' || name === '__tests__') continue;
      out.push(...productionFiles(p));
    } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) {
      out.push(p);
    }
  }
  return out;
}

const files = ROOTS.flatMap((r) => productionFiles(join(process.cwd(), r)));

describe('no benchmark answers in production Ask Mindy code', () => {
  it('finds the production files it guards', () => {
    expect(files.some((f) => f.endsWith('fmp-writeup-grounding.ts'))).toBe(true);
    expect(files.some((f) => f.endsWith('tool-selection.ts'))).toBe(true);
    expect(files.some((f) => f.endsWith(join('app', 'chat', 'route.ts')))).toBe(true);
    expect(files.some((f) => f.includes('__fixtures__') || /\.test\.tsx?$/.test(f))).toBe(false);
  });

  it('no production file contains a benchmark answer literal (fixtures and tests may)', () => {
    const hits: string[] = [];
    for (const f of files) {
      const text = readFileSync(f, 'utf8').toLowerCase();
      for (const lit of BENCHMARK_ANSWERS) if (text.includes(lit.toLowerCase())) hits.push(`${f.replace(process.cwd() + '/', '')}: ${lit}`);
    }
    expect(hits).toEqual([]);
  });

  it('no chat request-path file imports a test fixture', () => {
    // src/lib/ask-mindy/regression.ts is the regression-set evaluator (it loads its versioned fixture on purpose).
    const chatPath = files.filter((f) => !f.includes(join('src', 'lib', 'ask-mindy')));
    const hits = chatPath.filter((f) => /from\s+['"][^'"]*__fixtures__[^'"]*['"]/.test(readFileSync(f, 'utf8')));
    expect(hits.map((f) => f.replace(process.cwd() + '/', ''))).toEqual([]);
  });
});
