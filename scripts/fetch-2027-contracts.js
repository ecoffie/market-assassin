#!/usr/bin/env node
/**
 * Fetch 2027 Expiring Contracts from USASpending
 *
 * USASpending API filters by date_signed (contract start), not by end date.
 * To get contracts expiring in 2027, we need to:
 * 1. Fetch contracts signed in 2022-2024 (5-year base period → expire 2027)
 * 2. Filter results to those with End Date in 2027
 *
 * Usage: node scripts/fetch-2027-contracts.js [--merge]
 *   --merge: Merge with existing contracts-data.js
 */

const fs = require('fs');
const path = require('path');

const USASPENDING_API = 'https://api.usaspending.gov/api/v2/search/spending_by_award/';
const CONTRACTS_DATA_PATH = path.join(__dirname, '../public/contracts-data.js');

// NAICS codes to query (popular federal contracting)
const NAICS_CODES = [
  '541512', '541511', '541513', '541519', // IT
  '541611', '541612', '541614', '541618', // Consulting
  '541330', '541310', '541320', // Engineering
  '236220', '236210', '237110', '237310', // Construction
  '238210', '238220', '238160', // Specialty Contractors
  '561210', '561320', '561612', // Admin Services
  '541990', '518210', '519190', // Other professional services
  '621111', '621112', '621210', // Healthcare
  '611310', '611430', '611710', // Education/Training
  '541720', '541713', '541714', // R&D
];

// Format date as M/D/YYYY
function formatDate(date) {
  if (!date || isNaN(date.getTime())) return '';
  return `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear()}`;
}

// Format value as currency
function formatCurrency(value) {
  if (!value || typeof value !== 'number') return '$0.00';
  return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Sleep helper
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Fetch contracts from USASpending
async function fetchUSASpending(naicsCode, startDateFrom, startDateTo) {
  const response = await fetch(USASPENDING_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      filters: {
        award_type_codes: ['A', 'B', 'C', 'D'],
        naics_codes: [{ description: '', naics: naicsCode }],
        time_period: [{
          start_date: startDateFrom,
          end_date: startDateTo,
          date_type: 'date_signed',
        }],
      },
      fields: [
        'Award ID',
        'Recipient Name',
        'Awarding Agency',
        'Awarding Sub Agency',
        'NAICS Code',
        'NAICS Description',
        'Award Amount',
        'Start Date',
        'End Date',
        'Place of Performance State Code',
      ],
      page: 1,
      limit: 100,
      sort: 'Award Amount',
      order: 'desc',
    }),
  });

  const data = await response.json();
  return data.results || [];
}

