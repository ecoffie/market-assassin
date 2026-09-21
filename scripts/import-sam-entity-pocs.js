/**
 * Import contractor-side POCs from SAM.gov entity registrations.
 *
 * Source: OpenGov IQ Base44 export at
 *   /Users/ericcoffie/Market Assasin/opn-g-iq-a31ed6b6/SAMEntities_export.csv
 * Format: 50K SAM-registered contractors. Each row holds up to 6 POCs
 *   keyed by role (Govt Bus, Alt Govt Bus, Past Perf, Alt Past Perf,
 *   Elec Bus, Alt Elec Bus). Many are repeats or empty.
 *
 * Destination: federal_contacts (Supabase). Same table that holds the
 * SAM solicitation KOs we already loaded — different contact_type so
 * Mindy can distinguish KOs from contractor POCs in product queries.
 *
 * What this is NOT:
 *   - NOT government contracting officers (those came from sam_opportunities)
 *   - NOT for public SEO pages (this is internal Mindy data)
 *
 * What this IS:
 *   - The contractor-side people who answer government inquiries
 *   - Powers Mindy BD features: "who at Lockheed handles past-performance?"
 *   - Future: teaming partner outreach, supplier discovery
 *
 * Dedup: source_row_key = UEI + role tag, so reruns are idempotent.
 *
 * Run: node scripts/import-sam-entity-pocs.js
 */
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createReadStream } from 'node:fs';
import { parse } from 'csv-parse';
import { createClient } from '@supabase/supabase-js';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '..', '.env.local') });

const SOURCE_CSV = '/Users/ericcoffie/Market Assasin/opn-g-iq-a31ed6b6/SAMEntities_export.csv';
const BATCH_SIZE = 500;
const MAX_FULLNAME_LENGTH = 80;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

// Each SAM entity row has up to 6 POCs. Each POC is split across many
// columns: First_Name, Middle_Initial, Last_Name, Title, plus address.
// We extract just what's useful for contact records (name + title +
// address city/state, since SAM doesn't include emails for these POCs).
const POC_ROLES = [
  {
    key: 'govt_bus',
    title: 'Government Business POC',
    fields: {
      first: 'Govt_Bus_POC_First_Name',
      mi: 'Govt_Bus_POC_Middle_Initial',
      last: 'Govt_Bus_POC_Last_Name',
      role_title: 'Govt_Bus_POC_Title',
      city: 'Govt_Bus_POC_City',
      state: 'Govt_Bus_POC_State_Or_Province',
    },
  },
  {
    key: 'alt_govt_bus',
    title: 'Alternate Government Business POC',
    fields: {
      first: 'Alt_Govt_Bus_POC_First_Name',
      mi: 'Alt_Govt_Bus_POC_Middle_Initial',
      last: 'Alt_Govt_Bus_POC_Last_Name',
      role_title: 'Alt_Govt_Bus_POC_Title',
      city: 'Alt_Govt_Bus_POC_City',
      state: 'Alt_Govt_Bus_POC_State_Or_Province',
    },
  },
  {
    key: 'past_perf',
    title: 'Past Performance POC',
    fields: {
      first: 'Past_Perf_POC_POC_First_Name',
      mi: 'Past_Perf_POC_POC_Middle_Initial',
      last: 'Past_Perf_POC_POC_Last_Name',
      role_title: 'Past_Perf_POC_POC_Title',
      city: 'Past_Perf_POC_City',
      state: 'Past_Perf_POC_State_Or_Province',
    },
  },
  {
    key: 'alt_past_perf',
    title: 'Alternate Past Performance POC',
    fields: {
      first: 'Alt_Past_Perf_POC_First_Name',
      mi: 'Alt_Past_Perf_POC_Middle_Initial',
      last: 'Alt_Past_Perf_POC_Last_Name',
      role_title: 'Alt_Past_Perf_POC_Title',
      city: 'Alt_Past_Perf_POC_City',
      state: 'Alt_Past_Perf_POC_State_Or_Province',
    },
  },
  {
    key: 'elec_bus',
    title: 'Electronic Business POC',
    fields: {
      first: 'Elec_Bus_POC_First_Name',
      mi: 'Elec_Bus_POC_Middle_Initial',
      last: 'Elec_Bus_POC_Last_Name',
      role_title: 'Elec_Bus_POC_Title',
      city: 'Elec_Bus_POC_City',
      state: 'Elec_Bus_POC_State_Or_Province',
    },
  },
  {
    key: 'alt_elec_bus',
    title: 'Alternate Electronic Business POC',
    fields: {
      first: 'Alt_Elec_POC_Bus_POC_First_Name',
      mi: 'Alt_Elec_POC_Bus_POC_Middle_Initial',
      last: 'Alt_Elec_POC_Bus_POC_Last_Name',
      role_title: 'Alt_Elec_POC_Bus_POC_Title',
      city: 'Alt_Elec_POC_Bus_City',
      state: 'Alt_Elec_POC_Bus_State_Or_Province',
    },
  },
];

