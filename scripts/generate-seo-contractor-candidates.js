#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const OUT_JSON = '/tmp/mi-seo-contractor-candidates.json';
const OUT_MD = '/tmp/mi-seo-contractor-candidates.md';

const SOURCE_FILES = {
  contractors: 'src/data/contractors.json',
  primes: 'src/data/prime-contractors-database.json',
  tier2: 'src/data/tier2-contractors-database.json',
  contracts: 'src/data/contracts-data.json',
};

function readJson(relativePath, fallback) {
  const absolutePath = path.join(ROOT, relativePath);
  try {
    return JSON.parse(fs.readFileSync(absolutePath, 'utf8'));
  } catch (error) {
    return fallback;
  }
}

function sourceMeta(relativePath) {
  const absolutePath = path.join(ROOT, relativePath);
  try {
    const stat = fs.statSync(absolutePath);
    return {
      path: relativePath,
      found: true,
      updatedAt: stat.mtime.toISOString(),
      sizeBytes: stat.size,
    };
  } catch (error) {
    return {
      path: relativePath,
      found: false,
      updatedAt: null,
      sizeBytes: 0,
    };
  }
}

function normalizeName(value) {
  return String(value || '')
    .toUpperCase()
    .replace(/&/g, ' AND ')
    .replace(/\b(LLC|L L C|INC|INCORPORATED|CORP|CORPORATION|CO|COMPANY|LTD|LIMITED)\b/g, '')
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function titleCase(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\b[a-z]/g, (match) => match.toUpperCase())
    .replace(/\bLlc\b/g, 'LLC')
    .replace(/\bInc\b/g, 'Inc.')
    .replace(/\bUsa\b/g, 'USA');
}

