const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const { kv } = require('@vercel/kv');

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

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

async function count(table, apply) {
  let query = supabase.from(table).select('*', { count: 'exact', head: true });
  query = apply ? apply(query) : query;
  const { count: value, error } = await query;
  if (error) throw new Error(`${table} count failed: ${error.message}`);
  return value || 0;
}

async function fetchAll(table, select, order) {
  const rows = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    let query = supabase.from(table).select(select).range(from, from + pageSize - 1);
    if (order) query = query.order(order, { ascending: false });
    const { data, error } = await query;
    if (error) {
      if (error.message.includes('Could not find the table') || error.message.includes('schema cache')) return [];
      throw new Error(`${table} fetch failed: ${error.message}`);
    }
    rows.push(...(data || []));
    if (!data || data.length < pageSize) break;
  }
  return rows;
}

function normalize(email) {
  return String(email || '').toLowerCase().trim();
}

function isBriefingsAccessTrue(value) {
  return value && value !== 'none' && value !== 'false';
}

async function main() {
  const [
    notificationRows,
    classifications,
    smartProfiles,
    rolloutConfig,
    activeCohort,
  ] = await Promise.all([
    fetchAll(
      'user_notification_settings',
      'user_email, is_active, alerts_enabled, briefings_enabled, updated_at, naics_codes, agencies, keywords',
      'updated_at'
    ),
    fetchAll('customer_classifications', 'email, briefings_access, classification_version, updated_at', 'updated_at'),
    fetchAll('smart_user_profiles', 'email, updated_at, naics_codes, agencies', 'updated_at'),
    kv.get('briefings:rollout:config').catch(() => null),
    kv.get('briefings:rollout:active-cohort').catch(() => null),
  ]);

  const latestClassificationVersion = Math.max(
    ...classifications.map(row => Number(row.classification_version || 0))
  );
  const latestClassifications = classifications.filter(
    row => Number(row.classification_version || 0) === latestClassificationVersion
  );

  const notificationEmails = new Set(notificationRows.map(row => normalize(row.user_email)).filter(Boolean));
  const smartEmails = new Set(smartProfiles.map(row => normalize(row.email)).filter(Boolean));
  const activeNotificationEmails = new Set(
    notificationRows
      .filter(row => row.is_active)
      .map(row => normalize(row.user_email))
      .filter(Boolean)
  );
  const audienceEmails = new Set([...activeNotificationEmails, ...smartEmails]);

  const classBriefingsTrue = latestClassifications.filter(row => isBriefingsAccessTrue(row.briefings_access));
  const classBriefingsFalse = latestClassifications.filter(row => !isBriefingsAccessTrue(row.briefings_access));
  const entitledWithAudience = classBriefingsTrue.filter(row => audienceEmails.has(normalize(row.email)));

  const briefingsEnabledTrueRows = notificationRows.filter(row => row.briefings_enabled === true);
  const alertsEnabledTrueRows = notificationRows.filter(row => row.alerts_enabled === true);
  const activeRows = notificationRows.filter(row => row.is_active === true);

  const nonEntitledBriefingsEnabled = briefingsEnabledTrueRows.filter(row => {
    const email = normalize(row.user_email);
    const classification = latestClassifications.find(item => normalize(item.email) === email);
    return !classification || !isBriefingsAccessTrue(classification.briefings_access);
  });

  const report = {
    generatedAt: new Date().toISOString(),
    notificationSettings: {
      totalRows: notificationRows.length,
      activeRows: activeRows.length,
      briefingsEnabledTrue: briefingsEnabledTrueRows.length,
      alertsEnabledTrue: alertsEnabledTrueRows.length,
      lastUpdatedAt: notificationRows[0]?.updated_at || null,
      recentUpdatedSample: notificationRows.slice(0, 5).map(row => ({
        email: row.user_email,
        updated_at: row.updated_at,
        briefings_enabled: row.briefings_enabled,
        alerts_enabled: row.alerts_enabled,
        is_active: row.is_active,
      })),
    },
    customerClassifications: {
      latestClassificationVersion,
      totalRowsLatestVersion: latestClassifications.length,
      briefingsAccessTrue: classBriefingsTrue.length,
      briefingsAccessFalse: classBriefingsFalse.length,
      values: latestClassifications.reduce((acc, row) => {
        const key = row.briefings_access || 'null';
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      }, {}),
      lastUpdatedAt: classifications[0]?.updated_at || null,
    },
    cronAudience: {
      rolloutMode: rolloutConfig?.mode === 'rollout' ? 'rollout' : 'beta_all',
      activeCohortMembers: activeCohort?.memberEmails?.length || 0,
      activeNotificationAudience: activeNotificationEmails.size,
      smartProfileAudience: smartEmails.size,
      combinedAudienceCandidates: audienceEmails.size,
      entitledWithAudience: entitledWithAudience.length,
      nonEntitledWithBriefingsEnabled: nonEntitledBriefingsEnabled.length,
      nonEntitledBriefingsEnabledSample: nonEntitledBriefingsEnabled.slice(0, 10).map(row => row.user_email),
    },
    comparison: {
      notificationBriefingsEnabledMinusClassifiedEntitled:
        briefingsEnabledTrueRows.length - classBriefingsTrue.length,
      revocationsSyncedToNotificationSettings:
        briefingsEnabledTrueRows.length === classBriefingsTrue.length,
    },
  };

  console.log(JSON.stringify(report, null, 2));
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
