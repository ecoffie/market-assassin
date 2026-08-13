/**
 * Listing toolbar More is a utility dropdown, not a SAM / USASpending jump.
 *
 * Location stays Save · Share · Hide · More (top-right). View on SAM stays on the sticky
 * workflow bar. This guards the shipped route.ts so a future edit can't silently turn More
 * back into window.open(CUR.uiLink).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = readFileSync(join(__dirname, 'route.ts'), 'utf8');

describe('listing More — location stays in the top toolbar', () => {
  it('More sits in the top action row, immediately after Hide', () => {
    const hide = src.indexOf('id="oppHide"');
    const more = src.indexOf('id="oppMore"');
    const share = src.indexOf('id="oppShare"');
    expect(hide).toBeGreaterThan(-1);
    expect(more).toBeGreaterThan(hide);
    expect(share).toBeGreaterThan(-1);
    expect(hide).toBeGreaterThan(share);
    expect(more).toBeLessThan(src.indexOf("id=\"oppBody\""));
  });

  it('the sticky workflow bar still owns View on SAM and does not host More', () => {
    const start = src.indexOf('function actions(o){');
    expect(start).toBeGreaterThan(-1);
    const body = src.slice(start, start + 1600);
    expect(body).toContain('View on SAM');
    expect(body).toContain('Start pursuit');
    expect(body).toContain('Generate proposal');
    expect(body).not.toContain('oppMore');
    expect(body).not.toContain('Copy solicitation number');
  });
});

describe('listing More — interaction is a utility menu', () => {
  it('More opens a menu, not CUR.uiLink', () => {
    expect(src).toContain('id="oppMoreMenu"');
    expect(src).toContain('aria-haspopup="menu"');
    expect(src).toContain("function paintMoreMenu()");
    expect(src).not.toContain("window.open(CUR.uiLink,'_blank','noopener')");
  });

  it('menu items are copy sol, copy link, download documents, report', () => {
    expect(src).toContain('Copy solicitation number');
    expect(src).toContain('Copy opportunity link');
    expect(src).toContain('Download documents');
    expect(src).toContain('Report incorrect information');
    expect(src).toContain("data-more=\"copy-sol\"");
    expect(src).toContain("data-more=\"copy-link\"");
    expect(src).toContain("data-more=\"docs\"");
    expect(src).toContain("data-more=\"report\"");
  });

  it('Download documents is omitted until attachments exist; copy-sol is omitted without a number', () => {
    expect(src).toMatch(/docs\.length\?'<button class="oppmore-item"[^>]*data-more="docs">Download documents/);
    expect(src).toMatch(/sol\?'<button class="oppmore-item"[^>]*data-more="copy-sol">Copy solicitation number/);
  });

  it('Escape closes the menu before the drawer', () => {
    expect(src).toMatch(/if\(e\.key==='Escape'\)\{\s*if\(moreMenuOpen\(\)\)\{\s*closeMoreMenu\(\)/);
  });

  it('report logs listing_report and mails hello@getmindy.ai — no native alert', () => {
    expect(src).toMatch(/__track\('tool_use','listing_report'/);
    expect(src).toContain('mailto:hello@getmindy.ai');
    const moreBlock = src.slice(src.indexOf('function paintMoreMenu()'), src.indexOf('function esc(s)'));
    expect(moreBlock).not.toContain('alert(');
  });
});