function slugify(value) {
  const normalized = String(value || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
  return normalized || 'unknown-contractor';
}

function parseMoney(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const parsed = Number(String(value || '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function fiscalYear(date) {
  if (!date) return null;
  const year = date.getUTCFullYear();
  return date.getUTCMonth() >= 9 ? year + 1 : year;
}

function moneyCompact(value) {
  if (!value) return '$0';
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${Math.round(value / 1_000)}K`;
  return `$${Math.round(value)}`;
}

function addUnique(list, value) {
  const clean = String(value || '').trim();
  if (clean && !list.includes(clean)) list.push(clean);
}

function splitList(value) {
  if (Array.isArray(value)) return value.flatMap(splitList);
  return String(value || '')
    .split(/[,;|]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function createRecord(name) {
  const displayName = String(name || '').replace(/\s+/g, ' ').trim();
  return {
    contractorName: displayName,
    key: normalizeName(displayName),
    slug: slugify(displayName),
    aliases: [],
    agencies: [],
    naics: [],
    sources: [],
    contact: {
      hasSblo: false,
      hasEmail: false,
      hasPhone: false,
    },
    contracts: {
      count: 0,
      totalValue: 0,
      recentCount: 0,
      annualObligations: {},
      recentAwards: [],
    },
    directoryContractValue: 0,
    hasSubcontractPlan: false,
  };
}

function upsert(records, name) {
  const key = normalizeName(name);
  if (!key) return null;
  if (!records.has(key)) records.set(key, createRecord(name));
  const record = records.get(key);
  addUnique(record.aliases, name);
  return record;
}

function ingestContractorDirectory(records, rows) {
  for (const row of rows) {
    const record = upsert(records, row.company || row.name);
    if (!record) continue;

    addUnique(record.sources, row.source || 'contractors.json');
    for (const agency of splitList(row.agencies)) addUnique(record.agencies, titleCase(agency));
    for (const code of splitList(row.naics || row.naicsCategories)) addUnique(record.naics, code);

    record.contact.hasSblo = record.contact.hasSblo || Boolean(String(row.sblo_name || row.sbloName || '').trim());
    record.contact.hasEmail = record.contact.hasEmail || Boolean(row.has_email || row.email);
    record.contact.hasPhone = record.contact.hasPhone || Boolean(row.has_phone || row.phone);
    record.hasSubcontractPlan = record.hasSubcontractPlan || String(row.has_subcontract_plan || row.hasSubcontractPlan || '').toLowerCase() === 'true';

    const value = parseMoney(row.contract_value_num || row.total_contract_value || row.totalContractValue);
    record.directoryContractValue = Math.max(record.directoryContractValue, value);
    record.contracts.totalValue = Math.max(record.contracts.totalValue, value);
    record.contracts.count = Math.max(record.contracts.count, Number(row.contract_count || row.contractCount || 0) || 0);
  }
}

function ingestPrimeRecords(records, rows) {
  for (const row of rows) {
    const record = upsert(records, row.name || row.company);
    if (!record) continue;

    addUnique(record.sources, row.source || 'prime-contractors-database.json');
    for (const agency of splitList(row.agencies)) addUnique(record.agencies, titleCase(agency));
    for (const code of splitList(row.naicsCategories || row.naics)) addUnique(record.naics, code);

    record.contact.hasSblo = record.contact.hasSblo || Boolean(String(row.sbloName || '').trim());
    record.contact.hasEmail = record.contact.hasEmail || Boolean(row.email);
    record.contact.hasPhone = record.contact.hasPhone || Boolean(row.phone);
    record.hasSubcontractPlan = record.hasSubcontractPlan || Boolean(row.hasSubcontractPlan);

    const value = parseMoney(row.totalContractValue);
    record.directoryContractValue = Math.max(record.directoryContractValue, value);
    record.contracts.totalValue = Math.max(record.contracts.totalValue, value);
    record.contracts.count = Math.max(record.contracts.count, Number(row.contractCount || 0) || 0);
  }
}

function ingestTier2Records(records, rows) {
  for (const row of rows) {
    const record = upsert(records, row.name || row.company);
    if (!record) continue;

    addUnique(record.sources, row.source || 'tier2-contractors-database.json');
    for (const code of splitList(row.naicsCategories || row.naics)) addUnique(record.naics, code);
    record.contact.hasSblo = record.contact.hasSblo || Boolean(String(row.sbloName || '').trim());
    record.contact.hasEmail = record.contact.hasEmail || Boolean(row.email);
    record.contact.hasPhone = record.contact.hasPhone || Boolean(row.phone);
  }
}

function ingestContractAwards(records, rows) {
  for (const row of rows) {
    const record = upsert(records, row.Recipient || row.recipient || row.recipient_name);
    if (!record) continue;

    addUnique(record.sources, 'contracts-data.json');
    addUnique(record.agencies, row.Agency || row.agency || row.awarding_agency_name);

    const naics = String(row.NAICS || row.naics_code || '').split('-')[0].trim();
    addUnique(record.naics, naics);

    const value = parseMoney(row['Total Value'] || row.total_value || row.award_amount);
    const startDate = parseDate(row['Start Date'] || row.start_date || row.period_of_performance_start_date);
    const fy = fiscalYear(startDate);
    if (fy) record.contracts.annualObligations[fy] = (record.contracts.annualObligations[fy] || 0) + value;
    if (startDate && startDate >= new Date('2023-01-01T00:00:00Z')) record.contracts.recentCount += 1;

    record.contracts.count += 1;
    record.contracts.totalValue += value;
    if (record.contracts.recentAwards.length < 5) {
      record.contracts.recentAwards.push({
        title: row['Award ID'] || row.award_id || row.piid || 'Award record',
        agency: row.Agency || row.agency || null,
        naics,
        value,
        startDate: startDate ? startDate.toISOString().slice(0, 10) : null,
      });
    }
  }
}

function scoreRecord(record) {
  const totalValue = record.contracts.totalValue;
  const agencyCount = record.agencies.length;
  const naicsCount = record.naics.length;
  const annualYears = Object.keys(record.contracts.annualObligations).length;
  const contactCount = Number(record.contact.hasSblo) + Number(record.contact.hasEmail) + Number(record.contact.hasPhone);

  let score = 0;
  if (totalValue >= 1_000_000_000) score += 24;
  else if (totalValue >= 100_000_000) score += 20;
  else if (totalValue >= 10_000_000) score += 14;
  else if (totalValue >= 1_000_000) score += 8;

  score += Math.min(record.contracts.count, 10) * 2;
  score += Math.min(record.contracts.recentCount, 5) * 3;
  score += Math.min(annualYears, 5) * 5;
  score += Math.min(agencyCount, 5) * 2;
  score += Math.min(naicsCount, 5);
  score += contactCount * 4;
  if (record.hasSubcontractPlan) score += 4;
  if (record.sources.length >= 3) score += 5;

  return Math.min(score, 100);
}

function priorityFor(record, score) {
  const hasAwardHistory = record.contracts.count > 1 || Object.keys(record.contracts.annualObligations).length > 0;
  if (score >= 70 && hasAwardHistory) return 'build_now';
  if (score >= 55) return 'refresh_now';
  if (score >= 35) return 'monitor';
  if (record.contracts.totalValue === 0 && !record.contact.hasEmail && !record.contact.hasPhone) return 'do_not_publish_yet';
  return 'defer';
}

function coverageFor(record) {
  const annualYears = Object.keys(record.contracts.annualObligations).length;
  if (annualYears >= 3 && record.contracts.recentAwards.length >= 3) return 'strong';
  if (record.contracts.count > 0 || record.directoryContractValue > 0) return 'limited_award_cache';
  if (record.contact.hasEmail || record.contact.hasPhone || record.contact.hasSblo) return 'contact_only';
  return 'thin';
}

function buildCandidate(record) {
  const score = scoreRecord(record);
  const priority = priorityFor(record, score);
  const slug = record.slug;
  const coverage = coverageFor(record);
  const titleName = titleCase(record.contractorName);

  const gates = [
    'full_award_history',
    'contacts',
    'recompetes',
    'pipeline_actions',
    'teaming_actions',
  ];

  const recommendedActions = [];
  if (priority === 'build_now') recommendedActions.push('Create public contractor SEO page with 5-year sales chart.');
  if (priority === 'refresh_now') recommendedActions.push('Refresh existing contractor page and CTA placement.');
  if (coverage !== 'strong') recommendedActions.push('Label cache coverage honestly before publishing.');
  recommendedActions.push('Canonicalize public page to govcongiants.com.');
  recommendedActions.push('Deep-link gated workflow CTAs to mi.govcongiants.com.');

  return {
    contractorName: record.contractorName,
    slug,
    priority,
    score,
    publicUrl: `https://govcongiants.com/contractors/${slug}`,
    miUrl: `https://mi.govcongiants.com/contractors/${slug}`,
    dataCoverage: coverage,
    match: {
      method: record.sources.includes('contracts-data.json') ? 'recipient_name' : 'directory_name',
      confidence: record.sources.length >= 2 ? 'medium' : 'low',
    },
    seo: {
      targetKeywords: [
        `${titleName} federal contracts`,
        `${titleName} government contracts`,
        `${titleName} contract awards`,
      ],
      canonicalOk: false,
      recommendedTitle: `${titleName} Federal Contract Awards and Sales History`,
      recommendedDescription: `${titleName} federal contract awards, agencies, NAICS codes, recent wins, and sales history from GovCon Giants Market Intelligence.`,
    },
    publicPreview: {
      totalFederalObligations: record.contracts.totalValue,
      totalFederalObligationsLabel: moneyCompact(record.contracts.totalValue),
      contractCount: record.contracts.count,
      fiveYearObligationsAvailable: Object.keys(record.contracts.annualObligations).length >= 3,
      topAgenciesAvailable: record.agencies.length > 0,
      topNaicsAvailable: record.naics.length > 0,
      recentAwardsAvailable: record.contracts.recentAwards.length > 0,
      contactAvailability: {
        sblo: record.contact.hasSblo,
        email: record.contact.hasEmail,
        phone: record.contact.hasPhone,
      },
    },
    topAgencies: record.agencies.slice(0, 3),
    topNaics: record.naics.slice(0, 5),
    sources: record.sources,
    gates,
    recommendedActions,
  };
}

function groupCount(candidates, priority) {
  return candidates.filter((candidate) => candidate.priority === priority).length;
}

function generateMarkdown(report) {
  const lines = [];
  lines.push('# SEO Contractor Page Candidates');
  lines.push('');
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(`- Build now: ${report.summary.buildNow}`);
  lines.push(`- Refresh now: ${report.summary.refreshNow}`);
  lines.push(`- Monitor: ${report.summary.monitor}`);
  lines.push(`- Defer: ${report.summary.defer}`);
  lines.push(`- Do not publish yet: ${report.summary.doNotPublishYet}`);
  lines.push('');
  lines.push('## Domain Policy');
  lines.push('');
  lines.push(`- Public canonical: ${report.domainPolicy.publicCanonicalDomain}`);
  lines.push(`- MI app: ${report.domainPolicy.miAppDomain}`);
  lines.push(`- Transition-only domains: ${report.domainPolicy.transitionOnlyDomains.join(', ')}`);
  lines.push('');
  lines.push('## Top Build Candidates');
  lines.push('');
  for (const candidate of report.candidates.slice(0, 15)) {
    lines.push(`### ${candidate.contractorName}`);
    lines.push(`- Priority: ${candidate.priority} (${candidate.score})`);
    lines.push(`- Public: ${candidate.publicUrl}`);
    lines.push(`- MI: ${candidate.miUrl}`);
    lines.push(`- Coverage: ${candidate.dataCoverage}`);
    lines.push(`- Value: ${candidate.publicPreview.totalFederalObligationsLabel}`);
    lines.push(`- Agencies: ${candidate.topAgencies.join(', ') || 'Unknown'}`);
    lines.push(`- NAICS: ${candidate.topNaics.join(', ') || 'Unknown'}`);
    lines.push(`- Actions: ${candidate.recommendedActions.join(' ')}`);
    lines.push('');
  }
  lines.push('## Data Gaps');
  lines.push('');
  for (const gap of report.dataGaps) lines.push(`- ${gap}`);
  lines.push('');
  return lines.join('\n');
}

function main() {
  const contractors = readJson(SOURCE_FILES.contractors, []);
  const primePayload = readJson(SOURCE_FILES.primes, { primes: [] });
  const tier2Payload = readJson(SOURCE_FILES.tier2, { tier2Contractors: [] });
  const contracts = readJson(SOURCE_FILES.contracts, []);

  const records = new Map();
  ingestContractorDirectory(records, Array.isArray(contractors) ? contractors : []);
  ingestPrimeRecords(records, Array.isArray(primePayload.primes) ? primePayload.primes : []);
  ingestTier2Records(records, Array.isArray(tier2Payload.tier2Contractors) ? tier2Payload.tier2Contractors : []);
  ingestContractAwards(records, Array.isArray(contracts) ? contracts : []);

  const candidates = Array.from(records.values())
    .map(buildCandidate)
    .sort((a, b) => b.score - a.score || a.contractorName.localeCompare(b.contractorName));

  const publishableCandidates = candidates.filter((candidate) => candidate.priority !== 'do_not_publish_yet');
  const report = {
    generatedAt: new Date().toISOString(),
    sourceFiles: Object.values(SOURCE_FILES).map(sourceMeta),
    summary: {
      totalContractors: candidates.length,
      buildNow: groupCount(candidates, 'build_now'),
      refreshNow: groupCount(candidates, 'refresh_now'),
      monitor: groupCount(candidates, 'monitor'),
      defer: groupCount(candidates, 'defer'),
      doNotPublishYet: groupCount(candidates, 'do_not_publish_yet'),
      publishableCandidates: publishableCandidates.length,
    },
    domainPolicy: {
      publicCanonicalDomain: 'govcongiants.com',
      miAppDomain: 'mi.govcongiants.com',
      transitionOnlyDomains: ['govcongiants.org', 'tools.govcongiants.org', 'shop.govcongiants.com'],
    },
    publicVsGated: {
      public: [
        'Contractor name and aliases',
        'High-level obligation total',
        'Limited 5-year annual obligations chart when cache supports it',
        'Top agencies and NAICS codes',
        '3-5 recent awards when cache supports it',
        'Source and last-updated labels',
      ],
      gated: [
        'Full award history',
        'Contacts',
        'Exports',
        'Recompete connections',
        'Pipeline and teaming actions',
        'Saved searches and alerts',
      ],
    },
    candidates: publishableCandidates.slice(0, 100),
    thinCandidates: candidates
      .filter((candidate) => candidate.dataCoverage === 'thin' || candidate.dataCoverage === 'contact_only')
      .slice(0, 25)
      .map((candidate) => ({
        contractorName: candidate.contractorName,
        slug: candidate.slug,
        score: candidate.score,
        dataCoverage: candidate.dataCoverage,
        action: 'Do not publish a public SEO page until award history is loaded or the page is positioned as contact-only.',
      })),
    dataGaps: [
      'Search Console clicks/impressions are not connected to this read-only scorer yet.',
      'USASpending award-history cache coverage is partial; limited pages must say cached history is incomplete.',
      'Canonical status is marked false until a route crawl confirms govcongiants.com canonicals.',
      'MI usage events are not included yet, so product-demand scoring is conservative.',
      'Recompete and forecast joins are not included yet; those should become MI Pro gate signals.',
    ],
    outputs: {
      json: OUT_JSON,
      markdown: OUT_MD,
    },
  };

  fs.writeFileSync(OUT_JSON, JSON.stringify(report, null, 2));
  fs.writeFileSync(OUT_MD, generateMarkdown(report));

  console.log(JSON.stringify({
    generatedAt: report.generatedAt,
    sourceContractors: report.summary.totalContractors,
    buildNow: report.summary.buildNow,
    refreshNow: report.summary.refreshNow,
    monitor: report.summary.monitor,
    outputs: report.outputs,
  }, null, 2));
}

main();