// Load existing contracts
function loadExistingContracts() {
  try {
    const content = fs.readFileSync(CONTRACTS_DATA_PATH, 'utf-8');
    const jsonStr = content.replace(/^[^\[]*/, '').replace(/;?\s*$/, '');
    return JSON.parse(jsonStr);
  } catch (err) {
    console.error('Error loading existing contracts:', err.message);
    return [];
  }
}

async function main() {
  const shouldMerge = process.argv.includes('--merge');
  console.log('Fetching 2027 expiring contracts from USASpending...\n');

  // We want contracts expiring in 2027
  // These would typically be signed 2022-2024 (3-5 year periods)
  const dateRanges = [
    { from: '2022-01-01', to: '2022-12-31', label: '2022' },
    { from: '2023-01-01', to: '2023-12-31', label: '2023' },
    { from: '2024-01-01', to: '2024-12-31', label: '2024' },
  ];

  const allContracts = [];
  const seen = new Set();

  for (const range of dateRanges) {
    console.log(`\n=== Contracts signed in ${range.label} ===`);

    for (let i = 0; i < NAICS_CODES.length; i++) {
      const naics = NAICS_CODES[i];
      process.stdout.write(`  NAICS ${naics}... `);

      try {
        const results = await fetchUSASpending(naics, range.from, range.to);

        // Filter to only contracts expiring in 2027
        let count2027 = 0;
        for (const r of results) {
          if (!r['End Date'] || !r['Award ID']) continue;

          const endDate = new Date(r['End Date']);
          if (isNaN(endDate.getTime())) continue;

          // Only 2027 expirations
          if (endDate.getFullYear() !== 2027) continue;

          // Skip if expired
          if (endDate < new Date()) continue;

          // Dedupe by Award ID
          const awardId = r['Award ID'].split(' (')[0].trim();
          if (seen.has(awardId)) continue;
          seen.add(awardId);

          const naicsDisplay = r['NAICS Code'] && r['NAICS Description']
            ? `${r['NAICS Code']} - ${r['NAICS Description']}`
            : r['NAICS Code'] || naics;

          allContracts.push({
            'Award ID': r['Award ID'],
            'Agency': r['Awarding Agency'] || '',
            'Office': r['Awarding Sub Agency'] || '',
            'Recipient': r['Recipient Name'] || '',
            'NAICS': naicsDisplay,
            'Total Value': formatCurrency(r['Award Amount'] || 0),
            'Start Date': r['Start Date'] ? formatDate(new Date(r['Start Date'])) : '',
            'Expiration': formatDate(endDate),
            'State': r['Place of Performance State Code'] || '',
          });

          count2027++;
        }

        console.log(`${results.length} fetched, ${count2027} expire 2027`);
      } catch (err) {
        console.log(`ERROR: ${err.message}`);
      }

      // Rate limit
      await sleep(300);
    }
  }

  console.log(`\n\n=== RESULTS ===`);
  console.log(`Total 2027 contracts found: ${allContracts.length}`);

  if (allContracts.length === 0) {
    console.log('No 2027 contracts found. Exiting.');
    return;
  }

  // Sort by expiration date
  allContracts.sort((a, b) => {
    const parseDate = (str) => {
      if (!str) return new Date('2099-12-31');
      const parts = str.split('/');
      if (parts.length !== 3) return new Date('2099-12-31');
      return new Date(parts[2], parts[0] - 1, parts[1]);
    };
    return parseDate(a['Expiration']) - parseDate(b['Expiration']);
  });

  // Show sample
  console.log('\nSample 2027 contracts:');
  allContracts.slice(0, 5).forEach((c, i) => {
    console.log(`  ${i + 1}. ${c['Recipient'].substring(0, 40)} - Expires ${c['Expiration']}`);
  });

  if (shouldMerge) {
    console.log('\n\n=== MERGING ===');
    const existing = loadExistingContracts();
    console.log(`Existing contracts: ${existing.length}`);

    // Build map
    const contractMap = new Map();
    for (const c of existing) {
      const id = c['Award ID']?.split(' (')[0]?.trim();
      if (id) contractMap.set(id, c);
    }

    // Add new 2027 contracts
    let newCount = 0;
    for (const c of allContracts) {
      const id = c['Award ID']?.split(' (')[0]?.trim();
      if (id && !contractMap.has(id)) {
        contractMap.set(id, c);
        newCount++;
      }
    }

    console.log(`New 2027 contracts added: ${newCount}`);

    // Convert back to array and sort
    let merged = Array.from(contractMap.values());
    merged.sort((a, b) => {
      const parseDate = (str) => {
        if (!str) return new Date('2099-12-31');
        const parts = str.split('/');
        if (parts.length !== 3) return new Date('2099-12-31');
        return new Date(parts[2], parts[0] - 1, parts[1]);
      };
      return parseDate(a['Expiration']) - parseDate(b['Expiration']);
    });

    // Write output
    const output = `var expiringContractsData = ${JSON.stringify(merged, null, 2)};`;
    fs.writeFileSync(CONTRACTS_DATA_PATH, output);

    console.log(`\nWritten to: ${CONTRACTS_DATA_PATH}`);
    console.log(`Total contracts: ${merged.length}`);

    // Count by year
    const byYear = {};
    merged.forEach(c => {
      const exp = c['Expiration'];
      if (!exp) return;
      const parts = exp.split('/');
      if (parts.length === 3) {
        const year = parts[2];
        byYear[year] = (byYear[year] || 0) + 1;
      }
    });

    console.log('\nContracts by year:');
    Object.keys(byYear).sort().forEach(year => {
      console.log(`  ${year}: ${byYear[year]}`);
    });
  } else {
    console.log('\nRun with --merge to add these to contracts-data.js');
  }
}

main().catch(console.error);
