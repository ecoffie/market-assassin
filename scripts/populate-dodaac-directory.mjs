/**
 * Populate dodaac_directory from BigQuery awards.awarding_office (FPDS).
 * The authoritative office NAME per DoDAAC CODE — so the app shows
 * "10th Contracting Squadron" instead of "FA7000".
 *
 * Run: node scripts/populate-dodaac-directory.mjs
 * Re-run periodically (names/offices change slowly). Idempotent (upsert).
 */
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { BigQuery } from '@google-cloud/bigquery';

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const raw = process.env.GCP_SA_JSON.trim();
let creds;
try { creds = JSON.parse(raw); } catch { creds = JSON.parse(Buffer.from(raw, 'base64').toString('utf8')); }
const bq = new BigQuery({ projectId: creds.project_id, credentials: creds });

// Clean up FPDS office names: they often prefix the code or have ALL CAPS.
function cleanName(code, raw) {
  let n = (raw || '').trim();
  // strip a leading copy of the code (e.g. "FA7000  10 CONS LGC" → "10 CONS LGC")
  if (n.toUpperCase().startsWith(code.toUpperCase())) n = n.slice(code.length).trim();
  // also strip a leading short alt-code token (e.g. "W7N2 USPFO..." keep as-is, it's informative)
  return n || raw || code;
}

async function main() {
  console.log('Querying BigQuery for DoDAAC → office names…');
  // One pass: every awarding_office_code with its name + scale. ~2 GB scan.
  const query = `
    SELECT
      awarding_office_code AS dodaac,
      ANY_VALUE(awarding_office) AS office_name,
      ANY_VALUE(awarding_agency) AS agency,
      ANY_VALUE(awarding_sub_agency) AS sub_agency,
      COUNT(*) AS award_count,
      SUM(obligation_amount) AS total_obligated
    FROM \`market-assasin.usaspending.awards\`
    WHERE awarding_office_code IS NOT NULL
      AND awarding_office IS NOT NULL
      AND LENGTH(awarding_office_code) = 6
    GROUP BY awarding_office_code
    HAVING award_count > 0
  `;
  const [rows] = await bq.query({ query, maximumBytesBilled: String(20 * 1024 ** 3) });
  console.log(`Got ${rows.length} DoDAAC offices from FPDS.`);

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

  // Upsert in batches.
  let written = 0;
  for (let i = 0; i < records.length; i += 500) {
    const batch = records.slice(i, i + 500);
    const { error } = await sb.from('dodaac_directory').upsert(batch, { onConflict: 'dodaac' });
    if (error) { console.error('batch error:', error.message); break; }
    written += batch.length;
    if (i % 5000 === 0) console.log(`  …${written}/${records.length}`);
  }
  console.log(`✅ Upserted ${written} DoDAAC office names.`);

  // sanity: show the codes from Eric's screenshot
  const { data } = await sb.from('dodaac_directory').select('dodaac, office_name').in('dodaac', ['FA7000', 'W50S76', 'FA3022', 'W912J3', 'N00104']);
  console.log('sample:', JSON.stringify(data));
}

main().catch(e => { console.error(e); process.exit(1); });
