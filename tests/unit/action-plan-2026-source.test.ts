/**
 * docs/action-plan-2026.md is the repo's source of truth for the Action Plan (Learn repair board
 * P2-4a). Mindy Learn cites its step IDs, so its structure is pinned here: a reworded, reordered or
 * dropped step — or Bidding moving ahead of Business Development, as the legacy /planner has it —
 * must fail CI instead of silently changing what Learn teaches.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const DOC = readFileSync(join(process.cwd(), 'docs/action-plan-2026.md'), 'utf8');

type Phase = { n: number; name: string; cadence: string; steps: { id: string; title: string }[] };

function phases(): Phase[] {
  const out: Phase[] = [];
  let cur: Phase | null = null;
  for (const line of DOC.split('\n')) {
    const h = line.match(/^## Phase (\d) — (.+) · (ONCE|REPEAT)$/);
    if (h) { cur = { n: Number(h[1]), name: h[2], cadence: h[3], steps: [] }; out.push(cur); continue; }
    if (line.startsWith('## ')) { cur = null; continue; }
    const s = line.match(/^\| `(P\d-\d\d)` \| (.+) \|$/);
    if (s && cur) cur.steps.push({ id: s[1], title: s[2] });
  }
  return out;
}

// The exact titles printed in the PDF (sha256 62b69c6c…51f5), in order.
const CANONICAL: [string, string, string[]][] = [
  ['Setup', 'ONCE', [
    'Choose your Business Structure',
    'Identify your Industry codes (NAICS)',
    'Create your SAM.GOV Profile',
    'Register for Local Gov Sites',
    'Talk to Local Apex Accelerator',
    'Create/ Fix your Business Resume (Cap Statement)',
  ]],
  ['Business Development', 'REPEAT', [
    'Identify Top 25 Buyers & Future Bids (NOT ON SAM)',
    'Setup and attend meetings with government buyers',
    'Attend Industry Events',
    'Attend Site Visits',
    'Get on Supplier List for top 25 Federal Suppliers',
    'Monitor Contract Awards and Identify Sub Opportunities',
  ]],
  ['Bidding', 'REPEAT', [
    'Review Immediate Bid Opportunities',
    'Assemble Team Based on Opportunities',
    'Apply for Vendor/ Supplier Credit',
    'Respond to Opportunity (RFP, RFQ, RFI, Task Orders)',
    'Evaluate Bid Results',
  ]],
  ['Business Enhancement', 'ONCE', [
    'Apply for Small Business Certification',
    '8(a) Certification',
    'Mentor Protege Program',
    'Focus on Self Performance Capability as Differentiator',
    'Find Better Partners',
    'Speak at an event',
  ]],
  ['Contract Management', 'REPEAT', [
    'System Registrations (PIEE, WAWF)',
    'Subcontractor Compliance',
    'Project Compliance',
    'Communication',
  ]],
];

describe('the canonical Action Plan', () => {
  const ps = phases();

  it('has 5 phases and 27 steps', () => {
    expect(ps).toHaveLength(5);
    expect(ps.reduce((n, p) => n + p.steps.length, 0)).toBe(27);
  });

  it('Business Development comes before Bidding', () => {
    const bd = ps.findIndex((p) => p.name === 'Business Development');
    const bid = ps.findIndex((p) => p.name === 'Bidding');
    expect(bd).toBe(1);
    expect(bid).toBe(2);
  });

  it('every phase, cadence and step title is verbatim and in order', () => {
    ps.forEach((p, i) => {
      const [name, cadence, titles] = CANONICAL[i];
      expect(p.n).toBe(i + 1);
      expect(p.name).toBe(name);
      expect(p.cadence).toBe(cadence);
      expect(p.steps.map((s) => s.title)).toEqual(titles);
    });
  });

  it('step IDs are stable, unique and positional (P<phase>-<nn>)', () => {
    const ids = ps.flatMap((p) => p.steps.map((s) => s.id));
    expect(new Set(ids).size).toBe(27);
    ps.forEach((p) => p.steps.forEach((s, j) => expect(s.id).toBe(`P${p.n}-${String(j + 1).padStart(2, '0')}`)));
  });

  it('records the source artifact it was transcribed from', () => {
    expect(DOC).toContain('62b69c6c40daf263f7426079db30d069b6679a517d0e82140f9e084f7fa351f5');
  });
});
