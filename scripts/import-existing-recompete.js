#!/usr/bin/env node

/**
 * Import existing contracts-data.js into recompete_opportunities table
 *
 * Usage: node scripts/import-existing-recompete.js
 */

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// Load env
const envPath = path.join(__dirname, '..', '.env.local');
const envContent = fs.readFileSync(envPath, 'utf8');
const envVars = {};
envContent.split('\n').forEach(line => {
  const [key, ...valueParts] = line.split('=');
  if (key && valueParts.length) {
    envVars[key.trim()] = valueParts.join('=').trim();
  }
});

const supabaseUrl = envVars.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = envVars.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Parse dollar value like "$249,000,000.00 " to number
function parseValue(str) {
  if (!str) return 0;
  return parseFloat(str.replace(/[$,\s]/g, '')) || 0;
}

// Parse date like "4/5/2021" to "2021-04-05"
function parseDate(str) {
  if (!str) return null;
  const parts = str.split('/');
  if (parts.length !== 3) return null;
  const [month, day, year] = parts;
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

// Extract NAICS code from "541330 - ENGINEERING SERVICES"
function parseNaics(str) {
  if (!str) return { code: null, description: null };
  const match = str.match(/^(\d+)\s*-?\s*(.*)$/);
  if (match) {
    return { code: match[1], description: match[2].trim() || null };
  }
  return { code: str, description: null };
}

async function importData() {
  console.log('Reading contracts-data.js...');

  const dataPath = path.join(__dirname, '..', 'public', 'contracts-data.js');
  const content = fs.readFileSync(dataPath, 'utf8');

  // Extract the array from "var expiringContractsData = [...]"
  const match = content.match(/var expiringContractsData = (\[[\s\S]*\]);?/);
  if (!match) {
    console.error('Could not parse contracts-data.js');
    process.exit(1);
  }

  const contracts = JSON.parse(match[1]);
  console.log(`Found ${contracts.length} contracts to import`);

  // Filter to contracts expiring in the future
  const today = new Date().toISOString().split('T')[0];
  const futureContracts = contracts.filter(c => {
    const expDate = parseDate(c['Expiration']);
    return expDate && expDate > today;
  });

  console.log(`${futureContracts.length} contracts expiring after ${today}`);

  // Transform and insert in batches
  const batchSize = 100;
  let inserted = 0;
  let updated = 0;
  let errors = 0;

  for (let i = 0; i < futureContracts.length; i += batchSize) {
    const batch = futureContracts.slice(i, i + batchSize);

    const records = batch.map(c => {
      const naics = parseNaics(c['NAICS']);
      return {
        contract_id: c['Award ID'],
        award_id: c['Award ID'],
        piid: c['Award ID'],
        incumbent_name: c['Recipient'] || 'Unknown',
        awarding_agency: c['Agency'] || 'Unknown',
        awarding_office: c['Office'] || null,
        naics_code: naics.code,
        naics_description: naics.description,
        total_obligation: parseValue(c['Total Value']),
        potential_total_value: parseValue(c['Total Value']),
        period_of_performance_start: parseDate(c['Start Date']),
        period_of_performance_current_end: parseDate(c['Expiration']),
        place_of_performance_state: c['State'] || null,
        data_source: 'contracts-data-import',
        last_synced_at: new Date().toISOString(),
      };
    });

    // Upsert (insert or update on conflict)
    const { data, error } = await supabase
      .from('recompete_opportunities')
      .upsert(records, { onConflict: 'contract_id' });

    if (error) {
      console.error(`Batch ${i}-${i + batchSize} error:`, error.message);
      errors += batch.length;
    } else {
      inserted += batch.length;
    }

    process.stdout.write(`\rProcessed ${Math.min(i + batchSize, futureContracts.length)}/${futureContracts.length}...`);
  }

  console.log(`\n\nImport complete:`);
  console.log(`  Inserted/Updated: ${inserted}`);
  console.log(`  Errors: ${errors}`);

  // Check final count
  const { count } = await supabase
    .from('recompete_opportunities')
    .select('*', { count: 'exact', head: true });

  console.log(`\nTotal records in database: ${count}`);
}

importData().catch(console.error);
