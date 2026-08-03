/**
 * Guards the saved-search "Run report" PEEK workflow.
 *
 * Eric, 2026-08-02: "it is inline so not useful to see the whole report. We need a new
 * workflow for this." The card must show a COMPACT confirmation (report ready + counts)
 * with ONE big primary "Open full report" that opens the hosted /reports/<id> page in a
 * new tab — NOT re-render the full KPI dashboard inline. This test locks that shape so a
 * future edit can't silently regress it back to the inline report.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SAVED = readFileSync(join(process.cwd(), 'src/app/opportunity-map/saved/route.ts'), 'utf8');

describe('the Run-report result is a PEEK, not the inline report', () => {
  it('renders a "Report ready" confirmation, not a 4-KPI dashboard', () => {
    expect(SAVED).toContain('Report ready');
    // The old inline dashboard grid + its contacts preview are gone.
    expect(SAVED).not.toContain('class="rptkpi"');
    expect(SAVED).not.toContain('contactsPeek');
  });

  it('the primary action is a big "Open full report" link to the hosted report', () => {
    expect(SAVED).toContain('Open full report');
    // It opens the saved /reports/<id> URL in a new tab (the capability-URL page).
    expect(SAVED).toMatch(/class="rgo" href="'\+rptEsc\(d\.url\)[\s\S]{0,60}target="_blank"/);
  });

  it('keeps a copy-share-link so the peek can still be shared (the flywheel)', () => {
    expect(SAVED).toContain('Copy share link');
  });

  it('is honest when the report generated but the share link could not be saved', () => {
    // d.url absent → no dead "Open" button; explain instead of asserting a broken link.
    expect(SAVED).toContain('var hasUrl = !!d.url;');
    expect(SAVED).toMatch(/hasUrl[\s\S]{0,400}couldn/);
  });
});
