import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminPassword } from '@/lib/admin-auth';
import { getReadClient } from '@/lib/supabase/server-clients';
import { fetchAllPaged } from '@/lib/supabase/paged-read';
import { easternDate } from '@/lib/admin/date-range';
import {
  NEW_REGISTRANT_COLUMNS,
  resolveRegistrantRange,
  toRegistrantCsv,
  type NewRegistrantRow,
} from '@/lib/sam/new-registrants';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * GET /api/admin/new-sam-registrants?password=…[&from=YYYY-MM-DD][&to=YYYY-MM-DD][&format=json]
 *
 * Businesses whose FIRST SAM.gov registration falls in [from, to] (default: last 7 days),
 * as a spreadsheet (CSV download). Grants-only registrants (Z1) are excluded. No emails:
 * SAM's public data does not carry them.
 *
 * Read-only. Rows exist only after migration 20261123_sam_entities_registration_dates.sql is
 * applied AND the extract import has re-run; until then the list is honestly empty.
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  if (!verifyAdminPassword(sp.get('password'))) {
    return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
  }

  const range = resolveRegistrantRange(sp.get('from'), sp.get('to'), easternDate(Date.now()));
  if ('error' in range) {
    return NextResponse.json({ success: false, message: range.error }, { status: 400 });
  }

  let rows: NewRegistrantRow[];
  try {
    const sb = getReadClient();
    rows = await fetchAllPaged<NewRegistrantRow>(() =>
      sb
        .from('sam_entities')
        .select(NEW_REGISTRANT_COLUMNS.join(','))
        .gte('initial_registration_date', range.from)
        .lte('initial_registration_date', range.to)
        .or('purpose_of_registration.is.null,purpose_of_registration.neq.Z1')
        .order('initial_registration_date', { ascending: false })
        .order('uei', { ascending: true }),
    );
  } catch (err) {
    // A missing column (migration not applied) or a DB error is NOT an empty list.
    return NextResponse.json(
      { success: false, message: `Could not read new registrants: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 },
    );
  }

  if (sp.get('format') === 'json') {
    return NextResponse.json({ success: true, message: `${rows.length} new registrants`, data: { ...range, count: rows.length, rows } });
  }

  return new NextResponse(toRegistrantCsv(rows), {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="new-sam-registrants-${range.from}-to-${range.to}.csv"`,
      'Cache-Control': 'no-store',
      'X-Row-Count': String(rows.length),
    },
  });
}
