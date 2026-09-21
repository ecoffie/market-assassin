/**
 * The return-brief strip — invariants that live in the SERVED map, not in a lib.
 *
 * `template.html` is the SOURCE and `template-html.ts` is what the route actually serves,
 * so both are asserted: a change that lands in one and not the other reaches production
 * as nothing at all (the exact class the pre-push gate caught on #1601).
 *
 * The three invariants, each the render-side half of a rule the server enforces:
 *   1. the sentence is the SERVER's (`brief.line`) — the client never counts
 *   2. an empty line renders nothing — never "no changes", which 59% of returners would see
 *   3. a closed-listing CTA is `?opp=<id>` alone — a record link carries nothing that
 *      could exclude the record, and every listing in that class is past its deadline
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROUTE = readFileSync(join(__dirname, 'route.ts'), 'utf8');
const TEMPLATE = readFileSync(join(__dirname, 'template.html'), 'utf8');
const SERVED = readFileSync(join(__dirname, 'template-html.ts'), 'utf8');

/** Just the strip's own <script> IIFE, so assertions cannot be satisfied by other blocks. */
const BLOCK = (() => {
  const start = ROUTE.indexOf('const RETURN_BRIEF_JS');
  expect(start).toBeGreaterThan(-1);
  const end = ROUTE.indexOf('</script>`;', start);
  expect(end).toBeGreaterThan(start);
  return ROUTE.slice(start, end);
})();

describe('the strip reaches production', () => {
  it('its container exists in the template SOURCE', () => {
    expect(TEMPLATE).toContain('id="retBrief"');
    expect(TEMPLATE).toContain('class="retbrief"');
  });

  it('and in the generated file the route actually SERVES', () => {
    // template-html.ts is generated from template.html; forgetting to regenerate means
    // the container never ships and the strip silently never renders.
    expect(SERVED).toContain('id=\\"retBrief\\"');
  });

  it('is injected into the page body', () => {
    expect(ROUTE).toMatch(/const bodyInject[\s\S]{0,600}RETURN_BRIEF_JS/);
  });

  it('starts hidden, so nothing paints before the brief is known', () => {
    expect(TEMPLATE).toMatch(/id="retBrief"\s+hidden/);
  });
});

describe('the client never decides whether there is news', () => {
  it('renders the SERVER-built sentence', () => {
    expect(BLOCK).toContain('b.line');
  });

  it('renders NOTHING when there is no line — no "no changes" fallback', () => {
    expect(BLOCK).toMatch(/if\(!b \|\| !b\.isReturn \|\| !b\.line\) return;/);
    for (const forbidden of ['No changes', 'no changes', 'Nothing changed', 'nothing new', 'All caught up']) {
      expect(BLOCK).not.toContain(forbidden);
    }
  });

  it('only a MEASURED class contributes a count — an unknown/no_basis class cannot render one', () => {
    expect(BLOCK).toContain("b.newInMarket.state==='measured'");
    expect(BLOCK).toContain("b.listingClosed.state==='measured'");
    // and a zero never earns a CTA
    expect(BLOCK).toContain('b.newInMarket.count>0');
  });

  it('a failed fetch renders nothing rather than a fabricated calm', () => {
    expect(BLOCK).toMatch(/\.catch\(function\(\)\{[^}]*\}\)/);
    expect(BLOCK).toContain('r.ok?r.json():null');
  });
});

describe('record links vs market links', () => {
  it('a closed listing links by notice id ALONE', () => {
    expect(BLOCK).toContain("'/opportunity-map?opp='+encodeURIComponent(ls[i].noticeId)");
  });

  it('the record link is never built with scope params', () => {
    // The daily-alert incident (PR #1441): profile scope on a per-record CTA emptied the
    // map. Here it would be worse — a closed listing fails any status/deadline filter.
    const recordLine = BLOCK.split('\n').filter((l) => l.includes('?opp=')).join('\n');
    for (const forbidden of ['naics', 'state', 'agency', 'subAgency', 'setAside', 'status']) {
      expect(recordLine).not.toContain(forbidden + '=');
    }
  });

  it('the market link is the SERVER-built one, not re-derived in the browser', () => {
    // If the client assembled its own query string the destination could disagree with
    // the count that sent the user there.
    expect(BLOCK).toContain('b.newInMarket.detail.link');
    expect(BLOCK).not.toMatch(/'\/opportunity-map\?naics='/);
  });
});

describe('identity and safety', () => {
  it('serves anonymous visitors through the documented cross-block bridge', () => {
    // 219 of 414 returners have no account; this block is its own IIFE and cannot see
    // the map's `_anonId` closure.
    expect(BLOCK).toContain('window.__anonId');
    expect(BLOCK).toContain('anonId=');
  });

  it('escapes everything it injects — titles come from SAM, not from us', () => {
    expect(BLOCK).toMatch(/function esc\(/);
    expect(BLOCK).toContain('esc(b.line)');
    expect(BLOCK).toContain('esc(acts[k].label)');
    expect(BLOCK).toContain('esc(acts[k].href)');
  });

  it('never writes — no pursuit, no shortlist, no save', () => {
    for (const forbidden of ['/api/pipeline', '/api/app/shortlist', "method:'POST'", 'method: \'POST\'']) {
      expect(BLOCK).not.toContain(forbidden);
    }
  });

  it('emits telemetry that can tell "showed nothing" from "had nothing"', () => {
    expect(BLOCK).toContain('return_brief_shown');
    expect(BLOCK).toContain('new_state');
    expect(BLOCK).toContain('closed_state');
    expect(BLOCK).toContain('return_brief_click');
  });
});
