#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const CONTRACTS_DATA_PATH = path.join(__dirname, '../public/contracts-data.js');
const content = fs.readFileSync(CONTRACTS_DATA_PATH, 'utf-8');
const jsonStr = content.replace(/^[^\[]*/, '').replace(/;?\s*$/, '');
const contracts = JSON.parse(jsonStr);

// Count by year
const byYear = {};
contracts.forEach(c => {
  const exp = c['Expiration'];
  if (!exp) return;
  const parts = exp.split('/');
  if (parts.length === 3) {
    const year = parts[2];
    byYear[year] = (byYear[year] || 0) + 1;
  }
});

console.log('Contracts by Expiration Year:');
Object.keys(byYear).sort().forEach(year => {
  console.log('  ' + year + ': ' + byYear[year]);
});
console.log('');
console.log('Total:', contracts.length);

// Check for 2027
const has2027 = byYear['2027'] || 0;
console.log('');
if (has2027 === 0) {
  console.log('⚠️  No 2027 contracts found - need to expand data pull');
} else {
  console.log('✅ 2027 contracts present');
}
