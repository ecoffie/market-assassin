#!/usr/bin/env node

/**
 * Validate sampled OpenGov IQ IDIQ_details rows against USAspending award detail.
 *
 * Usage:
 *   node scripts/validate-opengov-idiq-against-usaspending.js ../opn-g-iq-a31ed6b6/IDIQ_details_export.csv --limit=20
 */

const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const USASPENDING_BASE_URL = 'https://api.usaspending.gov/api/v2';
const rootDir = path.join(__dirname, '..');
const args = process.argv.slice(2);
const csvPath = args.find(arg => !arg.startsWith('--'))
  ? path.resolve(args.find(arg => !arg.startsWith('--')))
  : path.resolve(rootDir, '..', 'opn-g-iq-a31ed6b6', 'IDIQ_details_export.csv');
const limitArg = args.find(arg => arg.startsWith('--limit='));
const sampleLimit = limitArg ? Number(limitArg.split('=')[1]) || 20 : 20;

function normalize(value) {
  return String(value ?? '').trim();
}

function normalizeLoose(value) {
  return normalize(value).toUpperCase().replace(/[^A-Z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalizeAwardId(value) {
  return normalize(value).toUpperCase();
}

function normalizeNaics(value) {
  const match = normalize(value).match(/\d{2,6}/);
  return match ? match[0] : '';
}

function getNestedValue(object, paths) {
  for (const pathParts of paths) {
    let current = object;
    for (const part of pathParts) {
      current = current?.[part];
      if (current == null) break;
    }
    if (current != null && normalize(current)) return normalize(current);
  }
  return '';
}

function jsonIncludesLoose(object, needle) {
  const cleanNeedle = normalizeLoose(needle);
  if (!cleanNeedle) return false;
  return normalizeLoose(JSON.stringify(object)).includes(cleanNeedle);
}

function recipientMatches(expected, actualJson) {
  const expectedName = normalizeLoose(expected);
  if (!expectedName) return false;

  if (jsonIncludesLoose(actualJson, expectedName)) return true;

  const meaningfulTokens = expectedName
    .split(' ')
    .filter(token => token.length >= 4 && !['INC', 'LLC', 'CORP', 'COMPANY', 'THE'].includes(token));
  if (meaningfulTokens.length < 2) return false;

  const json = normalizeLoose(JSON.stringify(actualJson));
  const matchingTokens = meaningfulTokens.filter(token => json.includes(token));
  return matchingTokens.length >= Math.min(3, meaningfulTokens.length);
}

function loadRows(filePath) {
  if (!fs.existsSync(filePath)) throw new Error(`IDIQ export not found: ${filePath}`);

  const workbook = XLSX.readFile(filePath, { raw: false });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  return XLSX.utils.sheet_to_json(sheet, { defval: '' });
}

function stableSample(rows, limit) {
  const seen = new Set();
  const candidates = rows.filter(row => {
    const awardId = normalizeAwardId(row.AwardID);
    if (!/^CONT_IDV_[A-Z0-9_]+/.test(awardId)) return false;
    if (!normalize(row.recipient_name) || !normalize(row.recipient_uei) || !normalize(row.Agency)) return false;
    if (seen.has(awardId)) return false;
    seen.add(awardId);
    return true;
  });

  const stride = Math.max(1, Math.floor(candidates.length / limit));
  const sampled = [];
  for (let index = 0; index < candidates.length && sampled.length < limit; index += stride) {
    sampled.push(candidates[index]);
  }
  return sampled;
}

async function fetchAward(awardId) {
  const response = await fetch(`${USASPENDING_BASE_URL}/awards/${encodeURIComponent(awardId)}/`);
  if (!response.ok) {
    return { found: false, status: response.status, data: null };
  }
  return { found: true, status: response.status, data: await response.json() };
}

function compareRow(row, awardResult) {
  const awardId = normalizeAwardId(row.AwardID);
  const data = awardResult.data;
  if (!awardResult.found || !data) {
    return {
      awardId,
      found: false,
      status: awardResult.status,
      matches: { recipientName: false, recipientUei: false, agency: false, naics: false },
    };
  }

  const expected = {
    recipientName: normalize(row.recipient_name),
    recipientUei: normalize(row.recipient_uei),
    agency: normalize(row.Agency),
    naics: normalizeNaics(row.NAICS),
  };

  const actual = {
    recipientName: getNestedValue(data, [
      ['recipient', 'recipient_name'],
      ['recipient', 'name'],
      ['latest_transaction', 'recipient_name'],
    ]),
    recipientUei: getNestedValue(data, [
      ['recipient', 'recipient_uei'],
      ['recipient', 'uei'],
      ['latest_transaction', 'recipient_uei'],
    ]),
    agency: getNestedValue(data, [
      ['awarding_agency', 'toptier_agency', 'name'],
      ['awarding_agency', 'name'],
      ['latest_transaction', 'awarding_agency_name'],
    ]),
    naics: getNestedValue(data, [
      ['latest_transaction_contract_data', 'naics'],
      ['latest_transaction', 'naics_code'],
    ]),
  };

  const matches = {
    recipientName: recipientMatches(expected.recipientName, data),
    recipientUei: jsonIncludesLoose(data, expected.recipientUei),
    agency: jsonIncludesLoose(data, expected.agency),
    naics: jsonIncludesLoose(data, expected.naics),
  };

  return { awardId, found: true, status: awardResult.status, expected, actual, matches };
}

async function main() {
  const rows = loadRows(csvPath);
  const sample = stableSample(rows, sampleLimit);
  const results = [];

  for (const [index, row] of sample.entries()) {
    const awardId = normalizeAwardId(row.AwardID);
    process.stderr.write(`Validating ${index + 1}/${sample.length}: ${awardId}\n`);
    const awardResult = await fetchAward(awardId);
    results.push(compareRow(row, awardResult));
  }

  const found = results.filter(result => result.found).length;
  const fullMatches = results.filter(result => (
    result.found &&
    result.matches.recipientName &&
    result.matches.recipientUei &&
    result.matches.agency &&
    result.matches.naics
  )).length;

  const summary = {
    file: path.relative(rootDir, csvPath),
    sampled: sample.length,
    found,
    notFound: sample.length - found,
    fullMatches,
    mismatchOrPartial: sample.length - fullMatches,
    recommendation: fullMatches / Math.max(1, sample.length) >= 0.9
      ? 'OpenGov IDIQ identifiers appear usable as enrichment keys. Still treat vehicle labels as provisional.'
      : 'Do not import OpenGov IDIQ as trusted enrichment. Rebuild IDV data directly from USAspending.',
  };

  console.log(JSON.stringify({ summary, results }, null, 2));
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
