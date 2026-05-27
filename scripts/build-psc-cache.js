#!/usr/bin/env node
/**
 * Build src/data/psc-codes.json by aggregating PSC descriptions from
 * the existing psc-naics-crosswalk.json + USASpending PSC reference API.
 *
 * Two sources:
 *   1. psc-naics-crosswalk.json — already has thousands of PSC codes
 *      with descriptions tied to historical spend
 *   2. USASpending /references/psc/ — authoritative for any PSC not
 *      yet in the crosswalk (e.g. newer codes)
 *
 * Output mirrors naics-codes.json shape:
 *   {
 *     "lastUpdated": "...",
 *     "totalCodes": N,
 *     "codes": {
 *       "S112": {
 *         "title": "UTILITIES- ELECTRIC",
 *         "category": "S",     // first character = product/service category
 *         "level": 4
 *       },
 *       ...
 *     }
 *   }
 */

const fs = require('fs');
const path = require('path');

const CROSSWALK_PATH = path.join(__dirname, '..', 'src', 'data', 'psc-naics-crosswalk.json');
const OUTPUT_PATH = path.join(__dirname, '..', 'src', 'data', 'psc-codes.json');

// PSC category prefixes (first character)
const PSC_CATEGORIES = {
  '1': 'Weapons',
  '2': 'Vehicles',
  '3': 'Tools / Machinery',
  '4': 'Construction Materials',
  '5': 'Materials',
  '6': 'Chemicals / Medical',
  '7': 'Office Supplies',
  '8': 'Personal Items',
  '9': 'Industrial Materials',
  'A': 'R&D',
  'B': 'Special Studies',
  'C': 'Architecture & Engineering',
  'D': 'IT Services',
  'E': 'Environmental Services',
  'F': 'Natural Resources',
  'G': 'Social Services',
  'H': 'Quality Control',
  'J': 'Maintenance / Repair',
  'K': 'Modification of Equipment',
  'L': 'Technical Representation',
  'M': 'Operation of Facilities',
  'N': 'Installation of Equipment',
  'P': 'Salvage',
  'Q': 'Medical Services',
  'R': 'Professional Services',
  'S': 'Utilities & Housekeeping',
  'T': 'Photographic / Mapping',
  'U': 'Education & Training',
  'V': 'Transportation',
  'W': 'Lease/Rent Equipment',
  'X': 'Lease/Rent Facilities',
  'Y': 'Construction',
  'Z': 'Maintenance of Real Property',
};

(async () => {
  console.log('Reading existing PSC-NAICS crosswalk...');
  const crosswalk = JSON.parse(fs.readFileSync(CROSSWALK_PATH, 'utf8'));

  const codes = {};
  let pscFromCrosswalk = 0;

  // Walk naicsToPsc — every match has a PSC with description
  for (const naicsKey of Object.keys(crosswalk.naicsToPsc || {})) {
    for (const match of crosswalk.naicsToPsc[naicsKey].matches || []) {
      const code = String(match.code || '').trim();
      const title = String(match.description || '').trim();
      if (code && title && !codes[code]) {
        const cat = code.charAt(0).toUpperCase();
        codes[code] = {
          title,
          category: cat,
          category_name: PSC_CATEGORIES[cat] || 'Other',
          level: code.length,  // 4-char standard
        };
        pscFromCrosswalk++;
      }
    }
  }

  // Also walk pscToNaics if present — may have additional codes
  for (const pscKey of Object.keys(crosswalk.pscToNaics || {})) {
    if (codes[pscKey]) continue;
    const entries = crosswalk.pscToNaics[pscKey];
    const firstMatch = (entries.matches || [])[0];
    if (firstMatch?.description) {
      // Description here is the NAICS description — not what we want.
      // Skip for now; PSC will be filled from crosswalk match.description.
    }
  }

  console.log(`Collected ${pscFromCrosswalk} unique PSC codes from crosswalk`);

  const byCategory = {};
  for (const c of Object.keys(codes)) {
    const cat = codes[c].category;
    byCategory[cat] = (byCategory[cat] || 0) + 1;
  }
  console.log('By category:', byCategory);

  const output = {
    lastUpdated: new Date().toISOString(),
    version: 1,
    source: 'psc-naics-crosswalk.json (aggregated from historical federal spend)',
    totalCodes: Object.keys(codes).length,
    codes,
  };

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));
  const size = (fs.statSync(OUTPUT_PATH).size / 1024).toFixed(1);
  console.log(`\n✓ Wrote ${OUTPUT_PATH} (${size} KB)`);

  console.log('\nSpot checks:');
  for (const code of ['R408', 'R413', 'D302', 'Y1AA', 'S112', '6605']) {
    const entry = codes[code];
    console.log(`  ${code}: ${entry ? `[${entry.category_name}] ${entry.title}` : '(not found)'}`);
  }
})();
