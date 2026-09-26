/**
 * Legislation routing — the tool alone did not fix the production failure.
 *
 * 2026-09-25 fresh-host test: "What is the status of the FY2027 NDAA?" in a new claude.ai
 * chat with the Mindy connector ON → web search, never Mindy. The served connector
 * instructions were 14,228 chars and the host-visible portion ended at ~1,989; nothing in
 * that visible top named a Mindy tool for Congress. These tests pin the fix:
 *  1. a LEGISLATION routing line inside the visible top, ahead of the solicitation classes
 *     and Potato P2, pointing at get_legislation_status and away from FR / FIND;
 *  2. negative boundaries on the three neighbours so none of them claims bill status;
 *  3. P2 routing unchanged.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MCP_CONNECTOR_INSTRUCTIONS } from './schedule-discovery';
import { P2_FIRST_TURN_INSTRUCTIONS } from './potato-journey';
import { listMcpTools, creditsFor } from './tool-registry';

const VISIBLE_BUDGET = 1500;
const line = MCP_CONNECTOR_INSTRUCTIONS.split('\n').find((l) => l.startsWith('LEGISLATION')) ?? '';
const describe_ = (name: string) =>
  String((listMcpTools().find((t) => (t.function as { name: string }).name === name)!.function as { description: string }).description);

describe('LEGISLATION routing line in the served connector instructions', () => {
  it('exists and names get_legislation_status', () => {
    expect(line).toMatch(/call get_legislation_status ONCE/);
    expect(line).toMatch(/NDAA/);
    expect(line).toMatch(/public law/i);
    expect(line).toMatch(/H\.R\. or S\./);
  });

  it(`sits inside the first ${VISIBLE_BUDGET} chars — the part a host actually sees`, () => {
    const at = MCP_CONNECTOR_INSTRUCTIONS.indexOf('call get_legislation_status');
    expect(at).toBeGreaterThan(-1);
    expect(at).toBeLessThan(VISIBLE_BUDGET);
  });

  it('comes before the solicitation classes and before Potato P2', () => {
    const leg = MCP_CONNECTOR_INSTRUCTIONS.indexOf('LEGISLATION (check FIRST');
    expect(leg).toBeLessThan(MCP_CONNECTOR_INSTRUCTIONS.indexOf('KNOWN_ID —'));
    expect(leg).toBeLessThan(MCP_CONNECTOR_INSTRUCTIONS.indexOf('HISTORICAL —'));
    expect(leg).toBeLessThan(MCP_CONNECTOR_INSTRUCTIONS.indexOf('Potato P2 —'));
    expect(P2_FIRST_TURN_INSTRUCTIONS).toContain('LEGISLATION (check FIRST');
  });

  it('excludes the Federal Register tool and FIND for that intent, and forbids stating provisions', () => {
    expect(line).toMatch(/Not get_regulatory_demand/);
    expect(line).toMatch(/Not find_opportunities/);
    expect(line).toMatch(/not bill text/);
  });

  it('the full-text routing section repeats the rule for hosts that read past the top', () => {
    const primary = MCP_CONNECTOR_INSTRUCTIONS.slice(MCP_CONNECTOR_INSTRUCTIONS.indexOf('Finding opportunities (PRIMARY):'));
    expect(primary.split('\n').slice(1, 4).join(' ')).toMatch(/LEGISLATION is not a finding intent.*get_legislation_status/s);
  });

  it('P2 routing is preserved (order unchanged)', () => {
    const s = MCP_CONNECTOR_INSTRUCTIONS;
    const known = s.indexOf('KNOWN_ID —');
    const hist = s.indexOf('HISTORICAL —');
    const find = s.indexOf('CURRENT_FIND —');
    const value = s.indexOf('VALUE BEFORE QUALIFICATION');
    expect(known).toBeGreaterThan(-1);
    expect(known).toBeLessThan(hist);
    expect(hist).toBeLessThan(find);
    expect(find).toBeLessThan(value);
    expect(s).toContain("1. Call find_opportunities ONCE using the user's words");
  });
});

describe('neighbour boundaries — nobody else claims congressional bill status', () => {
  it('get_regulatory_demand: Federal Register only, NOT bills / NDAA / public law', () => {
    expect(describe_('get_regulatory_demand')).toMatch(/NOT congressional bills, NDAA status or public-law status: use get_legislation_status/);
  });
  it('get_agency_intel: agency-scoped; generic bill status goes to get_legislation_status', () => {
    expect(describe_('get_agency_intel')).toMatch(/for bill or NDAA status not tied to an agency, use get_legislation_status/);
  });
  it('get_current_acquisition_intelligence: procurement behavior, not bill status', () => {
    expect(describe_('get_current_acquisition_intelligence')).toMatch(/not congressional bill or NDAA status \(use get_legislation_status\)/);
  });
  it('get_legislation_status points agency / regulation / finding intents elsewhere', () => {
    const d = describe_('get_legislation_status');
    expect(d).toMatch(/NDAA/);
    expect(d).toMatch(/H\.R\./);
    expect(d).toMatch(/public law/i);
    expect(d).toMatch(/NOT bill text/);
    expect(d).toMatch(/Not for agency priorities \(use get_agency_intel\), Federal Register regulations \(use get_regulatory_demand\) or selling\/finding work \(use find_opportunities\)/);
  });
  it('every neighbour mention of "NDAA status" / "bill status" is a negation or a hand-off', () => {
    for (const name of ['get_regulatory_demand', 'get_agency_intel', 'get_current_acquisition_intelligence']) {
      const d = describe_(name);
      for (const m of d.matchAll(/(?:NDAA|bill) status/gi)) {
        const window = d.slice(Math.max(0, (m.index ?? 0) - 60), (m.index ?? 0) + 60);
        expect(window, `${name}: "${window}"`).toMatch(/\bnot\b|\bNOT\b|use get_legislation_status/);
      }
    }
  });
  it('costs 5 credits (scan floor)', () => {
    expect(creditsFor('get_legislation_status')).toBe(5);
  });
});

describe('stdio server carries the same tool and boundaries', () => {
  const src = readFileSync(join(process.cwd(), 'src/mcp/server.ts'), 'utf8');
  it('registers get_legislation_status', () => {
    expect(src).toMatch(/registerTool\(\s*'get_legislation_status'/);
  });
  it('neighbour descriptions carry the hand-off', () => {
    expect(src).toMatch(/NOT congressional bills, NDAA status or public-law status \(use get_legislation_status\)/);
    expect(src).toMatch(/not congressional bill or NDAA status \(use get_legislation_status\)/);
    expect(src).toMatch(/For bill or NDAA status not tied to an agency, use get_legislation_status/);
  });
});
