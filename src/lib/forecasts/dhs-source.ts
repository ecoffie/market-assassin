/**
 * What a DHS forecast HTTP body actually is.
 *
 * Measured 2026-11-19: `https://apfs-cloud.dhs.gov/api/forecast/` returns HTTP 200
 * HTML, not JSON. The page says no new opportunities are entered there after
 * 2026-10-30 and points industry at era-apfs.dhs.gov (that host does not resolve)
 * and at the public DHS.gov forecast page. The allRecords CSV on www.dhs.gov
 * returned Akamai 403 from a datacenter network. An HTML 200 and a 403 are
 * both unreachable — never an empty forecast list.
 */

export type DhsBodyClass =
  | { kind: 'json_array'; rows: unknown[] }
  | { kind: 'migration_html'; detail: string }
  | { kind: 'access_denied'; detail: string }
  | { kind: 'empty'; detail: string }
  | { kind: 'unreadable'; detail: string };

export function classifyDhsBody(status: number, body: string): DhsBodyClass {
  const trimmed = (body ?? '').trim();
  const denied =
    status === 401 ||
    status === 403 ||
    (/access denied/i.test(trimmed) && /permission|akamai|edgesuite|reference\s*#/i.test(trimmed));
  if (denied) {
    return {
      kind: 'access_denied',
      detail: `HTTP ${status} — DHS forecast file was denied (not an empty forecast)`,
    };
  }
  if (!trimmed) return { kind: 'empty', detail: 'DHS forecast body was empty' };

  const looksHtml =
    /^<!DOCTYPE\s+html/i.test(trimmed) ||
    /^<html[\s>]/i.test(trimmed) ||
    /<title>[^<]*Acquisition Planning Forecast System/i.test(trimmed);
  if (looksHtml) {
    const moved = /era-apfs\.dhs\.gov/i.test(trimmed);
    return {
      kind: 'migration_html',
      detail: moved
        ? 'apfs-cloud returned the APFS migration notice (points at era-apfs.dhs.gov), not JSON'
        : 'DHS forecast response was HTML, not JSON',
    };
  }

  try {
    const data = JSON.parse(trimmed) as unknown;
    if (!Array.isArray(data)) {
      return { kind: 'unreadable', detail: 'DHS JSON was not an array' };
    }
    if (data.length === 0) {
      return { kind: 'empty', detail: 'DHS JSON array had 0 rows' };
    }
    return { kind: 'json_array', rows: data };
  } catch {
    return { kind: 'unreadable', detail: 'DHS body was not JSON' };
  }
}
