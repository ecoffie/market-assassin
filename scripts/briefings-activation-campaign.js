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

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BASE_URL = 'https://tools.govcongiants.org';

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false },
});

const ENTITLED_CLASSES = [
  'ultimate_giant',
  'inner_circle_active',
  'pro_giant',
  'past_event_attendee',
  'pro_member_active',
  'mi_subscription',
  'standalone',
];

const REVOKED_CLASSES = ['free', 'inner_circle_churned_winback'];
const PERSONAL_EMAILS = new Set(['miazhudson@gmail.com']);

const COHORTS = {
  ultimate_giant: {
    code: 'A',
    label: 'Ultimate Giant Bundle',
    access: 'lifetime',
    source: 'bundle_ultimate_giant',
    day: 1,
  },
  inner_circle_active: {
    code: 'B',
    label: 'Inner Circle Active',
    access: 'lifetime',
    source: 'inner_circle_active',
    day: 1,
  },
  past_event_attendee: {
    code: 'C',
    label: 'Past Event Attendee',
    access: '6-month',
    source: 'past_event_attendee',
    day: 2,
  },
  pro_member_active: {
    code: 'D',
    label: 'Pro Member Active',
    access: 'subscription-tied',
    source: 'pro_member_active',
    day: 4,
  },
  pro_giant: {
    code: 'E',
    label: 'Pro Giant Bundle',
    access: '1-year',
    source: 'bundle_pro_giant',
    day: 1,
  },
  mi_subscription: {
    code: 'F',
    label: 'MI Subscription',
    access: 'subscription-tied',
    source: 'mi_subscription',
    day: 5,
  },
  standalone: {
    code: 'G',
    label: 'Standalone Preview',
    access: 'preview',
    source: 'beta_preview',
    day: 5,
  },
};

async function fetchAll(table, select, order = 'email') {
  const rows = [];
  const pageSize = 1000;

  for (let from = 0; ; from += pageSize) {
    const query = supabase.from(table).select(select).range(from, from + pageSize - 1);
    if (order) query.order(order);
    const { data, error } = await query;
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...(data || []));
    if (!data || data.length < pageSize) break;
  }

  return rows;
}

function normalizeEmail(email) {
  return String(email || '').toLowerCase().trim();
}

