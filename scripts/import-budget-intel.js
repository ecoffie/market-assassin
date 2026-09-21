#!/usr/bin/env node

/**
 * Import existing budget/pain points JSON data into database tables
 *
 * Usage: node scripts/import-budget-intel.js
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

// NAICS to category mapping
const naicsCategoryMap = {
  '541512': ['cybersecurity', 'modernization', 'infrastructure'],
  '541511': ['cybersecurity', 'modernization'],
  '541519': ['cybersecurity', 'modernization', 'infrastructure'],
  '541330': ['infrastructure', 'modernization', 'research'],
  '541611': ['compliance', 'operations', 'workforce'],
  '541613': ['compliance', 'operations'],
  '541614': ['logistics', 'operations'],
  '541690': ['research', 'compliance'],
  '541715': ['research', 'modernization'],
  '541990': ['operations', 'compliance'],
  '561210': ['logistics', 'operations', 'workforce'],
  '561320': ['workforce', 'operations'],
  '236220': ['infrastructure'],
  '237310': ['infrastructure'],
  '238210': ['infrastructure'],
};

// Category to NAICS reverse mapping
function categoryToNaics(category) {
  const naics = [];
  for (const [code, cats] of Object.entries(naicsCategoryMap)) {
    if (cats.includes(category)) {
      naics.push(code);
    }
  }
  return naics;
}

// Categorize pain point
function categorize(text) {
  const lower = text.toLowerCase();
  const keywords = {
    cybersecurity: ['cyber', 'security', 'zero trust', 'cmmc', 'authentication', 'encryption', 'threat'],
    infrastructure: ['infrastructure', 'facility', 'building', 'construction', 'network', 'cloud', 'data center'],
    modernization: ['modernization', 'digital', 'transformation', 'upgrade', 'legacy', 'ai', 'automation'],
    compliance: ['compliance', 'regulatory', 'audit', 'ndaa', 'mandate', 'policy', 'fitara'],
    workforce: ['workforce', 'recruitment', 'retention', 'training', 'skills', 'personnel', 'talent'],
    logistics: ['logistics', 'supply chain', 'procurement', 'inventory', 'distribution'],
    research: ['research', 'r&d', 'development', 'innovation', 'prototype', 'sbir'],
    operations: ['operations', 'maintenance', 'sustainment', 'support', 'services', 'o&m'],
  };

  for (const [category, kws] of Object.entries(keywords)) {
    if (kws.some(kw => lower.includes(kw))) {
      return category;
    }
  }
  return 'other';
}

// Determine source type from text
function getSource(text) {
  const lower = text.toLowerCase();
  if (lower.includes('ndaa')) return 'ndaa';
  if (lower.includes('executive order')) return 'manual';
  if (lower.includes('gao')) return 'gao';
  return 'import';
}

// Determine urgency from text
function getUrgency(text) {
  const lower = text.toLowerCase();
  if (lower.includes('critical') || lower.includes('immediate')) return 'critical';
  if (lower.includes('priority') || lower.includes('urgent')) return 'high';
  if (lower.includes('mandate') || lower.includes('ndaa')) return 'high';
  return 'medium';
}

// Parse funding amount from priority text
function parseFundingAmount(str) {
  const match = str.match(/\$([\d.,]+)\s*(B|M|K)?/i);
  if (!match) return null;

  const num = parseFloat(match[1].replace(/,/g, ''));
  if (isNaN(num)) return null;

  const multiplier = match[2]?.toUpperCase();
  if (multiplier === 'B') return num * 1e9;
  if (multiplier === 'M') return num * 1e6;
  if (multiplier === 'K') return num * 1e3;
  return num;
}

// Parse fiscal year from priority text
function parseFiscalYear(str) {
  const match = str.match(/FY\s*(20\d{2})(?:[-–](20)?(\d{2,4}))?/i);
  if (!match) return null;
  return match[0];
}

async function importData() {
  console.log('Starting Budget Intelligence import...\n');

  // Start sync run record
  const { data: syncRun, error: syncError } = await supabase
    .from('budget_intel_sync_runs')
    .insert({
      run_type: 'import',
      status: 'running',
    })
    .select()
    .single();

  if (syncError) {
    console.error('Failed to create sync run:', syncError.message);
    // Continue anyway
  }

  let stats = {
    budgetAuthority: { added: 0, updated: 0, errors: 0 },
    painPoints: { added: 0, updated: 0, errors: 0 },
    priorities: { added: 0, updated: 0, errors: 0 },
  };

  // ============================================================================
  // 1. Import Budget Authority Data
  // ============================================================================
  console.log('1. Importing budget authority data...');

  const budgetPath = path.join(__dirname, '..', 'src', 'data', 'agency-budget-data.json');
  const budgetData = JSON.parse(fs.readFileSync(budgetPath, 'utf8'));

  for (const [agencyName, data] of Object.entries(budgetData.agencies)) {
    // FY2025 record
    const fy25Record = {
      agency: agencyName,
      toptier_code: data.toptierCode,
      fiscal_year: 2025,
      budget_authority: data.fy2025.budgetAuthority,
      obligated: data.fy2025.obligated || 0,
      outlays: data.fy2025.outlays || 0,
      prior_year_authority: null,
      change_amount: null,
      change_percent: null,
      trend: null,
    };

    // FY2026 record with trends
    const fy26Record = {
      agency: agencyName,
      toptier_code: data.toptierCode,
      fiscal_year: 2026,
      budget_authority: data.fy2026.budgetAuthority,
      obligated: data.fy2026.obligated || 0,
      outlays: data.fy2026.outlays || 0,
      prior_year_authority: data.fy2025.budgetAuthority,
      change_amount: data.change.amount,
      change_percent: data.change.percent,
      trend: data.change.trend,
    };

    // Upsert both
    for (const record of [fy25Record, fy26Record]) {
      const { error } = await supabase
        .from('agency_budget_authority')
        .upsert(record, { onConflict: 'agency,fiscal_year' });

      if (error) {
        console.error(`  Error for ${agencyName} FY${record.fiscal_year}:`, error.message);
        stats.budgetAuthority.errors++;
      } else {
        stats.budgetAuthority.added++;
      }
    }
  }

  console.log(`   Budget authority: ${stats.budgetAuthority.added} records, ${stats.budgetAuthority.errors} errors\n`);

  // ============================================================================
  // 2. Import Pain Points
  // ============================================================================
  console.log('2. Importing pain points...');

  const painPointsPath = path.join(__dirname, '..', 'src', 'data', 'agency-pain-points.json');
  const painPointsData = JSON.parse(fs.readFileSync(painPointsPath, 'utf8'));

  const painPointBatch = [];

  for (const [agencyName, data] of Object.entries(painPointsData.agencies)) {
    if (!data.painPoints || !Array.isArray(data.painPoints)) continue;

    for (const pp of data.painPoints) {
      const category = categorize(pp);
      const naicsCodes = categoryToNaics(category);

      painPointBatch.push({
        agency: agencyName,
        pain_point: pp.substring(0, 1000), // Truncate if needed
        category,
        source: getSource(pp),
        naics_codes: naicsCodes.length > 0 ? naicsCodes : null,
        urgency: getUrgency(pp),
        verified: false,
      });
    }
  }

  // Batch upsert in chunks of 100
  const batchSize = 100;
  for (let i = 0; i < painPointBatch.length; i += batchSize) {
    const batch = painPointBatch.slice(i, i + batchSize);

    const { error } = await supabase
      .from('agency_pain_points_db')
      .upsert(batch, { onConflict: 'agency,pain_point' });

    if (error) {
      console.error(`  Batch ${i}-${i + batchSize} error:`, error.message);
      stats.painPoints.errors += batch.length;
    } else {
      stats.painPoints.added += batch.length;
    }

    process.stdout.write(`\r   Processed ${Math.min(i + batchSize, painPointBatch.length)}/${painPointBatch.length} pain points...`);
  }

  console.log(`\n   Pain points: ${stats.painPoints.added} records, ${stats.painPoints.errors} errors\n`);

  // ============================================================================
  // 3. Import Priorities
  // ============================================================================
  console.log('3. Importing priorities...');

  const priorityBatch = [];

  for (const [agencyName, data] of Object.entries(painPointsData.agencies)) {
    if (!data.priorities || !Array.isArray(data.priorities)) continue;

    for (const priority of data.priorities) {
      const category = categorize(priority);
      const naicsCodes = categoryToNaics(category);
      const fundingAmount = parseFundingAmount(priority);
      const fiscalYear = parseFiscalYear(priority);

      // Extract keywords
      const keywords = [];
      if (priority.toLowerCase().includes('cyber')) keywords.push('cybersecurity');
      if (priority.toLowerCase().includes('ai') || priority.toLowerCase().includes('artificial intelligence')) keywords.push('ai');
      if (priority.toLowerCase().includes('cloud')) keywords.push('cloud');
      if (priority.toLowerCase().includes('supply chain')) keywords.push('supply_chain');
      if (priority.toLowerCase().includes('modernization')) keywords.push('modernization');

      priorityBatch.push({
        agency: agencyName,
        priority_description: priority.substring(0, 2000), // Truncate if needed
        funding_amount: fundingAmount,
        fiscal_year: fiscalYear,
        category,
        naics_codes: naicsCodes.length > 0 ? naicsCodes : null,
        keywords: keywords.length > 0 ? keywords : null,
        source: 'import',
      });
    }
  }

  // Batch upsert
  for (let i = 0; i < priorityBatch.length; i += batchSize) {
    const batch = priorityBatch.slice(i, i + batchSize);

    const { error } = await supabase
      .from('agency_priorities_db')
      .upsert(batch, { onConflict: 'agency,priority_description' });

    if (error) {
      console.error(`  Batch ${i}-${i + batchSize} error:`, error.message);
      stats.priorities.errors += batch.length;
    } else {
      stats.priorities.added += batch.length;
    }

    process.stdout.write(`\r   Processed ${Math.min(i + batchSize, priorityBatch.length)}/${priorityBatch.length} priorities...`);
  }

  console.log(`\n   Priorities: ${stats.priorities.added} records, ${stats.priorities.errors} errors\n`);

  // ============================================================================
  // 4. Update sync run record
  // ============================================================================
  if (syncRun) {
    await supabase
      .from('budget_intel_sync_runs')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        pain_points_added: stats.painPoints.added,
        priorities_added: stats.priorities.added,
        metadata: stats,
      })
      .eq('id', syncRun.id);
  }

  // ============================================================================
  // 5. Verify counts
  // ============================================================================
  console.log('4. Verifying counts...');

  const [budgetCount, painPointCount, priorityCount] = await Promise.all([
    supabase.from('agency_budget_authority').select('*', { count: 'exact', head: true }),
    supabase.from('agency_pain_points_db').select('*', { count: 'exact', head: true }),
    supabase.from('agency_priorities_db').select('*', { count: 'exact', head: true }),
  ]);

  console.log(`
=== Import Complete ===

Database Counts:
  agency_budget_authority:  ${budgetCount.count} records
  agency_pain_points_db:    ${painPointCount.count} records
  agency_priorities_db:     ${priorityCount.count} records

Source Counts:
  Budget agencies in JSON:  ${Object.keys(budgetData.agencies).length}
  Pain point agencies:      ${Object.keys(painPointsData.agencies).length}
  Total pain points:        ${painPointBatch.length}
  Total priorities:         ${priorityBatch.length}
`);
}

importData().catch(console.error);
