/**
 * Resubmit just the (agency, FY) combinations missing from the
 * existing manifest. Uses a slower throttle + retry/backoff because
 * USASpending starts returning HTTP 500 / dropping connections after
 * ~25-30 rapid submissions.
 *
 * Merges results into the existing manifest at
 * gs://${BUCKET}/manifest/subawards.json
 *
 * Run: node scripts/usaspending-subaward-ingest/submit-missing.js
 */
import { Storage } from '@google-cloud/storage';

const PROJECT_ID = 'market-assasin';
const BUCKET = 'market-assasin-usaspending-staging';
const MANIFEST_PATH = 'manifest/subawards.json';

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
const FISCAL_YEARS = [2021, 2022, 2023, 2024, 2025, 2026];

const THROTTLE_MS = 3000; // 3s between submissions — well below rate limit
const MAX_RETRIES = 3;
const BACKOFF_MS = 15000; // 15s backoff after 500/network error

const storage = new Storage({ projectId: PROJECT_ID });

function fyDateRange(fy) {
  return { start_date: `${fy - 1}-10-01`, end_date: `${fy}-09-30` };
}

async function submitOne(agency, fy) {
  const body = {
    filters: {
      agencies: [{ name: agency.name, tier: 'toptier', type: 'awarding' }],
      sub_award_types: ['procurement'],
      date_type: 'action_date',
      date_range: fyDateRange(fy),
    },
    subawards: true,
    file_format: 'csv',
  };

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch('https://api.usaspending.gov/api/v2/bulk_download/awards/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.status === 500 || res.status === 429 || res.status === 503) {
        throw new Error(`HTTP ${res.status} (server overload)`);
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
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
    } catch (err) {
      console.warn(`  attempt ${attempt}/${MAX_RETRIES} failed: ${err.message}`);
      if (attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, BACKOFF_MS * attempt));
      } else {
        throw err;
      }
    }
  }
}

async function main() {
  const bucket = storage.bucket(BUCKET);
  const [buf] = await bucket.file(MANIFEST_PATH).download();
  const existing = JSON.parse(buf.toString('utf8'));
  console.log(`Loaded existing manifest: ${existing.length} jobs`);

  // Build set of (agency, fy) tuples already submitted
  const have = new Set(existing.map((j) => `${j.agency_code}:${j.fiscal_year}`));

  // Find what's missing
  const missing = [];
  for (const agency of AGENCIES) {
    for (const fy of FISCAL_YEARS) {
      if (!have.has(`${agency.code}:${fy}`)) {
        missing.push({ agency, fy });
      }
    }
  }
  console.log(`Missing: ${missing.length} jobs`);

  const newJobs = [];
  for (const { agency, fy } of missing) {
    console.log(`Submitting ${agency.code} ${agency.name} FY${fy}...`);
    try {
      const job = await submitOne(agency, fy);
      newJobs.push(job);
      console.log(`  → ${job.file_name}`);
    } catch (err) {
      console.error(`  → GAVE UP: ${err.message}`);
    }
    await new Promise((r) => setTimeout(r, THROTTLE_MS));
  }

  // Merge + write back
  const merged = [...existing, ...newJobs];
  await bucket.file(MANIFEST_PATH).save(JSON.stringify(merged, null, 2), {
    contentType: 'application/json',
  });

  console.log(`\nAdded ${newJobs.length} jobs. Manifest now has ${merged.length} total.`);
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
