/**
 * Submit subaward bulk_download jobs to USASpending for the MVP scope:
 *   top 10 awarding agencies × FY2021-FY2026 procurement subawards only.
 *
 * Writes a job manifest to GCS at gs://${BUCKET}/manifest/subawards.json.
 * The Cloud Run worker reads that manifest and processes one (agency, FY)
 * pair per task.
 *
 * Why submit all 50 upfront before the worker starts polling:
 *   USASpending queues the jobs server-side. Submitting them all
 *   immediately maximizes their parallelism. Each individual job
 *   takes ~10-25 min to generate (DoD is the longest at ~22 min).
 *
 * Run locally with ADC: node scripts/usaspending-subaward-ingest/submit-jobs.js
 */
import { Storage } from '@google-cloud/storage';

const PROJECT_ID = 'market-assasin';
const BUCKET = 'market-assasin-usaspending-staging';
const MANIFEST_PATH = 'manifest/subawards.json';

// Top 10 federal procurement agencies by FY24 spend. toptier_code lookups
// confirmed via /api/v2/references/toptier_agencies/ on 2026-05-29.
const AGENCIES = [
  { code: '097', name: 'Department of Defense' },
  { code: '070', name: 'Department of Homeland Security' },
  { code: '036', name: 'Department of Veterans Affairs' },
  { code: '075', name: 'Department of Health and Human Services' },
  { code: '089', name: 'Department of Energy' },
  { code: '080', name: 'National Aeronautics and Space Administration' },
  { code: '047', name: 'General Services Administration' },
  { code: '020', name: 'Department of the Treasury' },
  { code: '013', name: 'Department of Commerce' },
  { code: '019', name: 'Department of State' },
];

// FY2021-FY2026. Each FY runs Oct 1 of prior calendar year to Sep 30.
const FISCAL_YEARS = [2021, 2022, 2023, 2024, 2025, 2026];

const storage = new Storage({ projectId: PROJECT_ID });

function fyDateRange(fy) {
  return {
    start_date: `${fy - 1}-10-01`,
    end_date: `${fy}-09-30`,
  };
}

async function submitOne(agency, fy) {
  const body = {
    filters: {
      agencies: [
        { name: agency.name, tier: 'toptier', type: 'awarding' },
      ],
      sub_award_types: ['procurement'],
      date_type: 'action_date',
      date_range: fyDateRange(fy),
    },
    subawards: true,
    file_format: 'csv',
  };

  const res = await fetch('https://api.usaspending.gov/api/v2/bulk_download/awards/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`Submit failed for ${agency.code} FY${fy}: HTTP ${res.status}`);
  }
  const data = await res.json();
  return {
    agency_code: agency.code,
    agency_name: agency.name,
    fiscal_year: fy,
    file_name: data.file_name,
    file_url: data.file_url,
    status_url: data.status_url,
    submitted_at: new Date().toISOString(),
  };
}

async function main() {
  const jobs = [];
  for (const agency of AGENCIES) {
    for (const fy of FISCAL_YEARS) {
      console.log(`Submitting ${agency.code} ${agency.name} FY${fy}...`);
      try {
        const job = await submitOne(agency, fy);
        jobs.push(job);
        console.log(`  → ${job.file_name}`);
      } catch (err) {
        console.error(`  → FAILED: ${err.message}`);
        // Continue with the rest; we'll retry failures separately
      }
      // Tiny sleep between submissions to be a polite API user
      await new Promise((r) => setTimeout(r, 250));
    }
  }

  console.log(`\nSubmitted ${jobs.length}/${AGENCIES.length * FISCAL_YEARS.length} jobs`);

  const bucket = storage.bucket(BUCKET);
  await bucket.file(MANIFEST_PATH).save(JSON.stringify(jobs, null, 2), {
    contentType: 'application/json',
  });
  console.log(`Manifest written to gs://${BUCKET}/${MANIFEST_PATH}`);
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
