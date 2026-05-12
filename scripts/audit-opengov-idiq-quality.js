#!/usr/bin/env node

/**
 * Audit the OpenGov IQ IDIQ_details export before using it as MI enrichment.
 *
 * Usage:
 *   node scripts/audit-opengov-idiq-quality.js ../opn-g-iq-a31ed6b6/IDIQ_details_export.csv
 */

const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const rootDir = path.join(__dirname, '..');
const csvPath = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.resolve(rootDir, '..', 'opn-g-iq-a31ed6b6', 'IDIQ_details_export.csv');

function percent(value, total) {
  if (!total) return '0.0%';
  return `${((value / total) * 100).toFixed(1)}%`;
}

function normalize(value) {
  return String(value ?? '').trim();
}

function normalizeAwardId(value) {
  return normalize(value).toUpperCase();
}

function normalizeNaics(value) {
  const match = normalize(value).match(/\d{2,6}/);
  return match ? match[0] : '';
}

function normalizeName(value) {
  return normalize(value)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\b(LLC|INC|CORP|CORPORATION|COMPANY|CO|LTD|LP|JV)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function increment(map, key) {
  if (!key) return;
  map.set(key, (map.get(key) || 0) + 1);
}

function topEntries(map, limit = 10) {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([name, count]) => ({ name, count }));
}

function loadIdiqRows(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`IDIQ export not found: ${filePath}`);
  }

  const workbook = XLSX.readFile(filePath, { raw: false });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  return XLSX.utils.sheet_to_json(sheet, { defval: '' });
}

function loadRecompeteRows() {
  const dataPath = path.join(rootDir, 'public', 'contracts-data.js');
  if (!fs.existsSync(dataPath)) return [];

  const content = fs.readFileSync(dataPath, 'utf8');
  const match = content.match(/var expiringContractsData = (\[[\s\S]*\]);?/);
  return match ? JSON.parse(match[1]) : [];
}

function isLikelyBadAiText(value) {
  const text = normalize(value);
  if (!text) return false;

  const lower = text.toLowerCase();
  return (
    lower.includes('okay, i understand') ||
    lower.includes('please provide') ||
    lower.includes('i cannot') ||
    lower.includes('i need more information') ||
    lower.includes('as an ai') ||
    lower.includes('no description provided') ||
    text.length < 8
  );
}

function auditIdiq(rows, recompeteRows) {
  const requiredFields = [
    'AwardID',
    'NAICS',
    'Agency',
    'recipient_uei',
    'recipient_name',
    'Description',
    'ai_generated_text',
    'CleanedVehicle',
  ];

  const completeness = Object.fromEntries(requiredFields.map(field => [field, 0]));
  const awardIds = new Map();
  const agencies = new Map();
  const naicsCodes = new Map();
  const recipients = new Map();
  const duplicateAwardIds = new Map();
  const questionableAiRows = [];
  const missingCoreRows = [];
  const generatedAwardIdRows = [];

  for (const row of rows) {
    for (const field of requiredFields) {
      if (normalize(row[field])) completeness[field] += 1;
    }

    const awardId = normalizeAwardId(row.AwardID);
    const agency = normalize(row.Agency);
    const naics = normalizeNaics(row.NAICS);
    const recipient = normalizeName(row.recipient_name);
    const hasGeneratedAwardIdShape = /^CONT_IDV_[A-Z0-9_]+/.test(awardId);

    if (awardId) {
      const next = (awardIds.get(awardId) || 0) + 1;
      awardIds.set(awardId, next);
      if (next === 2) duplicateAwardIds.set(awardId, next);
      else if (next > 2) duplicateAwardIds.set(awardId, next);
    }

    if (hasGeneratedAwardIdShape) generatedAwardIdRows.push(row);
    increment(agencies, agency);
    increment(naicsCodes, naics);
    increment(recipients, recipient);

    if (isLikelyBadAiText(row.ai_generated_text) && questionableAiRows.length < 12) {
      questionableAiRows.push({
        awardId,
        agency,
        recipient: normalize(row.recipient_name),
        aiGeneratedText: normalize(row.ai_generated_text).slice(0, 180),
      });
    }

    if ((!awardId || !agency || !recipient || !naics) && missingCoreRows.length < 12) {
      missingCoreRows.push({
        awardId,
        agency,
        recipient: normalize(row.recipient_name),
        naics: normalize(row.NAICS),
      });
    }
  }

  const recompeteAwardIds = new Set(
    recompeteRows.map(row => normalizeAwardId(row['Award ID'])).filter(Boolean)
  );
  let exactRecompeteOverlap = 0;
  for (const awardId of awardIds.keys()) {
    if (recompeteAwardIds.has(awardId)) exactRecompeteOverlap += 1;
  }

  const badAiCount = rows.reduce(
    (count, row) => count + (isLikelyBadAiText(row.ai_generated_text) ? 1 : 0),
    0
  );

  const report = {
    file: path.relative(rootDir, csvPath),
    rowCount: rows.length,
    uniqueAwardIds: awardIds.size,
    duplicateAwardIdCount: duplicateAwardIds.size,
    generatedUniqueAwardIdShape: {
      count: generatedAwardIdRows.length,
      percent: percent(generatedAwardIdRows.length, rows.length),
      note: 'Rows matching CONT_IDV_* look like USAspending generated_unique_award_id values.',
    },
    exactOverlapWithCurrentRecompeteAwards: exactRecompeteOverlap,
    completeness: Object.fromEntries(
      Object.entries(completeness).map(([field, count]) => [
        field,
        { present: count, missing: rows.length - count, percent: percent(count, rows.length) },
      ])
    ),
    questionableAiText: {
      count: badAiCount,
      percent: percent(badAiCount, rows.length),
      samples: questionableAiRows,
    },
    missingCoreFieldSamples: missingCoreRows,
    topAgencies: topEntries(agencies),
    topNaics: topEntries(naicsCodes),
    topRecipients: topEntries(recipients),
    recommendation: [
      'Do not use this as the expiring-contract/recompete source.',
      'Use only as provisional vehicle/holder enrichment after spot-checking award IDs against USAspending.',
      'If USAspending validation fails or freshness is unclear, rebuild the IDV enrichment table directly from USAspending.',
    ],
  };

  return report;
}

function main() {
  const rows = loadIdiqRows(csvPath);
  const recompeteRows = loadRecompeteRows();
  const report = auditIdiq(rows, recompeteRows);

  console.log(JSON.stringify(report, null, 2));
}

main();
