/**
 * Every proposal route that reads pursuit-scoped data with the service-role key for a
 * caller-supplied pipeline_id must check access FIRST (src/lib/proposal/pursuit-access.ts).
 * A source-order guard: in each handler, authorizePursuitRead( must appear before the
 * first pursuit-scoped read. The chat route also has a behavioural test.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../../app/api/app/proposal');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const CASES: Array<{ route: string; handler: string; firstRead: string }> = [
  { route: 'chat/route.ts', handler: 'export async function POST', firstRead: 'await loadPursuitContext(' },
  { route: 'compliance/route.ts', handler: 'export async function POST', firstRead: 'await extractMultiDoc(' },
  { route: 'extract-sow/route.ts', handler: 'export async function POST', firstRead: ".from('pursuit_documents')" },
  { route: 'bid-gates/route.ts', handler: 'export async function GET', firstRead: ".from('user_pipeline')" },
];

describe('proposal routes check pursuit access before reading pursuit data', () => {
  for (const c of CASES) {
    it(c.route, () => {
      const src = read(c.route);
      const start = src.indexOf(c.handler);
      expect(start).toBeGreaterThan(-1);
      const body = src.slice(start);
      const gate = body.indexOf('authorizePursuitRead(');
      const firstRead = body.indexOf(c.firstRead);
      expect(gate).toBeGreaterThan(-1);
      expect(firstRead).toBeGreaterThan(-1);
      expect(gate).toBeLessThan(firstRead);
    });
  }
});
