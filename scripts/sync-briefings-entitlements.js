const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const ROOT = path.resolve(__dirname, '..');
const ROLLBACK_PATH = path.join(ROOT, 'scripts', 'rollback_briefings_entitlement_sync_2026-04-30.sql');
const ENTITLED_ACCESS = new Set(['lifetime', '1_year', '6_month', 'subscription', 'beta_preview']);

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

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

function normalize(email) {
  return String(email || '').toLowerCase().trim();
}

function sqlString(value) {
  if (value === null || value === undefined) return 'NULL';
  return `'${String(value).replace(/'/g, "''")}'`;
}

function sqlBool(value) {
  if (value === null || value === undefined) return 'NULL';
  return value ? 'TRUE' : 'FALSE';
}

function shouldEnableBriefings(row) {
  return ENTITLED_ACCESS.has(row.briefings_access || '');
}

async function fetchAll(table, select, order = 'email') {
  const rows = [];
  const pageSize = 1000;

  for (let from = 0; ; from += pageSize) {
    let query = supabase.from(table).select(select).range(from, from + pageSize - 1);
    if (order) query = query.order(order);
    const { data, error } = await query;
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...(data || []));
    if (!data || data.length < pageSize) break;
  }

  return rows;
}

async function ensureAuditColumn() {
  const sql = 'ALTER TABLE user_notification_settings ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMPTZ';
  const { error } = await supabase.rpc('exec_sql', { sql });
  if (error) {
    console.warn(`[sync] Could not add last_synced_at with exec_sql: ${error.message}`);
    return false;
  }
  return true;
}

async function fetchNotificationSettings(includeAuditColumn) {
  const base = 'user_email, is_active, alerts_enabled, briefings_enabled, briefing_frequency, updated_at';
  const select = includeAuditColumn ? `${base}, last_synced_at` : base;
  return fetchAll('user_notification_settings', select, 'user_email');
}

function buildRollback(existingRows, insertedEmails, hadAuditColumn) {
  const lines = [
    '-- Rollback briefings entitlement sync run on 2026-04-30',
    'BEGIN;',
  ];

  for (const email of insertedEmails) {
    lines.push(`DELETE FROM user_notification_settings WHERE user_email = ${sqlString(email)};`);
  }

  for (const row of existingRows) {
    const assignments = [
      `briefings_enabled = ${sqlBool(row.briefings_enabled)}`,
      `alerts_enabled = ${sqlBool(row.alerts_enabled)}`,
      `is_active = ${sqlBool(row.is_active)}`,
      `briefing_frequency = ${sqlString(row.briefing_frequency)}`,
      `updated_at = ${sqlString(row.updated_at)}`,
    ];
    if (hadAuditColumn) {
      assignments.push(`last_synced_at = ${sqlString(row.last_synced_at)}`);
    }
    lines.push(
      `UPDATE user_notification_settings SET ${assignments.join(', ')} WHERE user_email = ${sqlString(row.user_email)};`
    );
  }

  lines.push('COMMIT;');
  return `${lines.join('\n')}\n`;
}

async function main() {
  const execute = process.argv.includes('--execute');
  const hadAuditColumn = await ensureAuditColumn();
  const [classificationRows, existingSettings] = await Promise.all([
    fetchAll('customer_classifications', 'email, briefings_access, briefings_expiry, classification_version', 'email'),
    fetchNotificationSettings(hadAuditColumn),
  ]);

  const latestVersion = Math.max(...classificationRows.map(row => Number(row.classification_version || 0)));
  const latestClassifications = classificationRows.filter(row => Number(row.classification_version || 0) === latestVersion);
  const classificationsByEmail = new Map(latestClassifications.map(row => [normalize(row.email), row]));
  const existingByEmail = new Map(existingSettings.map(row => [normalize(row.user_email), row]));
  const allEmails = new Set([...classificationsByEmail.keys(), ...existingByEmail.keys()].filter(Boolean));

  const now = new Date().toISOString();
  const upserts = [];
  const existingRowsToRollback = [];
  const insertedEmails = [];

  for (const email of allEmails) {
    const classification = classificationsByEmail.get(email);
    const existing = existingByEmail.get(email);
    const entitled = classification ? shouldEnableBriefings(classification) : false;

    if (existing) {
      existingRowsToRollback.push(existing);
    } else {
      insertedEmails.push(email);
    }

    const record = {
      user_email: email,
      briefings_enabled: entitled,
      // Entitled customers need to be active so they can receive the new paid feature.
      // Existing non-entitled users keep their active/alert state for normal alerts.
      is_active: entitled ? true : (existing?.is_active ?? false),
      alerts_enabled: existing?.alerts_enabled ?? false,
      briefing_frequency: existing?.briefing_frequency || 'daily',
      updated_at: now,
    };
    if (hadAuditColumn) record.last_synced_at = now;
    upserts.push(record);
  }

  const entitledCount = upserts.filter(row => row.briefings_enabled).length;
  const disabledCount = upserts.filter(row => !row.briefings_enabled).length;
  const changedExisting = upserts.filter(row => {
    const existing = existingByEmail.get(row.user_email);
    return existing && existing.briefings_enabled !== row.briefings_enabled;
  });

  const rollbackSql = buildRollback(existingRowsToRollback, insertedEmails, hadAuditColumn);
  fs.writeFileSync(ROLLBACK_PATH, rollbackSql);

  if (execute) {
    for (let i = 0; i < upserts.length; i += 500) {
      const batch = upserts.slice(i, i + 500);
      const { error } = await supabase
        .from('user_notification_settings')
        .upsert(batch, { onConflict: 'user_email' });
      if (error) throw new Error(`upsert failed: ${error.message}`);
    }
  }

  const postRows = execute ? await fetchNotificationSettings(hadAuditColumn) : existingSettings;
  const postTrue = postRows.filter(row => row.briefings_enabled).length;
  const postFalse = postRows.filter(row => row.briefings_enabled === false).length;

  console.log(JSON.stringify({
    mode: execute ? 'execute' : 'dry-run',
    latestClassificationVersion: latestVersion,
    classificationRows: latestClassifications.length,
    totalNotificationRowsAfterSync: execute ? postRows.length : upserts.length,
    expectedBriefingsEnabledTrue: entitledCount,
    expectedBriefingsEnabledFalse: disabledCount,
    actualBriefingsEnabledTrue: postTrue,
    actualBriefingsEnabledFalse: postFalse,
    existingNotificationRows: existingSettings.length,
    rowsToInsert: insertedEmails.length,
    existingRowsChanged: changedExisting.length,
    auditColumnPresent: hadAuditColumn,
    rollbackPath: ROLLBACK_PATH,
    sampleInsertedEmails: insertedEmails.slice(0, 10),
    sampleChangedExisting: changedExisting.slice(0, 10).map(row => ({
      email: row.user_email,
      newBriefingsEnabled: row.briefings_enabled,
      oldBriefingsEnabled: existingByEmail.get(row.user_email)?.briefings_enabled,
    })),
  }, null, 2));
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
