import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// /contractors scrolled sideways on phones (2026-11-21).
//
// Each tier's contractor list is a CSS grid that only declared columns from `sm:` up. Below 640px
// the grid had NO column template, so its single implicit column was sized `auto` — and every
// company name is `truncate` (white-space:nowrap), whose min-content is the whole name. The column
// therefore grew to the longest name ("OPTUM PUBLIC SECTOR SOLUTIONS INC" …): measured 709px of
// page on a 390px iPhone 13, the names never truncated, and the page's fixed overlays — the Nov 28
// event pop-up — centred on the wider layout, putting its close button off-screen.
//
// `grid-cols-1` is repeat(1, minmax(0, 1fr)): the column may shrink to the screen, so `truncate`
// works. After: scrollWidth == viewport on iPhone SE / 13 and Pixel 7; 2 cols at 768, 3 at 1366.

const page = readFileSync(join(__dirname, 'page.tsx'), 'utf8');

/** className of the nearest <ul> opening tag before the truncated company name. */
function listClassName(): string {
  const at = page.indexOf('truncate block');
  expect(at, 'company-name span with `truncate block` not found').toBeGreaterThan(-1);
  const ulAt = page.lastIndexOf('<ul ', at);
  expect(ulAt, 'no <ul> wraps the company names').toBeGreaterThan(-1);
  const m = page.slice(ulAt, at).match(/<ul className="([^"]+)"/);
  expect(m, 'the contractor <ul> has no static className').toBeTruthy();
  return m![1];
}

describe('/contractors list fits a phone screen', () => {
  it('the grid declares a shrinkable base column, so nowrap names truncate instead of widening the page', () => {
    const cls = listClassName().split(/\s+/);
    expect(cls).toContain('grid');
    // A base (unprefixed) column template must exist; without one the implicit column is `auto`.
    expect(cls).toContain('grid-cols-1');
  });

  it('keeps the wider-screen layout (2 columns from sm, 3 from lg)', () => {
    const cls = listClassName().split(/\s+/);
    expect(cls).toContain('sm:grid-cols-2');
    expect(cls).toContain('lg:grid-cols-3');
  });
});
