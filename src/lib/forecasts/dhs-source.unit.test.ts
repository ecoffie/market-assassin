/**
 * DHS body classification — fixtures from the live 2026-11-19 responses.
 * The JSON API is a migration notice. The public CSV was Akamai 403.
 * Neither is an empty forecast.
 */
import { describe, expect, it } from 'vitest';
import { classifyDhsBody } from './dhs-source';

const MIGRATION_HTML = `<!DOCTYPE html>
<html lang="en"><head><title>Notice | Acquisition Planning Forecast System</title></head>
<body><h1>Important Notice</h1>
<p>DHS Users Effective October 30, 2026 at 4pm ET, no new DHS procurement opportunities will be entered on this site.
Effective November 5, 2026, procurement opportunities should be entered at https://era-apfs.dhs.gov.
Industry On November 5, 2026, please go to Advance Acquisition Planning: Forecast of Contract Opportunities.</p>
</body></html>`;

const AKAMAI_403 = `<HTML><HEAD><TITLE>Access Denied</TITLE></HEAD><BODY>
<H1>Access Denied</H1>
You don't have permission to access "http://www.dhs.gov/xlibrary/daily-contract-opportunities-report/APFS_forecast_allRecords.csv" on this server.
Reference&#32;&#35;18.1278ce17.1795073767.140685f3
</BODY></HTML>`;

describe('classifyDhsBody', () => {
  it('treats the live migration notice as unreachable HTML, not zero rows', () => {
    const c = classifyDhsBody(200, MIGRATION_HTML);
    expect(c.kind).toBe('migration_html');
    if (c.kind === 'migration_html') expect(c.detail).toMatch(/era-apfs/);
  });

  it('treats the live Akamai 403 as access denied, not an empty file', () => {
    const c = classifyDhsBody(403, AKAMAI_403);
    expect(c.kind).toBe('access_denied');
  });

  it('keeps a real JSON array', () => {
    const c = classifyDhsBody(200, JSON.stringify([{ apfs_number: 'F123', requirements_title: 'Radios' }]));
    expect(c.kind).toBe('json_array');
    if (c.kind === 'json_array') expect(c.rows).toHaveLength(1);
  });

  it('an empty array is empty, never a successful quiet source', () => {
    expect(classifyDhsBody(200, '[]').kind).toBe('empty');
  });
});