function normalize(s) {
  if (!s || typeof s !== 'string') return null;
  const t = s.trim();
  return t.length === 0 ? null : t;
}

function buildFullname(first, mi, last) {
  const f = normalize(first);
  const m = normalize(mi);
  const l = normalize(last);
  if (!f && !l) return null;
  const parts = [f, m && `${m.replace(/\.$/, '')}.`, l].filter(Boolean);
  const name = parts.join(' ').trim();
  if (name.length > MAX_FULLNAME_LENGTH) return null;
  // Skip placeholder garbage. SAM data is full of "N/A", "NONE", "TBD".
  if (/^(n\/?a|none|tbd|test|unknown)$/i.test(name)) return null;
  return name;
}

function extractPocsFromRow(row) {
  const uei = normalize(row.UEI_SAM);
  const company = normalize(row.Legal_Business_Name);
  if (!uei || !company) return [];

  const contacts = [];
  for (const role of POC_ROLES) {
    const fullname = buildFullname(
      row[role.fields.first],
      row[role.fields.mi],
      row[role.fields.last],
    );
    if (!fullname) continue;

    const roleTitle = normalize(row[role.fields.role_title]) || role.title;
    const city = normalize(row[role.fields.city]);
    const state = normalize(row[role.fields.state]);
    const officeLocation = [city, state].filter(Boolean).join(', ') || null;

    contacts.push({
      source_table: 'sam_entities_pocs',
      source_row_key: `${uei}::${role.key}`,
      contact_fullname: fullname,
      contact_title: roleTitle,
      contact_email: null, // SAMEntities doesn't expose POC emails
      contact_phone: null, // nor phones in this export
      department_ind_agency: null,
      office: officeLocation,
      sub_tier: company, // store recipient name here so Mindy can join to recipients
      posted_date: null,
      solicitation_number: null,
      raw_data: { uei, role: role.key, role_title: role.title, company },
    });
  }
  return contacts;
}

async function upsertChunk(rows) {
  if (rows.length === 0) return;
  // SAMEntities has occasional duplicate UEIs (same entity registered
  // twice). Within a single upsert batch, two rows with the same
  // source_row_key cause "ON CONFLICT cannot affect row a second
  // time". Dedupe by key, keeping the last seen value.
  const byKey = new Map();
  for (const r of rows) byKey.set(r.source_row_key, r);
  const deduped = Array.from(byKey.values());

  const { error } = await sb
    .from('federal_contacts')
    .upsert(deduped, { onConflict: 'source_row_key' });
  if (error) {
    console.error('Upsert error:', error.message);
    throw error;
  }
}

async function main() {
  const start = Date.now();
  console.log(`Reading ${SOURCE_CSV}`);

  const parser = createReadStream(SOURCE_CSV).pipe(
    parse({
      columns: true,
      skip_empty_lines: true,
      relax_quotes: true,
      relax_column_count: true,
    }),
  );

  let rowCount = 0;
  let extractedCount = 0;
  let batch = [];

  for await (const row of parser) {
    rowCount++;
    const contacts = extractPocsFromRow(row);
    extractedCount += contacts.length;
    batch.push(...contacts);

    if (batch.length >= BATCH_SIZE) {
      await upsertChunk(batch);
      batch = [];
      if (rowCount % 5000 === 0) {
        const elapsed = ((Date.now() - start) / 1000).toFixed(1);
        console.log(`[${elapsed}s] entities=${rowCount} pocs_extracted=${extractedCount}`);
      }
    }
  }
  if (batch.length > 0) await upsertChunk(batch);

  const total = ((Date.now() - start) / 1000).toFixed(1);
  console.log('---');
  console.log(`Done in ${total}s. SAM entities processed: ${rowCount}`);
  console.log(`POCs extracted (after filters): ${extractedCount}`);
  console.log(`Avg POCs per entity: ${(extractedCount / rowCount).toFixed(2)}`);
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
