#!/usr/bin/env node
/**
 * Merge XLSX Contract Data into contracts-data.js
 *
 * Usage: node scripts/merge-xlsx-contracts.js [path-to-xlsx]
 *
 * Features:
 * - Converts Excel serial dates to M/D/YYYY
 * - Formats values as currency
 * - Dedupes by Award ID
 * - Removes expired contracts
 * - Preserves existing state data
 */

const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

// Paths
const XLSX_PATH = process.argv[2] || '/Users/ericcoffie/Downloads/Expiring Contracts 2026.xlsx';
const CONTRACTS_DATA_PATH = path.join(__dirname, '../public/contracts-data.js');

// Excel serial date to JS Date
function excelDateToDate(serial) {
  if (!serial || typeof serial !== 'number') return null;
  // Excel epoch is 1/1/1900, but Excel has a bug where it thinks 1900 was a leap year
  const utc_days = Math.floor(serial - 25569);
  const date = new Date(utc_days * 86400 * 1000);
  return date;
}

// Format date as M/D/YYYY
function formatDate(date) {
  if (!date || isNaN(date.getTime())) return '';
  return `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear()}`;
}

// Format value as currency
function formatCurrency(value) {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'number') return '$0.00';
  return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} `;
}

// Parse existing contracts-data.js
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

// Check if date is expired
function isExpired(dateStr) {
  if (!dateStr) return true;
  const parts = dateStr.split('/');
  if (parts.length !== 3) return true;
  const [month, day, year] = parts.map(Number);
  const expDate = new Date(year, month - 1, day);
  return expDate < new Date();
}

async function main() {
  console.log('Loading XLSX file:', XLSX_PATH);

  // Read XLSX
  const workbook = XLSX.readFile(XLSX_PATH);
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const newData = XLSX.utils.sheet_to_json(sheet);

  console.log(`Found ${newData.length} contracts in XLSX`);

  // Convert XLSX data to standard format
  const convertedNew = newData.map(row => ({
    'Award ID': row['Award ID'] || '',
    'Agency': row['Agency'] || '',
    'Office': row['Office'] || '',
    'Recipient': row['Recipient'] || '',
    'NAICS': row['NAICS'] || '',
    'Total Value': typeof row['Total Value'] === 'number'
      ? formatCurrency(row['Total Value'])
      : row['Total Value'] || '',
    'Start Date': typeof row['Start Date'] === 'number'
      ? formatDate(excelDateToDate(row['Start Date']))
      : row['Start Date'] || '',
    'Expiration': typeof row['Expiration'] === 'number'
      ? formatDate(excelDateToDate(row['Expiration']))
      : row['Expiration'] || '',
    // Preserve State if present
    'State': row['State'] || '',
  }));

  // Load existing contracts
  const existingContracts = loadExistingContracts();
  console.log(`Existing contracts: ${existingContracts.length}`);

  // Build lookup map by Award ID
  const existingMap = new Map();
  for (const contract of existingContracts) {
    const awardId = contract['Award ID']?.split(' (')[0]?.trim();
    if (awardId) {
      existingMap.set(awardId, contract);
    }
  }

  // Merge: new contracts take precedence, but preserve State from existing
  let newCount = 0;
  let updatedCount = 0;

  for (const newContract of convertedNew) {
    const awardId = newContract['Award ID']?.split(' (')[0]?.trim();
    if (!awardId) continue;

    const existing = existingMap.get(awardId);
    if (existing) {
      // Preserve State from existing
      if (existing['State'] && !newContract['State']) {
        newContract['State'] = existing['State'];
      }
      existingMap.set(awardId, newContract);
      updatedCount++;
    } else {
      existingMap.set(awardId, newContract);
      newCount++;
    }
  }

  console.log(`New contracts added: ${newCount}`);
  console.log(`Existing contracts updated: ${updatedCount}`);

  // Convert map back to array
  let merged = Array.from(existingMap.values());

  // Remove expired contracts
  const beforeExpiredFilter = merged.length;
  merged = merged.filter(c => !isExpired(c['Expiration']));
  const expiredRemoved = beforeExpiredFilter - merged.length;
  console.log(`Expired contracts removed: ${expiredRemoved}`);

  // Sort by expiration date (soonest first)
  merged.sort((a, b) => {
    const parseDate = (str) => {
      if (!str) return new Date('2099-12-31');
      const parts = str.split('/');
      if (parts.length !== 3) return new Date('2099-12-31');
      return new Date(parts[2], parts[0] - 1, parts[1]);
    };
    return parseDate(a['Expiration']) - parseDate(b['Expiration']);
  });

  console.log(`Total contracts after merge: ${merged.length}`);

  // Write output
  const output = `var contractsData = ${JSON.stringify(merged, null, 2)};`;
  fs.writeFileSync(CONTRACTS_DATA_PATH, output);

  console.log(`\nWritten to: ${CONTRACTS_DATA_PATH}`);
  console.log(`File size: ${(fs.statSync(CONTRACTS_DATA_PATH).size / 1024 / 1024).toFixed(2)} MB`);

  // Summary stats
  const naicsCounts = new Map();
  for (const c of merged) {
    const prefix = c['NAICS']?.split(' ')[0]?.slice(0, 3) || 'Unknown';
    naicsCounts.set(prefix, (naicsCounts.get(prefix) || 0) + 1);
  }

  console.log('\nTop NAICS categories:');
  const sorted = Array.from(naicsCounts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10);
  for (const [prefix, count] of sorted) {
    console.log(`  ${prefix}: ${count}`);
  }
}

main().catch(console.error);
