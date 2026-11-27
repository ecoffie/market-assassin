import { describe, it, expect } from 'vitest';
import { displaySourceLabel } from './source-label';
import { renderSbloContact } from './record-render';

describe('displaySourceLabel: no research date in a shown source label (stored text untouched)', () => {
  it('strips a leading or trailing month-year', () => {
    expect(displaySourceLabel('Jun 2026 research')).toBe('Mindy research');
    expect(displaySourceLabel('Company small business page, June 2026')).toBe('Company small business page');
    expect(displaySourceLabel('2026-06 roster')).toBe('roster');
    expect(displaySourceLabel('SAM.gov (Sept. 2026)')).toBe('SAM.gov');
  });
  it('keeps labels without a month-year, and never invents one for unknown', () => {
    expect(displaySourceLabel('USASpending (BigQuery, live)')).toBe('USASpending (BigQuery, live)');
    expect(displaySourceLabel('Supplier portal')).toBe('Supplier portal');
    expect(displaySourceLabel(null)).toBeNull();
    expect(displaySourceLabel('  ')).toBeNull();
  });
});

describe('the SBLO answer shows the source without its research date (chat and MCP)', () => {
  it('chat: "Source: Jun 2026 research" renders as "Source: Mindy research"', () => {
    const r = renderSbloContact({ contact: { company: 'Example Prime Inc', sblo_name: 'Pat Example', title: 'Small Business Liaison Officer', source: 'Jun 2026 research' }, _meta: {} });
    expect(r?.text).toContain('Source: Mindy research.');
    expect(r?.text).not.toMatch(/Jun 2026/);
  });
  it('MCP: get_sblo_contact returns the contact with the display label (stored text unchanged)', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(`${process.cwd()}/src/mcp/tools/sblo-contact.ts`, 'utf8');
    expect(src).toMatch(/contact: c \? \{ \.\.\.c, source: displaySourceLabel\(c\.source\) \} : null,/);
  });
});
