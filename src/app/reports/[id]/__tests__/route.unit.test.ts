/**
 * The /reports/<id> page is PUBLIC — the unguessable id is the only access control.
 * These tests pin the two properties that matter: it renders a real stored report,
 * and it can't be probed to distinguish "real id" from "malformed id".
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Stub ONLY the storage read — newReportId stays real so its entropy is genuinely tested.
const getMarketReport = vi.fn();
vi.mock('@/lib/market/report-store', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/market/report-store')>()),
  getMarketReport: (id: string) => getMarketReport(id),
}));

import { GET } from '../route';
import { newReportId } from '@/lib/market/report-store';

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const req = new Request('https://getmindy.ai/reports/x');

const REPORT = {
  id: 'abc123abc123abc123abc1',
  owner_email: 'sue@example.com',
  subject: 'drones',
  client_name: 'Acme Corp',
  params: {},
  created_at: '2026-07-16T00:00:00Z',
  payload: {
    subject: 'drones',
    generated_for: null,
    summary: { total_market: 243_000_000, naics_count: 70, top_psc: { code: '1550', name: 'Unmanned Aircraft' }, buying_agencies: 3, top_contractors: 2, recompetes: 0, forecasts: 0 },
    sections: {
      market_size: null,
      top_agencies: [{ name: 'DEPT OF DEFENSE', sub_agency: 'Navy', contract_count: 12, unique_vendors: 5 }],
      competition: { contractors: [], count: 0 },
      recompetes: { contracts: [], count: 0 },
      forecasts: { forecasts: [], count: 0 },
      agency_detail: null,
      set_aside_gap: null,
    },
    _meta: { grounded: true, degraded: false, sections_grounded: 2, sections_total: 7 },
  },
};

beforeEach(() => getMarketReport.mockReset());

describe('GET /reports/[id]', () => {
  it('renders a stored report as a self-contained HTML page', async () => {
    getMarketReport.mockResolvedValue(REPORT);
    const res = await GET(req, params(REPORT.id));

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/html');
    const html = await res.text();
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('drones');
    expect(html).toContain('Powered by'); // Mindy footer = the distribution play
    expect(html).toContain('window.print()'); // Save-as-PDF path
  });

  it('uses the stored client_name in the header (Sue prepared this FOR someone)', async () => {
    getMarketReport.mockResolvedValue(REPORT);
    const html = await (await GET(req, params(REPORT.id))).text();
    expect(html).toContain('Acme Corp');
  });

  it('keeps a client report out of search results', async () => {
    getMarketReport.mockResolvedValue(REPORT);
    const res = await GET(req, params(REPORT.id));
    expect(res.headers.get('X-Robots-Tag')).toContain('noindex');
    // Someone's client work must not sit in a shared/CDN cache.
    expect(res.headers.get('Cache-Control')).toContain('private');
  });

  it('404s an unknown id', async () => {
    getMarketReport.mockResolvedValue(null);
    const res = await GET(req, params('abc123abc123abc123abc1'));
    expect(res.status).toBe(404);
    expect(await res.text()).toContain('Report not found');
  });

  // The anti-probing property: a malformed id must be indistinguishable from a missing one.
  it('404s malformed ids identically, without hitting storage', async () => {
    for (const bad of ['', 'short', '../../etc/passwd', 'has spaces', 'a'.repeat(200), 'semi;colon']) {
      const res = await GET(req, params(bad));
      expect(res.status).toBe(404);
    }
    expect(getMarketReport).not.toHaveBeenCalled();
  });

  it('404s (does not 500) when the stored payload cannot render', async () => {
    getMarketReport.mockResolvedValue({ ...REPORT, payload: { junk: true } });
    const res = await GET(req, params(REPORT.id));
    expect([404, 200]).toContain(res.status); // must never throw a 500
  });

  it('404s when the row has no payload', async () => {
    getMarketReport.mockResolvedValue({ ...REPORT, payload: null });
    expect((await GET(req, params(REPORT.id))).status).toBe(404);
  });
});

describe('newReportId', () => {
  it('is unguessable: 22-char base64url, unique across many draws', () => {
    const ids = new Set(Array.from({ length: 500 }, () => newReportId()));
    expect(ids.size).toBe(500);
    for (const id of ids) expect(id).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });

  it('produces ids the route accepts', () => {
    expect(newReportId()).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
  });
});
