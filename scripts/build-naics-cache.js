#!/usr/bin/env node
/**
 * Build src/data/naics-codes.json from USASpending's NAICS reference
 * API. Same pattern Content Reaper uses for agency-pain-points.json:
 * static JSON in src/data/, fast read at request time, no DB.
 *
 * Source: https://api.usaspending.gov/api/v2/references/naics/
 *   - Tree endpoint returns hierarchical NAICS with descriptions
 *   - No auth, no rate limit, free to use
 *   - Authoritative for federal procurement (matches what SAM uses)
 *
 * Output shape mirrors psc-naics-crosswalk.json conventions:
 *   {
 *     "lastUpdated": "...",
 *     "source": "USASpending NAICS API",
 *     "totalCodes": 1065,
 *     "codes": {
 *       "541611": {
 *         "title": "Administrative Management and General Management Consulting Services",
 *         "level": 6,
 *         "parent": "5416"
 *       },
 *       ...
 *     }
 *   }
 *
 * Built 2026-05-26.
 */

const fs = require('fs');
const path = require('path');

const API_BASE = 'https://api.usaspending.gov/api/v2/references/naics/';
const OUTPUT_PATH = path.join(__dirname, '..', 'src', 'data', 'naics-codes.json');

function determineLevel(code) {
  return String(code).length;
}

function determineParent(code) {
  const s = String(code);
  if (s.length <= 2) return null;
  // NAICS hierarchy: 2 → 3 → 4 → 5 → 6 digits
  // Each level drops the last digit. But the API returns 2/4/6 only
  // (industry sectors / industry groups / national industries), so
  // the parent of a 6-digit is the 4-digit, not the 5.
  if (s.length === 6) return s.slice(0, 4);
  if (s.length === 4) return s.slice(0, 2);
  return null;
}

function recordNode(flat, node) {
  const code = String(node.naics || '').trim();
  const title = String(node.naics_description || '').trim();
  if (code && title) {
    flat[code] = {
      title,
      level: determineLevel(code),
      parent: determineParent(code),
    };
  }
  for (const child of node.children || []) {
    recordNode(flat, child);
  }
}

async function walkNaicsTree() {
  console.log('Fetching root NAICS sectors (2-digit)...');
  const rootRes = await fetch(API_BASE);
  if (!rootRes.ok) {
    throw new Error(`USASpending NAICS root returned ${rootRes.status}`);
  }
  const rootData = await rootRes.json();
  const sectors = rootData.results || [];
  console.log(`Got ${sectors.length} sectors`);

  const flat = {};
  for (const sector of sectors) {
    recordNode(flat, sector);
  }

  // Sectors only return themselves at the root level — drill into each
  // sector to get its 4-digit industry groups + 6-digit specifics.
  // Sequential to be polite to the API.
  let drilled = 0;
  for (const sector of sectors) {
    const code = String(sector.naics);
    process.stdout.write(`Drilling sector ${code}...`);
    try {
      const r = await fetch(`${API_BASE}${code}/`);
      if (!r.ok) {
        console.log(` skip (HTTP ${r.status})`);
        continue;
      }
      const d = await r.json();
      const sectorWithKids = (d.results || [])[0];
      if (sectorWithKids) {
        recordNode(flat, sectorWithKids);
      }
      drilled++;
      // Some sectors stop at 4-digit; need to drill into each 4-digit child too
      for (const fourDigit of sectorWithKids?.children || []) {
        const four = String(fourDigit.naics);
        // If the 4-digit already has 6-digit children, skip
        if (fourDigit.children && fourDigit.children.length > 0 && fourDigit.children.some(c => String(c.naics).length === 6)) {
          continue;
        }
        try {
          const rr = await fetch(`${API_BASE}${four}/`);
          if (!rr.ok) continue;
          const dd = await rr.json();
          const fourWithKids = (dd.results || [])[0];
          if (fourWithKids) recordNode(flat, fourWithKids);
        } catch { /* skip */ }
      }
      console.log(` ${Object.keys(flat).length} cumulative`);
    } catch (err) {
      console.log(` error: ${err.message}`);
    }
  }
  console.log(`Drilled into ${drilled} sectors`);

  return flat;
}

async function fillMissing4Digits(codes) {
  // The /references/naics/ root endpoint returns sectors and their
  // children, but the 4-digit industry groups may be sparse (some
  // sectors return only 2-digit + 6-digit). For each 6-digit code,
  // ensure the 4-digit parent exists; if not, fetch it.
  const sixDigitCodes = Object.keys(codes).filter(c => c.length === 6);
  const missingParents = new Set();
  for (const code of sixDigitCodes) {
    const parent = determineParent(code);
    if (parent && !codes[parent]) missingParents.add(parent);
  }

  if (missingParents.size === 0) {
    console.log('All 4-digit parents present');
    return;
  }

  console.log(`Backfilling ${missingParents.size} missing 4-digit parents...`);
  let filled = 0;
  for (const code of missingParents) {
    try {
      const res = await fetch(`${API_BASE}?filter=${code}`);
      if (!res.ok) continue;
      const data = await res.json();
      const findCode = (node) => {
        if (String(node.naics) === code) return node;
        for (const child of node.children || []) {
          const found = findCode(child);
          if (found) return found;
        }
        return null;
      };
      for (const root of (data.results || [])) {
        const node = findCode(root);
        if (node) {
          codes[code] = {
            title: node.naics_description,
            level: 4,
            parent: determineParent(code),
          };
          filled++;
          break;
        }
      }
    } catch { /* skip */ }
  }
  console.log(`Filled ${filled} parent codes`);
}

(async () => {
  let codes;
  try {
    codes = await walkNaicsTree();
  } catch (err) {
    console.error('Failed to fetch NAICS:', err.message);
    process.exit(1);
  }

  console.log(`Collected ${Object.keys(codes).length} NAICS codes from tree`);

  // Stats before backfill
  const byLevel = {};
  for (const c of Object.keys(codes)) {
    byLevel[codes[c].level] = (byLevel[codes[c].level] || 0) + 1;
  }
  console.log('By level before backfill:', byLevel);

  await fillMissing4Digits(codes);

  // Final stats
  const byLevelFinal = {};
  for (const c of Object.keys(codes)) {
    byLevelFinal[codes[c].level] = (byLevelFinal[codes[c].level] || 0) + 1;
  }
  console.log('By level final:', byLevelFinal);

  const output = {
    lastUpdated: new Date().toISOString(),
    version: 1,
    source: 'USASpending NAICS API (authoritative for federal procurement)',
    totalCodes: Object.keys(codes).length,
    codes,
  };

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));
  const size = (fs.statSync(OUTPUT_PATH).size / 1024).toFixed(1);
  console.log(`\n✓ Wrote ${OUTPUT_PATH} (${size} KB)`);

  console.log('\nSpot checks:');
  for (const code of ['541611', '541512', '236220', '611430', '813410', '999999']) {
    const entry = codes[code];
    console.log(`  ${code}: ${entry ? entry.title : '(not found)'}`);
  }
})();
