import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { linkExpiryNote, buildHint } from './market-report';

/** Report sharing PR 2: MCP output and catalog text carry the link's expiry and the owner controls. */
describe('linkExpiryNote', () => {
  it('names the UTC date and the owner controls', () => {
    expect(linkExpiryNote('2027-02-20T23:30:00.000Z')).toBe(' The link expires on February 20, 2027; the owner can extend or revoke it in Mindy.');
  });
  it('says nothing for no expiry or a bad value (never invents a date)', () => {
    expect(linkExpiryNote(null)).toBe('');
    expect(linkExpiryNote(undefined)).toBe('');
    expect(linkExpiryNote('soon')).toBe('');
  });
});

describe('the AI hint tells the host when the link expires', () => {
  const base = {
    subject: 'widgets',
    summary: { total_market: 1_000_000, naics_count: 3, buying_agencies: 2, top_contractors: 4, recompetes: 1, forecasts: 0 },
    _meta: { degraded: false, sections_grounded: 3 },
  };
  it('with a link and an expiry: summary and how_to_use name the date and the owner controls', () => {
    const h = buildHint({ ...base, deliverable: { html: '<p/>', url: 'https://getmindy.ai/reports/abc', report_id: 'abc', expires_at: '2027-02-20T00:00:00.000Z' } } as never);
    expect(h.summary).toContain('Shareable report: https://getmindy.ai/reports/abc The link expires on February 20, 2027');
    expect(h.how_to_use).toContain('with a Download PDF link. The link expires on February 20, 2027; the owner can extend or revoke it in Mindy.');
    expect(h.how_to_use).not.toContain('Save-as-PDF');
  });
  it('a link without an expiry (saved before the migration) claims no date', () => {
    const h = buildHint({ ...base, deliverable: { html: '<p/>', url: 'https://getmindy.ai/reports/abc', report_id: 'abc', expires_at: null } } as never);
    expect(h.summary).not.toContain('expires');
    expect(h.how_to_use).not.toContain('expires on');
  });
});

describe('catalog descriptions (both registration paths)', () => {
  const registry = readFileSync(join(process.cwd(), 'src/lib/mcp/tool-registry.ts'), 'utf8');
  const server = readFileSync(join(process.cwd(), 'src/mcp/server.ts'), 'utf8');
  it('tool-registry describes the 90-day expiry, expires_at and the owner controls; no print-dialog promise', () => {
    const at = registry.indexOf("name: 'generate_market_report'");
    const desc = registry.slice(at, registry.indexOf('parameters:', at));
    expect(desc).toContain('expires');
    expect(desc).toContain('after 90 days (deliverable.expires_at)');
    expect(desc).toContain('extend or revoke it in Mindy');
    expect(desc).not.toContain('Save-as-PDF');
  });
  it('server.ts zod registration says the same', () => {
    const at = server.indexOf("'generate_market_report',");
    const desc = server.slice(at, server.indexOf('inputSchema:', at));
    expect(desc).toContain('expires after 90 days');
    expect(desc).toContain('deliverable.expires_at');
    expect(desc).toContain('extend or revoke it in Mindy');
  });
});
