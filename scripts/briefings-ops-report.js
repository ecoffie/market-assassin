#!/usr/bin/env node

/*
 * Read-only operations report for alerts and briefings.
 *
 * Usage:
 *   node scripts/briefings-ops-report.js
 *   node scripts/briefings-ops-report.js --date=2026-05-01
 *   node scripts/briefings-ops-report.js --json
 */

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const ROOT = path.resolve(__dirname, '..');

function loadEnv(filename) {
  const file = path.join(ROOT, filename);
  if (!fs.existsSync(file)) return;

  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key]) continue;
    process.env[key] = rawValue.replace(/^['"]|['"]$/g, '').replace(/\\n/g, '').trim();
  }
}

loadEnv('.env.local');
loadEnv('.env.codex-production');

const args = process.argv.slice(2);
const getArg = (name, fallback = null) => {
  const prefix = `--${name}=`;
  const found = args.find(arg => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
};

function getDefaultReportDate() {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return now.getUTCHours() >= 13 ? today : yesterday;
}

const reportDate = getArg('date', getDefaultReportDate());
const outputJson = args.includes('--json');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false },
});

const warnings = [];

function isSchemaError(error) {
  const message = String(error?.message || '');
  return (
    message.includes('Could not find the table') ||
    message.includes('Could not find') ||
    message.includes('schema cache') ||
    message.includes('does not exist')
  );
}

async function safeCount(label, table, apply) {
  let query = supabase.from(table).select('*', { count: 'exact', head: true });
  if (apply) query = apply(query);
  const { count, error } = await query;
  if (error) {
    warnings.push(`${label}: ${error.message}`);
    return null;
  }
  return count || 0;
}

async function safeRows(label, table, select, apply, limit = 1000) {
  let query = supabase.from(table).select(select).limit(limit);
  if (apply) query = apply(query);
  const { data, error } = await query;
  if (error) {
    if (!isSchemaError(error)) warnings.push(`${label}: ${error.message}`);
    else warnings.push(`${label}: table/column unavailable`);
    return [];
  }
  return data || [];
}

async function fetchBriefingDeliveryRows(label, briefingType) {
  const tomorrow = new Date(`${reportDate}T00:00:00Z`);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const tomorrowDate = tomorrow.toISOString().slice(0, 10);

  const sentRows = await safeRows(
    `${label} sent`,
    'briefing_log',
    'user_email, delivery_status, briefing_type, email_sent_at',
    q => q
      .eq('briefing_type', briefingType)
      .gte('email_sent_at', `${reportDate}T00:00:00Z`)
      .lt('email_sent_at', `${tomorrowDate}T00:00:00Z`),
    5000
  );

  const unsentRows = await safeRows(
    `${label} unsent`,
    'briefing_log',
    'user_email, delivery_status, briefing_type, briefing_date',
    q => q
      .eq('briefing_type', briefingType)
      .eq('briefing_date', reportDate)
      .in('delivery_status', ['pending', 'failed', 'skipped']),
    5000
  );

  return [...sentRows, ...unsentRows];
}

function countBy(rows, key) {
  return rows.reduce((acc, row) => {
    const value = row[key] ?? 'null';
    acc[value] = (acc[value] || 0) + 1;
    return acc;
  }, {});
}

function hasProfileSignal(row) {
  return (
    Array.isArray(row.naics_codes) && row.naics_codes.length > 0
  ) || (
    Array.isArray(row.keywords) && row.keywords.length > 0
  ) || (
    Array.isArray(row.agencies) && row.agencies.length > 0
  );
}

function renderMarkdown(report) {
  const lines = [];
  lines.push(`# Briefings Ops Report - ${report.date}`);
  lines.push('');
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push('');

  lines.push('## Audience');
  lines.push('');
  lines.push(`- Active notification rows: ${report.audience.activeNotificationRows ?? 'unknown'}`);
  lines.push(`- Alerts enabled: ${report.audience.alertsEnabled ?? 'unknown'}`);
  lines.push(`- Briefings enabled: ${report.audience.briefingsEnabled ?? 'unknown'}`);
  lines.push(`- Briefings enabled with no NAICS/keywords/agencies: ${report.audience.briefingsProfileGaps}`);
  lines.push('');

  lines.push('## Deliveries');
  lines.push('');
  lines.push('| Type | Total | Status Counts |');
  lines.push('|---|---:|---|');
  for (const row of report.deliveries) {
    lines.push(`| ${row.name} | ${row.total} | ${JSON.stringify(row.statusCounts)} |`);
  }
  lines.push('');

  lines.push('## Templates');
  lines.push('');
  lines.push('| Type | Templates For Date | Recent Runs |');
  lines.push('|---|---:|---:|');
  for (const row of report.templates) {
    lines.push(`| ${row.type} | ${row.templateCount ?? 'unknown'} | ${row.recentRunCount ?? 'unknown'} |`);
  }
  lines.push('');

  lines.push('## Errors And Recovery');
  lines.push('');
  lines.push(`- Open dead-letter rows: ${report.recovery.openDeadLetters ?? 'unknown'}`);
  lines.push(`- Unresolved tool errors: ${report.recovery.unresolvedToolErrors ?? 'unknown'}`);
  lines.push('');

  if (report.recommendations.length > 0) {
    lines.push('## Recommendations');
    lines.push('');
    report.recommendations.forEach(item => lines.push(`- ${item}`));
    lines.push('');
  }

  if (report.warnings.length > 0) {
    lines.push('## Warnings');
    lines.push('');
    report.warnings.forEach(item => lines.push(`- ${item}`));
    lines.push('');
  }

  return lines.join('\n');
}

