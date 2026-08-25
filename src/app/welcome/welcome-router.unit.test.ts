/**
 * /welcome — the intent ROUTER. Three choices, all real, none a gate.
 *
 * The router must not SWALLOW intent: a user can arrive carrying a `next` (an OAuth signup
 * whose destination was unusable, or someone routed here from a Maps action). Choosing
 * "Explore the market" should return them THERE, not to a generic map.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const src = readFileSync('src/app/welcome/page.tsx', 'utf8');
const code = src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
                .replace(/^([^\n]*?)\/\/.*$/gm, '$1');

describe('the three choices point at surfaces that EXIST', () => {
  it.each([
    ['/opportunity-map', 'Explore the market'],
    ['/mcp/setup', 'Connect Mindy'],
    ['/welcome/company', 'Personalize'],
  ])('%s is wired', (href) => {
    expect(code).toContain(`'${href}'`);
  });

  it('no longer points company setup at a placeholder query param', () => {
    // It was /opportunity-map?setup=company before /welcome/company existed.
    expect(code).not.toContain('setup=company');
  });

  it('the MCP choice goes to SETUP, not the marketing page', () => {
    // Someone who came to connect should land in setup, not be sold to again.
    expect(code).toContain("'/mcp/setup'");
  });
});

describe('intent survives the router', () => {
  it('validates an incoming next rather than trusting it', () => {
    expect(code).toContain('safeNext(');
  });

  it('the Map choice honours the original next', () => {
    expect(code).toContain('mapHref');
  });

  it('company setup CARRIES next, so the user lands back where they were headed', () => {
    expect(code).toContain('carry');
    expect(code).toMatch(/next=\$\{encodeURIComponent/);
  });

  it('MCP does NOT inherit an old next — it is a new intent the user just expressed', () => {
    const block = code.slice(code.indexOf('c.href ==='), code.indexOf('c.href ===') + 300);
    expect(block).not.toMatch(/mcp[^]*carry/);
  });
});

describe('it stays a router, not an onboarding gate', () => {
  it('every choice is a LINK — nothing blocks or submits', () => {
    expect(code).not.toMatch(/<form|onSubmit|required/);
  });

  it('keeps the skip-style escape hatch', () => {
    expect(code).toMatch(/Just show me the map/);
  });

  it('no /app or /briefings anywhere', () => {
    expect(code).not.toMatch(/['"]\/app/);
    expect(code).not.toMatch(/\/briefings/);
  });

  it('is not indexed — a post-signup router has no business in search', () => {
    expect(code).toMatch(/robots:\s*\{\s*index:\s*false/);
  });
});
