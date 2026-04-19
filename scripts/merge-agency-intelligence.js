#!/usr/bin/env node
/**
 * Merge Agency Intelligence from Supabase into agency-pain-points.json
 *
 * Converts:
 * - GAO high-risk reports -> pain points
 * - Contract patterns (spending data) -> priorities
 *
 * Usage:
 *   node scripts/merge-agency-intelligence.js --preview    # Preview only
 *   node scripts/merge-agency-intelligence.js --merge      # Merge into JSON
 */

const fs = require('fs');
const path = require('path');

const SUPABASE_URL = 'https://krpyelfrbicmvsmwovti.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtycHllbGZyYmljbXZzbXdvdnRpIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2ODA3NTUwMCwiZXhwIjoyMDgzNjUxNTAwfQ.vt66ATmjPwS0HclhBP1g1-dQ-aEPEbWwG4xcn8j4GCg';

const PAIN_POINTS_PATH = path.join(__dirname, '../src/data/agency-pain-points.json');

async function fetchAgencyIntelligence() {
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/agency_intelligence?select=*`,
    {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
      },
    }
  );

  if (!response.ok) {
    throw new Error(`Supabase error: ${response.status}`);
  }

  return response.json();
}

function convertToPainPointsFormat(dbRecords) {
  // Group by agency
  const byAgency = {};

  for (const record of dbRecords) {
    const agency = record.agency_name;
    if (!byAgency[agency]) {
      byAgency[agency] = {
        painPoints: [],
        priorities: [],
      };
    }

    // Convert based on type
    if (record.intelligence_type === 'gao_high_risk') {
      // GAO reports become pain points
      const painPoint = `${record.title} (Source: GAO)`;
      if (!byAgency[agency].painPoints.includes(painPoint)) {
        byAgency[agency].painPoints.push(painPoint);
      }
    } else if (record.intelligence_type === 'contract_pattern') {
      // Spending patterns become priorities
      const priority = record.description || record.title;
      if (!byAgency[agency].priorities.includes(priority)) {
        byAgency[agency].priorities.push(priority);
      }
    } else if (record.intelligence_type === 'budget_priority') {
      // Budget items become priorities
      const priority = record.description || record.title;
      if (!byAgency[agency].priorities.includes(priority)) {
        byAgency[agency].priorities.push(priority);
      }
    }
  }

  return byAgency;
}

async function main() {
  const mode = process.argv[2] || '--preview';

  console.log('=== Agency Intelligence Merger ===\n');

  // Load existing pain points
  const existingData = JSON.parse(fs.readFileSync(PAIN_POINTS_PATH, 'utf-8'));
  const existingAgencies = Object.keys(existingData.agencies);
  console.log(`Existing agencies in JSON: ${existingAgencies.length}`);

  // Fetch from database
  console.log('Fetching from Supabase...');
  const dbRecords = await fetchAgencyIntelligence();
  console.log(`Database records: ${dbRecords.length}`);

  // Convert to pain points format
  const converted = convertToPainPointsFormat(dbRecords);
  const dbAgencies = Object.keys(converted);
  console.log(`Database agencies: ${dbAgencies.length}`);

  // Find agencies NOT in existing JSON
  const newAgencies = dbAgencies.filter(a =>
    !existingAgencies.includes(a) &&
    a !== 'General Government' &&
    a !== 'Executive Branch'
  );
  console.log(`\nNew agencies to add: ${newAgencies.length}`);

  // Find agencies that exist but can be enhanced
  const enhanceable = dbAgencies.filter(a => existingAgencies.includes(a));
  console.log(`Agencies to enhance: ${enhanceable.length}`);

  if (mode === '--preview') {
    console.log('\n=== NEW AGENCIES (preview) ===');
    for (const agency of newAgencies.slice(0, 20)) {
      const data = converted[agency];
      console.log(`\n${agency}:`);
      console.log(`  Pain points: ${data.painPoints.length}`);
      console.log(`  Priorities: ${data.priorities.length}`);
      if (data.painPoints.length > 0) {
        console.log(`  Sample: "${data.painPoints[0].slice(0, 60)}..."`);
      }
    }

    if (newAgencies.length > 20) {
      console.log(`\n... and ${newAgencies.length - 20} more agencies`);
    }

    console.log('\n=== ENHANCEMENTS (preview) ===');
    let enhancedCount = 0;
    for (const agency of enhanceable.slice(0, 10)) {
      const existing = existingData.agencies[agency];
      const newData = converted[agency];

      const newPainPoints = newData.painPoints.filter(p =>
        !existing.painPoints.some(ep => ep.includes(p.split(' (Source:')[0].slice(0, 30)))
      );
      const newPriorities = newData.priorities.filter(p =>
        !existing.priorities.some(ep => ep.includes(p.slice(0, 30)))
      );

      if (newPainPoints.length > 0 || newPriorities.length > 0) {
        console.log(`\n${agency}:`);
        console.log(`  New pain points: ${newPainPoints.length}`);
        console.log(`  New priorities: ${newPriorities.length}`);
        enhancedCount++;
      }
    }

    console.log('\n=== SUMMARY ===');
    console.log(`Current agencies: ${existingAgencies.length}`);
    console.log(`New agencies: ${newAgencies.length}`);
    console.log(`Total after merge: ${existingAgencies.length + newAgencies.length}`);
    console.log('\nRun with --merge to apply changes');

  } else if (mode === '--merge') {
    console.log('\n=== MERGING ===');

    let addedAgencies = 0;
    let addedPainPoints = 0;
    let addedPriorities = 0;

    // Add new agencies
    for (const agency of newAgencies) {
      const data = converted[agency];
      if (data.painPoints.length > 0 || data.priorities.length > 0) {
        existingData.agencies[agency] = {
          painPoints: data.painPoints,
          priorities: data.priorities,
        };
        addedAgencies++;
        addedPainPoints += data.painPoints.length;
        addedPriorities += data.priorities.length;
      }
    }

    // Enhance existing agencies
    for (const agency of enhanceable) {
      const existing = existingData.agencies[agency];
      const newData = converted[agency];

      // Add new pain points (dedupe)
      for (const pp of newData.painPoints) {
        const shortText = pp.split(' (Source:')[0].slice(0, 30);
        if (!existing.painPoints.some(ep => ep.includes(shortText))) {
          existing.painPoints.push(pp);
          addedPainPoints++;
        }
      }

      // Add new priorities (dedupe)
      for (const pr of newData.priorities) {
        const shortText = pr.slice(0, 30);
        if (!existing.priorities.some(ep => ep.includes(shortText))) {
          existing.priorities.push(pr);
          addedPriorities++;
        }
      }
    }

    // Write back
    fs.writeFileSync(PAIN_POINTS_PATH, JSON.stringify(existingData, null, 2));

    console.log(`Added ${addedAgencies} new agencies`);
    console.log(`Added ${addedPainPoints} pain points`);
    console.log(`Added ${addedPriorities} priorities`);
    console.log(`\nTotal agencies: ${Object.keys(existingData.agencies).length}`);
    console.log(`\nWritten to: ${PAIN_POINTS_PATH}`);
  }
}

main().catch(console.error);