async function main() {
  const [
    activeNotificationRows,
    alertsEnabled,
    briefingsEnabled,
    notificationProfiles,
    dailyAlerts,
    weeklyAlerts,
    dailyTemplates,
    weeklyTemplates,
    pursuitTemplates,
    recentRuns,
    openDeadLetters,
    unresolvedToolErrors,
  ] = await Promise.all([
    safeCount('active notification rows', 'user_notification_settings', q => q.eq('is_active', true)),
    safeCount('alerts enabled', 'user_notification_settings', q => q.eq('is_active', true).eq('alerts_enabled', true)),
    safeCount('briefings enabled', 'user_notification_settings', q => q.eq('is_active', true).eq('briefings_enabled', true)),
    safeRows(
      'notification profile gaps',
      'user_notification_settings',
      'user_email, naics_codes, keywords, agencies, is_active, briefings_enabled',
      q => q.eq('is_active', true).eq('briefings_enabled', true),
      5000
    ),
    safeRows('daily alerts', 'alert_log', 'user_email, delivery_status, alert_type', q => q.eq('alert_date', reportDate).eq('alert_type', 'daily')),
    safeRows('weekly alerts', 'alert_log', 'user_email, delivery_status, alert_type', q => q.eq('alert_date', reportDate).eq('alert_type', 'weekly')),
    safeCount('daily templates', 'briefing_templates', q => q.eq('template_date', reportDate).eq('briefing_type', 'daily')),
    safeCount('weekly templates', 'briefing_templates', q => q.eq('template_date', reportDate).eq('briefing_type', 'weekly')),
    safeCount('pursuit templates', 'briefing_templates', q => q.eq('template_date', reportDate).eq('briefing_type', 'pursuit')),
    safeRows(
      'recent precompute runs',
      'briefing_precompute_runs',
      'briefing_type, status, run_date, created_at',
      q => q.order('created_at', { ascending: false }),
      25
    ),
    safeCount('open dead letters', 'briefing_dead_letter', q => q.in('status', ['pending', 'retrying'])),
    safeCount('unresolved tool errors', 'tool_errors', q => q.eq('is_resolved', false)),
  ]);

  const [dailyBriefings, weeklyBriefings, pursuitBriefings] = await Promise.all([
    fetchBriefingDeliveryRows('daily briefings', 'daily'),
    fetchBriefingDeliveryRows('weekly briefings', 'weekly'),
    fetchBriefingDeliveryRows('pursuit briefings', 'pursuit'),
  ]);

  const profileGaps = notificationProfiles.filter(row => !hasProfileSignal(row));

  const deliveries = [
    { name: 'daily alerts', rows: dailyAlerts },
    { name: 'weekly alerts', rows: weeklyAlerts },
    { name: 'daily briefings', rows: dailyBriefings },
    { name: 'weekly briefings', rows: weeklyBriefings },
    { name: 'pursuit briefings', rows: pursuitBriefings },
  ].map(item => ({
    name: item.name,
    total: item.rows.length,
    statusCounts: countBy(item.rows, 'delivery_status'),
  }));

  const runCountsByType = countBy(recentRuns, 'briefing_type');
  const templates = [
    { type: 'daily', templateCount: dailyTemplates, recentRunCount: runCountsByType.daily || 0 },
    { type: 'weekly', templateCount: weeklyTemplates, recentRunCount: runCountsByType.weekly || 0 },
    { type: 'pursuit', templateCount: pursuitTemplates, recentRunCount: runCountsByType.pursuit || 0 },
  ];

  const recommendations = [];
  if (briefingsEnabled && dailyBriefings.length === 0) {
    recommendations.push('No daily briefing rows found for the report date. Check precompute/send cron windows and day guards.');
  }
  if (profileGaps.length > 0) {
    recommendations.push(`Briefings still has ${profileGaps.length} users with no NAICS, keywords, or agencies. Check the Profile Completion Reminder Agent before sending another reminder batch.`);
  }
  if (openDeadLetters && openDeadLetters > 0) {
    recommendations.push('Review briefing dead-letter queue and retry eligible rows.');
  }
  if (unresolvedToolErrors && unresolvedToolErrors > 0) {
    recommendations.push('Review unresolved tool_errors before the next send window.');
  }

  const report = {
    date: reportDate,
    generatedAt: new Date().toISOString(),
    audience: {
      activeNotificationRows,
      alertsEnabled,
      briefingsEnabled,
      briefingsProfileGaps: profileGaps.length,
      profileGapSample: profileGaps.slice(0, 10).map(row => row.user_email),
    },
    deliveries,
    templates,
    recovery: {
      openDeadLetters,
      unresolvedToolErrors,
    },
    recommendations,
    warnings,
  };

  console.log(outputJson ? JSON.stringify(report, null, 2) : renderMarkdown(report));
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
