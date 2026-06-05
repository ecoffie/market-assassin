/**
 * Refresh the dodaac_directory reference table from BigQuery awards
 * (FPDS office names). Single source of truth — used by both the cron route
 * (/api/cron/refresh-dodaac-directory, fired by the dispatcher) and the
 * standalone script (scripts/populate-dodaac-directory.mjs).
 */
import { createClient } from '@supabase/supabase-js';
import { bqQuery, BQ_TABLES } from '@/lib/bigquery/client';

// Strip a leading copy of the code from FPDS names ("FA7000  10 CONS LGC").
function cleanName(code: string, raw: string): string {
  let n = (raw || '').trim();
  if (n.toUpperCase().startsWith(code.toUpperCase())) n = n.slice(code.length).trim();
  return n || raw || code;
}

export async function refreshDodaacDirectory(): Promise<{ offices: number; written: number }> {
  const rows = await bqQuery<{
    dodaac: string; office_name: string; agency: string | null;
    sub_agency: string | null; award_count: number; total_obligated: number;
  }>({
    query: `
      SELECT
        awarding_office_code AS dodaac,
        ANY_VALUE(awarding_office) AS office_name,
        ANY_VALUE(awarding_agency) AS agency,
        ANY_VALUE(awarding_sub_agency) AS sub_agency,
        COUNT(*) AS award_count,
        SUM(obligation_amount) AS total_obligated
      FROM ${BQ_TABLES.awards}
      WHERE awarding_office_code IS NOT NULL
        AND awarding_office IS NOT NULL
        AND LENGTH(awarding_office_code) = 6
      GROUP BY awarding_office_code
      HAVING award_count > 0
    `,
    maximumBytesBilled: String(20 * 1024 * 1024 * 1024),
  });

  const records = rows.map(r => ({
    dodaac: r.dodaac,
    office_name: cleanName(r.dodaac, r.office_name),
    agency: r.agency || null,
    sub_agency: r.sub_agency || null,
    award_count: Number(r.award_count || 0),
    total_obligated: Number(r.total_obligated || 0),
    source: 'fpds_awards',
    updated_at: new Date().toISOString(),
  }));

  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  let written = 0;
  for (let i = 0; i < records.length; i += 500) {
    const batch = records.slice(i, i + 500);
    const { error } = await sb.from('dodaac_directory').upsert(batch, { onConflict: 'dodaac' });
    if (error) throw new Error(`dodaac upsert: ${error.message}`);
    written += batch.length;
  }
  return { offices: rows.length, written };
}