function csvEscape(value) {
  const str = value == null ? '' : String(value);
  if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

function buildCsv(rows) {
  const headers = [
    'email',
    'cohort',
    'classification',
    'variant',
    'send_day',
    'activation_url',
    'has_user_profile',
    'has_audience_record',
    'has_stripe_customer',
    'briefings_expiry',
  ];
  return [
    headers.join(','),
    ...rows.map(row => headers.map(header => csvEscape(row[header])).join(',')),
  ].join('\n');
}

function increment(map, key, by = 1) {
  map[key] = (map[key] || 0) + by;
}

function assignDay(classification, indexWithinCohort) {
  if (classification === 'ultimate_giant' || classification === 'inner_circle_active' || classification === 'pro_giant') {
    return 1;
  }
  if (classification === 'mi_subscription') return 2;
  if (classification === 'pro_member_active') {
    if (indexWithinCohort < 49) return 2;
    return 3;
  }
  if (classification === 'past_event_attendee') {
    if (indexWithinCohort < 48) return 3;
    if (indexWithinCohort < 98) return 4;
    return 5;
  }
  if (classification === 'standalone') {
    if (indexWithinCohort < 30) return 5;
    return 6 + Math.floor((indexWithinCohort - 30) / 50);
  }

  return COHORTS[classification]?.day || '';
}

async function main() {
  const [
    classifications,
    profiles,
    notificationSettings,
    smartProfiles,
    stripeCustomers,
  ] = await Promise.all([
    fetchAll('customer_classifications', 'email, customer_id, classification, briefings_access, briefings_expiry, total_spend, charge_count, has_active_subscription, subscription_type, classification_version', 'email'),
    fetchAll('user_profiles', 'email, access_briefings, briefings_expires_at', 'email'),
    fetchAll('user_notification_settings', 'user_email, is_active, alerts_enabled, briefings_enabled, naics_codes, updated_at', 'user_email'),
    fetchAll('smart_user_profiles', 'email, naics_codes, agencies, timezone', 'email').catch(() => []),
    fetchAll('stripe_customers', 'id, email, name, deleted, livemode', 'email'),
  ]);

  const latestVersion = Math.max(...classifications.map(row => Number(row.classification_version || 0)));
  const latest = classifications.filter(row => Number(row.classification_version || 0) === latestVersion);

  const profileEmails = new Set(profiles.map(row => normalizeEmail(row.email)).filter(Boolean));
  const audienceEmails = new Set([
    ...notificationSettings.map(row => normalizeEmail(row.user_email)),
    ...smartProfiles.map(row => normalizeEmail(row.email)),
  ].filter(Boolean));
  const activeAudienceEmails = new Set(notificationSettings
    .filter(row => row.is_active)
    .map(row => normalizeEmail(row.user_email))
    .filter(Boolean));
  const stripeEmails = new Set(stripeCustomers.map(row => normalizeEmail(row.email)).filter(Boolean));

  const entitlementRows = latest
    .filter(row => ENTITLED_CLASSES.includes(row.classification))
    .sort((a, b) => {
      const ac = COHORTS[a.classification]?.code || 'Z';
      const bc = COHORTS[b.classification]?.code || 'Z';
      return ac.localeCompare(bc) || normalizeEmail(a.email).localeCompare(normalizeEmail(b.email));
    });

  const cohortIndexes = {};
  const segmented = entitlementRows.map(row => {
    const email = normalizeEmail(row.email);
    const classification = row.classification;
    const cohort = COHORTS[classification] || { label: classification };
    const index = cohortIndexes[classification] || 0;
    cohortIndexes[classification] = index + 1;

    const hasUserProfile = profileEmails.has(email);
    const hasAudienceRecord = audienceEmails.has(email);
    const hasActiveAudience = activeAudienceEmails.has(email);
    const hasStripeCustomer = stripeEmails.has(email) || Boolean(row.customer_id);
    const variant = PERSONAL_EMAILS.has(email)
      ? 'Personal email - Mia Hudson'
      : hasActiveAudience
        ? 'Variant 1 - account/audience ready'
        : 'Variant 2 - setup needed';

    return {
      email,
      cohort: cohort.label,
      classification,
      variant,
      send_day: variant.startsWith('Manual') ? '' : assignDay(classification, index),
      activation_url: `${BASE_URL}/briefings?email=${encodeURIComponent(email)}&setup=true`,
      has_user_profile: hasUserProfile,
      has_audience_record: hasAudienceRecord,
      has_active_audience: hasActiveAudience,
      has_stripe_customer: hasStripeCustomer,
      briefings_expiry: row.briefings_expiry || '',
      access_source: cohort.source,
    };
  });

  const counts = {};
  const cohortVariantCounts = {};
  for (const row of segmented) {
    increment(counts, row.classification);
    const key = `${row.cohort} | ${row.variant}`;
    increment(cohortVariantCounts, key);
  }

  const manualReview = segmented.filter(row => row.variant.startsWith('Manual'));
  const personal = segmented.filter(row => row.variant.startsWith('Personal'));
  const setupNeeded = segmented.filter(row => row.variant.startsWith('Variant 2'));
  const accountReady = segmented.filter(row => row.variant.startsWith('Variant 1'));

  const settingsByEmail = new Map(notificationSettings.map(row => [normalizeEmail(row.user_email), row]));
  const revokedRows = latest.filter(row => REVOKED_CLASSES.includes(row.classification));
  const revokedSummary = {
    total: revokedRows.length,
    withAudienceRecord: 0,
    activeAlerts: 0,
    disabledAlertsExistingRows: [],
    noAudienceRecord: 0,
  };

  for (const row of revokedRows) {
    const email = normalizeEmail(row.email);
    const settings = settingsByEmail.get(email);
    if (!settings) {
      revokedSummary.noAudienceRecord += 1;
      continue;
    }
    revokedSummary.withAudienceRecord += 1;
    if (settings.is_active && settings.alerts_enabled) {
      revokedSummary.activeAlerts += 1;
    } else {
      revokedSummary.disabledAlertsExistingRows.push({
        email,
        is_active: settings.is_active,
        alerts_enabled: settings.alerts_enabled,
      });
    }
  }

  if (process.argv.includes('--fix-alerts') && revokedSummary.disabledAlertsExistingRows.length > 0) {
    const emails = revokedSummary.disabledAlertsExistingRows.map(row => row.email);
    const { error } = await supabase
      .from('user_notification_settings')
      .update({
        is_active: true,
        alerts_enabled: true,
        alert_frequency: 'daily',
        updated_at: new Date().toISOString(),
      })
      .in('user_email', emails);

    if (error) throw new Error(`alerts update: ${error.message}`);
    revokedSummary.fixedExistingRows = emails.length;
  }

  const date = '2026-04-30';
  const outDir = path.join(ROOT, 'scripts');
  const jsonPath = path.join(outDir, `briefings_activation_segments_${date}.json`);
  const csvPath = path.join(outDir, `briefings_activation_segments_${date}.csv`);

  const report = {
    generatedAt: new Date().toISOString(),
    latestClassificationVersion: latestVersion,
    entitledTotal: segmented.length,
    accountReadyTotal: accountReady.length,
    setupNeededTotal: setupNeeded.length,
    stripeOnlyTotal: setupNeeded.filter(row => row.has_stripe_customer).length,
    personalEmailTotal: personal.length,
    manualReviewTotal: manualReview.length,
    counts,
    cohortVariantCounts,
    manualReview,
    revokedSummary,
    rows: segmented,
  };

  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(csvPath, `${buildCsv(segmented)}\n`);

  console.log(JSON.stringify({
    generatedAt: report.generatedAt,
    latestClassificationVersion: latestVersion,
    entitledTotal: report.entitledTotal,
    accountReadyTotal: report.accountReadyTotal,
    setupNeededTotal: report.setupNeededTotal,
    stripeOnlyTotal: report.stripeOnlyTotal,
    personalEmailTotal: report.personalEmailTotal,
    manualReviewTotal: report.manualReviewTotal,
    counts,
    cohortVariantCounts,
    manualReview,
    revokedSummary,
    files: {
      json: jsonPath,
      csv: csvPath,
    },
  }, null, 2));
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
