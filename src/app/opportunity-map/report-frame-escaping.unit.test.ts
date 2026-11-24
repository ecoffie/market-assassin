/**
 * What goes into the Map's same-origin report preview frame is only our renderers' output, and every user or
 * model string in it is escaped (Agent 4 review of the preview-scroll change, 2026-11-22).
 *
 * The frame is sandbox="allow-same-origin" (no scripts, forms, popups or navigation) so the pane can size it.
 * Same origin means a live <meta http-equiv="refresh">, <img src="/api/...">, <base> or <form> inside it
 * would act with our cookies. These hostile strings are put into every field that carries customer or
 * model text, and must come out as inert text. The Map additionally injects a request-blocking CSP and
 * strips refresh/base tags (ask-report-pane-export.unit.test.ts), so this is the first of two layers.
 */
import { describe, it, expect } from 'vitest';
import { renderMarketReportHtml } from '@/lib/market/market-report-html';
import { renderHtml } from '@/lib/documents/render-html';
import { SAMPLE_REPORT } from '@/lib/documents/__fixtures__/sample-report';
import type { DocModel } from '@/lib/documents/model';

const HOSTILE = [
  '<meta http-equiv="refresh" content="0;url=/api/app/chat-sessions?email=a@b.c">',
  '<img src="/api/app/vault/documents/download?id=1">',
  '<base href="https://evil.example/">',
  '<form action="/api/app/vault/documents" method="post"><input name="x"></form>',
  '<script>alert(1)</script>',
  '<a href="javascript:alert(1)">x</a>',
  '<iframe src="/api/x"></iframe>',
  '<link rel="prefetch" href="/api/x">',
  '<style>@import "/api/x";</style>',
  '"><svg onload=alert(1)>',
];
const ALL = HOSTILE.join(' ');

/** No live element of these kinds, and no attribute-injection, anywhere in the document. */
function expectInert(html: string) {
  // Escaped text inside a quoted attribute value (e.g. a chart's aria-label) is inert; remove quoted values
  // first. An unescaped quote breaking out of an attribute would leave its markup outside and still match.
  const outside = html.replace(/"[^"]*"/g, '""');
  const live = [
    /<meta[^>]+http-equiv\s*=\s*["']?refresh/i,
    /<img[^>]+src\s*=\s*["']?\/api/i,
    /<base\b/i,
    /<form\b/i,
    /<script\b/i,
    /<iframe\b/i,
    /<link[^>]+href\s*=\s*["']?\/api/i,
    /@import\s+["']\/api/i,
    /<svg[^>]*onload/i,
    /href\s*=\s*["']?javascript:/i,
  ];
  for (const re of live) expect(outside, String(re)).not.toMatch(re);
  // ...and the text is still there, escaped (so it was rendered, not silently dropped).
  expect(html).toContain('&lt;meta http-equiv=');
}

describe('market report html: customer and model text never becomes live markup', () => {
  it('subject, client, contractor, agency, description, forecast and contact fields are all escaped', () => {
    const html = renderMarketReportHtml({
      subject: ALL,
      generated_at: '2026-11-22T00:00:00Z',
      generated_for: ALL,
      client_name: ALL,
      summary: { subject: ALL, total_market: 1_000_000, naics_count: 1, top_psc: { code: 'Z1', name: ALL }, buying_agencies: 1, top_contractors: 1, recompetes: 1, forecasts: 1 },
      sections: {
        market_size: null,
        top_agencies: [{ name: ALL, sub_agency: ALL, contract_count: 1, unique_vendors: 1, amount: 1 }],
        competition: { contractors: [{ name: ALL, uei: ALL, amount: 1 }], count: 1 },
        recompetes: { contracts: [{ incumbent_name: ALL, piid: ALL, description: ALL, awarding_sub_agency: ALL, naics_code: ALL, potential_total_value: 1, period_of_performance_current_end: ALL, recompete_likelihood: ALL }], count: 1 },
        forecasts: { forecasts: [{ title: ALL, incumbent_name: ALL, agency: ALL, naics_code: ALL, value_range: ALL, fiscal_year: ALL, quarter: ALL, set_aside_type: ALL }], count: 1 },
        contacts: { people: [{ name: ALL, role: ALL, email: 'a@b.c', office: ALL }], count: 1 },
        agency_detail: null,
        set_aside_gap: null,
      },
      _meta: { degraded: false, sections_grounded: 4, sections_total: 7 },
    } as never);
    expectInert(html);
  });
});

describe('Vault document preview html: customer and model text never becomes live markup', () => {
  it('title, subtitle, prepared-for, headings, paragraphs, callouts, bullets and source labels are all escaped', () => {
    const m = JSON.parse(JSON.stringify(SAMPLE_REPORT)) as DocModel & Record<string, unknown>;
    m.title = ALL;
    m.subtitle = ALL;
    m.preparedFor = ALL;
    m.sources = m.sources.map((s) => ({ ...s, label: ALL }));
    for (const sec of m.sections as Array<{ heading: string; blocks: Array<Record<string, unknown>> }>) {
      sec.heading = ALL;
      for (const b of sec.blocks) {
        if (typeof b.text === 'string') b.text = ALL;
        if (Array.isArray(b.items)) b.items = (b.items as Array<Record<string, unknown>>).map((it) => ({ ...it, text: ALL }));
        if (typeof b.caption === 'string') b.caption = ALL;
      }
    }
    expectInert(renderHtml(m as DocModel, { screen: true }));
  });
});
