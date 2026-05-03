import { NextRequest, NextResponse } from 'next/server';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { kv } from '@vercel/kv';
import { writeFile } from 'fs/promises';
import path from 'path';
import {
  getAllContentGeneratorAccess,
  getAllDatabaseAccess,
  getAllMarketAssassinAccess,
  getAllRecompeteAccess,
} from '@/lib/access-codes';
import { verifyAdminPassword } from '@/lib/admin-auth';

export const runtime = 'nodejs';

const PAGE_SIZE = 1000;
const PREVIEW_NOW = new Date('2026-04-29T12:00:00.000Z');
const PHASE_1_BETA_END = '2026-06-30';
const EXECUTION_REASON = 'phase_1_activation_campaign';
const ROLLBACK_PATH = 'scripts/rollback_phase1_2026-04-30.sql';

type Classification =
  | 'ultimate_giant'
  | 'inner_circle_active'
  | 'pro_giant'
  | 'past_event_attendee'
  | 'pro_member_active'
  | 'mi_subscription'
  | 'standalone'
  | 'internal_comp_excluded'
  | 'inner_circle_churned_winback'
  | 'free';

type MatchKey =
  | Classification
  | 'system_test_account'
  | 'mixed_kv_pattern'
  | 'full_fix_without_ma_premium'
  | 'ma_premium_without_full_fix';

interface AccountRow {
  user_email: string | null;
  is_active?: boolean | null;
  alerts_enabled?: boolean | null;
  briefings_enabled?: boolean | null;
  created_at?: string | null;
}

interface StripeCustomerRow {
  id: string;
  email: string | null;
  name?: string | null;
  deleted?: boolean | null;
  livemode?: boolean | null;
}

interface StripeChargeRow {
  id: string;
  customer_id: string | null;
  amount: number;
  status: string;
  description: string | null;
  receipt_email: string | null;
  invoice_id: string | null;
  created_at: string;
  livemode?: boolean | null;
  refunded?: boolean | null;
  amount_refunded?: number | null;
}

interface StripeSubscriptionRow {
  id: string;
  customer_id: string | null;
  status: string;
  current_period_end: string | null;
  created_at: string;
  plan_amount: number | null;
  plan_interval: string | null;
  livemode?: boolean | null;
}

interface ExistingClassificationRow {
  email: string | null;
  classification: string | null;
  [key: string]: unknown;
}

interface ExistingProfileRow {
  email: string | null;
  access_briefings?: boolean | null;
  access_daily_briefings?: boolean | null;
  briefings_expires_at?: string | null;
  briefing_tier?: string | null;
  stripe_customer_id?: string | null;
  [key: string]: unknown;
}

interface KvAccessSummary {
  maTier: string | null;
  contentTier: string | null;
  hasOsPro: boolean;
  hasRecompete: boolean;
  hasDatabase: boolean;
  hasBriefings: boolean;
}

interface UnifiedUser {
  email: string;
  account?: AccountRow;
  stripeCustomerIds: string[];
  stripeName?: string | null;
  charges: StripeChargeRow[];
  subscriptions: StripeSubscriptionRow[];
  kv: KvAccessSummary;
  matches: MatchKey[];
  classification: Classification;
  reason: string;
  accessPreview: {
    briefingsAccess: boolean;
    briefingsExpiresAt: string | null;
    accessSource: string;
  };
}

const CATEGORY_ORDER: Classification[] = [
  'internal_comp_excluded',
  'ultimate_giant',
  'inner_circle_active',
  'pro_giant',
  'past_event_attendee',
  'pro_member_active',
  'mi_subscription',
  'inner_circle_churned_winback',
  'standalone',
  'free',
];

const EVENT_PRICE_RANGES = [
  [149600, 150000],
  [199600, 200000],
  [79800, 80000],
  [49800, 50000],
] as const;

const EXPECTED_INNER_CIRCLE_EMAILS = [
  'bobby@24hrc.us',
  'willie.smiley@spasmileytrucking.com',
  'andrew@millpondresearch.com',
  'antcaruso22@gmail.com',
  'lisa@primebrokerllc.com',
];

const GRANDFATHERED_INNER_CIRCLE_EMAILS = new Set(EXPECTED_INNER_CIRCLE_EMAILS);

const EXPLICIT_INTERNAL_TEAM_EMAILS = new Set([
  'kashif6331@gmail.com',
  'usamashraf2@gmail.com',
  'evankoffdev@gmail.com',
]);

const EXPLICIT_COMP_TESTIMONIAL_EMAILS = new Set([
  'aj@cypherintel.com',
  'pa.joof@pjaygroup.com',
  'dare2dreaminc615@gmail.com',
  'olga@olaexecutiveconsulting.com',
  'tavinalford@gmail.com',
]);

const VERIFICATION_SPOT_CHECK_EMAILS = [
  'bobby@24hrc.us',
  'willie.smiley@spasmileytrucking.com',
  'andrew@millpondresearch.com',
  'antcaruso22@gmail.com',
  'lisa@primebrokerllc.com',
  'kydun00@yahoo.com',
  'bonitascott15@hotmail.com',
  'colinn.me@gmail.com',
  'contact@blenaitechnologies.com',
  'fernando.mercado@venerandavalor.com',
  'hello@eganrose.com',
  'miazhudson@gmail.com',
  'founder@siemable.com',
  'info@cfpsolutions.net',
  'jcameron@cameroncommerce.com',
  '01waycontracting@gmail.com',
  '7days.consulting19@gmail.com',
  'allegrapena@gmail.com',
  'eric@govcongiants.com',
  'kashif6331@gmail.com',
  'aj@cypherintel.com',
];

function getSupabase() {
  return createClient(
    cleanEnv(process.env.NEXT_PUBLIC_SUPABASE_URL)!,
    cleanEnv(process.env.SUPABASE_SERVICE_ROLE_KEY)!,
    { auth: { persistSession: false } }
  );
}

function cleanEnv(value: string | undefined) {
  return value?.replace(/\\n/g, '').trim();
}

function normalizeEmail(email: string | null | undefined) {
  return (email || '').toLowerCase().trim();
}

function normalizeTier(tier: unknown) {
  return String(tier || '').toLowerCase().trim().replace(/_/g, '-');
}

function isFullFix(tier: string | null) {
  return tier === 'full-fix' || tier === 'content-full-fix';
}

function isContentEngine(tier: string | null) {
  return tier === 'content-engine' || tier === 'standard';
}

function isGovConInternal(email: string) {
  const domain = email.split('@')[1] || '';
  return domain === 'govcongiants.com' || domain === 'govcongiants.org';
}

function isSystemTestEmail(email: string) {
  const domain = email.split('@')[1] || '';
  return email.includes('healthcheck') || email.includes('test') || domain.endsWith('.govcongiants.org');
}

function isExplicitCompAccount(email: string) {
  return EXPLICIT_COMP_TESTIMONIAL_EMAILS.has(email);
}

function isExplicitInternalTeamAccount(email: string) {
  return EXPLICIT_INTERNAL_TEAM_EMAILS.has(email);
}

function isValidCharge(charge: StripeChargeRow) {
  return charge.status === 'succeeded'
    && charge.livemode !== false
    && !charge.refunded
    && (charge.amount_refunded || 0) === 0
    && charge.amount > 0;
}

function isOneTimeCharge(charge: StripeChargeRow) {
  return isValidCharge(charge) && !charge.invoice_id;
}

function isActiveSubscription(subscription: StripeSubscriptionRow) {
  if (subscription.livemode === false) return false;
  if (subscription.status !== 'active' && subscription.status !== 'trialing') return false;
  if (!subscription.current_period_end) return true;
  return new Date(subscription.current_period_end).getTime() >= PREVIEW_NOW.getTime();
}

function inRange(amount: number | null | undefined, min: number, max: number) {
  return typeof amount === 'number' && amount >= min && amount <= max;
}

function hasEventCharge(charges: StripeChargeRow[]) {
  return charges.some(charge =>
    isOneTimeCharge(charge)
    && EVENT_PRICE_RANGES.some(([min, max]) => inRange(charge.amount, min, max))
  );
}

function hasEventAmountCharge(charges: StripeChargeRow[]) {
  return charges.some(charge =>
    isValidCharge(charge)
    && EVENT_PRICE_RANGES.some(([min, max]) => inRange(charge.amount, min, max))
  );
}

function hasSuccessfulCharge(charges: StripeChargeRow[]) {
  return charges.some(isValidCharge);
}

function getLastPaymentAt(charges: StripeChargeRow[], amountMin: number, amountMax: number) {
  const matching = charges
    .filter(charge => isValidCharge(charge) && inRange(charge.amount, amountMin, amountMax))
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  return matching[0]?.created_at || null;
}

function hasActiveInnerCircle(user: Omit<UnifiedUser, 'matches' | 'classification' | 'reason' | 'accessPreview'>) {
  const hasCurrentInnerCircleSubscription = user.subscriptions.some(subscription =>
    isActiveSubscription(subscription)
    && subscription.plan_interval === 'year'
    && inRange(subscription.plan_amount, 149700, 150300)
  );
  const hasNewStructureCharge = user.charges.some(charge =>
    isValidCharge(charge)
    && inRange(charge.amount, 299600, 299800)
  );

  return hasCurrentInnerCircleSubscription
    || hasNewStructureCharge
    || GRANDFATHERED_INNER_CIRCLE_EMAILS.has(user.email);
}

function hasHistoricalInnerCircle(user: Omit<UnifiedUser, 'matches' | 'classification' | 'reason' | 'accessPreview'>) {
  return user.subscriptions.some(subscription =>
    subscription.plan_interval === 'year'
    && inRange(subscription.plan_amount, 149700, 150300)
  ) || user.charges.some(charge =>
    charge.invoice_id
    && inRange(charge.amount, 149700, 150300)
  );
}

function hasChurnedInnerCircle(user: Omit<UnifiedUser, 'matches' | 'classification' | 'reason' | 'accessPreview'>) {
  return !hasActiveInnerCircle(user) && hasHistoricalInnerCircle(user);
}

function hasActiveProMember(user: Omit<UnifiedUser, 'matches' | 'classification' | 'reason' | 'accessPreview'>) {
  return user.subscriptions.some(subscription =>
    isActiveSubscription(subscription)
    && (
      (subscription.plan_interval === 'month' && inRange(subscription.plan_amount, 9800, 10000))
      || (subscription.plan_interval === 'year' && inRange(subscription.plan_amount, 79800, 80000))
    )
  );
}

function hasActiveMISubscription(user: Omit<UnifiedUser, 'matches' | 'classification' | 'reason' | 'accessPreview'>) {
  return user.subscriptions.some(subscription =>
    isActiveSubscription(subscription)
    && subscription.plan_interval === 'month'
    && inRange(subscription.plan_amount, 4800, 5000)
  );
}

function getSubscriptionExpiry(user: UnifiedUser, category: 'pro_member_active' | 'mi_subscription') {
  const subscription = user.subscriptions
    .filter(isActiveSubscription)
    .find(sub => {
      if (category === 'mi_subscription') {
        return sub.plan_interval === 'month' && inRange(sub.plan_amount, 4800, 5000);
      }
      return (sub.plan_interval === 'month' && inRange(sub.plan_amount, 9800, 10000))
        || (sub.plan_interval === 'year' && inRange(sub.plan_amount, 79800, 80000));
    });

  return subscription?.current_period_end || null;
}

function getBriefingsAccessTier(user: UnifiedUser) {
  switch (user.classification) {
    case 'ultimate_giant':
    case 'inner_circle_active':
      return 'lifetime';
    case 'pro_giant':
      return '1_year';
    case 'past_event_attendee':
      return '6_month';
    case 'pro_member_active':
    case 'mi_subscription':
      return 'subscription';
    case 'standalone':
      return 'beta_preview';
    case 'internal_comp_excluded':
      return 'excluded';
    case 'inner_circle_churned_winback':
    case 'free':
    default:
      return 'none';
  }
}

function getBundleTier(user: UnifiedUser) {
  switch (user.classification) {
    case 'ultimate_giant':
      return 'Ultimate Giant Bundle';
    case 'pro_giant':
      return 'Pro Giant Bundle';
    default:
      return null;
  }
}

function getSubscriptionType(user: UnifiedUser) {
  switch (user.classification) {
    case 'inner_circle_active':
    case 'inner_circle_churned_winback':
      return 'inner_circle';
    case 'pro_member_active':
      return 'pro_member';
    case 'mi_subscription':
      return 'mi';
    default:
      return null;
  }
}

function getProductsPurchased(user: UnifiedUser) {
  return [...new Set(user.charges
    .filter(isValidCharge)
    .map(charge => charge.description || `Stripe charge ${charge.amount / 100}`)
    .filter(Boolean))];
}

function buildClassificationRow(user: UnifiedUser) {
  const validCharges = user.charges.filter(isValidCharge);
  const chargeDates = validCharges
    .map(charge => charge.created_at)
    .filter(Boolean)
    .sort();
  const activeSubscriptions = user.subscriptions.filter(isActiveSubscription);

  return {
    email: user.email,
    customer_id: user.stripeCustomerIds[0] || null,
    classification: user.classification,
    briefings_access: getBriefingsAccessTier(user),
    briefings_expiry: user.accessPreview.briefingsExpiresAt,
    bundle_tier: getBundleTier(user),
    total_spend: validCharges.reduce((sum, charge) => sum + charge.amount, 0),
    charge_count: validCharges.length,
    first_charge_at: chargeDates[0] || null,
    last_charge_at: chargeDates[chargeDates.length - 1] || null,
    has_active_subscription: activeSubscriptions.length > 0,
    subscription_type: getSubscriptionType(user),
    products_purchased: getProductsPurchased(user),
    classified_at: new Date().toISOString(),
    classification_version: 3,
  };
}

function shouldGrantEntitlement(user: UnifiedUser) {
  return user.accessPreview.briefingsAccess && user.classification !== 'internal_comp_excluded';
}

function shouldClearExistingEntitlement(user: UnifiedUser) {
  return user.classification === 'inner_circle_churned_winback' || user.classification === 'free';
}

function classifyUser(baseUser: Omit<UnifiedUser, 'matches' | 'classification' | 'reason' | 'accessPreview'>): UnifiedUser {
  const matches: MatchKey[] = [];
  const { email, kv } = baseUser;

  const isInternal = isGovConInternal(email) || isExplicitInternalTeamAccount(email) || isExplicitCompAccount(email);
  const isSystemTest = isSystemTestEmail(email);
  const isUltimate = kv.maTier === 'premium' && isFullFix(kv.contentTier);
  const isProGiant = kv.maTier === 'standard' && isContentEngine(kv.contentTier);

  if (isInternal) matches.push('internal_comp_excluded');
  if (isSystemTest) matches.push('system_test_account');
  if (isUltimate) matches.push('ultimate_giant');
  if (hasActiveInnerCircle(baseUser)) matches.push('inner_circle_active');
  if (isProGiant) matches.push('pro_giant');
  if (hasEventCharge(baseUser.charges)) matches.push('past_event_attendee');
  if (hasActiveProMember(baseUser)) matches.push('pro_member_active');
  if (hasActiveMISubscription(baseUser)) matches.push('mi_subscription');
  if (hasSuccessfulCharge(baseUser.charges)) matches.push('standalone');
  if (hasChurnedInnerCircle(baseUser)) matches.push('inner_circle_churned_winback');

  if (kv.maTier === 'premium' && isContentEngine(kv.contentTier)) matches.push('mixed_kv_pattern');
  if (isFullFix(kv.contentTier) && kv.maTier !== 'premium') matches.push('full_fix_without_ma_premium');
  if (kv.maTier === 'premium' && !isFullFix(kv.contentTier)) matches.push('ma_premium_without_full_fix');

  let classification: Classification = 'free';
  let reason = 'No successful Stripe charges or qualifying KV access';

  for (const category of CATEGORY_ORDER) {
    if (matches.includes(category)) {
      classification = category;
      break;
    }
  }

  switch (classification) {
    case 'internal_comp_excluded':
      reason = isGovConInternal(email) || isExplicitInternalTeamAccount(email)
        ? 'GovCon Giants internal/team account'
        : 'Explicit comp/testimonial exclusion';
      break;
    case 'ultimate_giant':
      reason = 'Strict KV match: MA Premium + Content Reaper Full Fix';
      break;
    case 'inner_circle_active':
      reason = 'Active $1,500/year Inner Circle subscription';
      break;
    case 'pro_giant':
      reason = 'Strict KV match: MA Standard + Content Engine';
      break;
    case 'past_event_attendee':
      reason = 'Successful one-time event/bootcamp price charge';
      break;
    case 'pro_member_active':
      reason = 'Active $99/month or $799/year Pro Member subscription';
      break;
    case 'mi_subscription':
      reason = 'Active $49/month Market Intelligence subscription';
      break;
    case 'standalone':
      reason = 'Successful Stripe charge catch-all';
      break;
    case 'inner_circle_churned_winback':
      reason = 'Historical $1,500/year Inner Circle subscription without active status';
      break;
  }

  return {
    ...baseUser,
    matches,
    classification,
    reason,
    accessPreview: buildAccessPreview({ ...baseUser, matches, classification, reason } as UnifiedUser),
  };
}

function buildAccessPreview(user: UnifiedUser) {
  switch (user.classification) {
    case 'ultimate_giant':
      return {
        briefingsAccess: true,
        briefingsExpiresAt: null,
        accessSource: 'bundle_ultimate_giant',
      };
    case 'inner_circle_active':
      return {
        briefingsAccess: true,
        briefingsExpiresAt: null,
        accessSource: 'inner_circle_active',
      };
    case 'pro_giant':
      return {
        briefingsAccess: true,
        briefingsExpiresAt: '2027-04-29',
        accessSource: 'bundle_pro_giant',
      };
    case 'past_event_attendee':
      return {
        briefingsAccess: true,
        briefingsExpiresAt: '2026-10-29',
        accessSource: 'past_event_attendee',
      };
    case 'pro_member_active':
      return {
        briefingsAccess: true,
        briefingsExpiresAt: getSubscriptionExpiry(user, 'pro_member_active'),
        accessSource: 'pro_member_active',
      };
    case 'mi_subscription':
      return {
        briefingsAccess: true,
        briefingsExpiresAt: getSubscriptionExpiry(user, 'mi_subscription'),
        accessSource: 'mi_subscription',
      };
    case 'standalone':
      return {
        briefingsAccess: true,
        briefingsExpiresAt: PHASE_1_BETA_END,
        accessSource: 'beta_preview',
      };
    case 'inner_circle_churned_winback':
      return {
        briefingsAccess: false,
        briefingsExpiresAt: null,
        accessSource: 'churned_winback',
      };
    case 'internal_comp_excluded':
      return {
        briefingsAccess: false,
        briefingsExpiresAt: null,
        accessSource: isGovConInternal(user.email) || isExplicitInternalTeamAccount(user.email)
          ? 'internal_team'
          : 'comp_testimonial',
      };
    case 'free':
    default:
      return {
        briefingsAccess: false,
        briefingsExpiresAt: null,
        accessSource: 'free',
      };
  }
}

async function fetchAllRows<T>(
  supabase: SupabaseClient,
  table: string,
  select: string,
  orderColumn?: string
): Promise<T[]> {
  const rows: T[] = [];

  for (let from = 0; ; from += PAGE_SIZE) {
    let query = supabase
      .from(table)
      .select(select)
      .range(from, from + PAGE_SIZE - 1);

    if (orderColumn) {
      query = query.order(orderColumn, { ascending: true });
    }

    const { data, error } = await query;
    if (error) throw error;
    if (!data || data.length === 0) break;
    rows.push(...data as T[]);
    if (data.length < PAGE_SIZE) break;
  }

  return rows;
}

async function fetchRowsByEmails<T>(
  supabase: SupabaseClient,
  table: string,
  emails: string[],
  select = '*'
): Promise<T[]> {
  const rows: T[] = [];
  const uniqueEmails = [...new Set(emails)].filter(Boolean);

  for (let i = 0; i < uniqueEmails.length; i += 100) {
    const batch = uniqueEmails.slice(i, i + 100);
    const { data, error } = await supabase
      .from(table)
      .select(select)
      .in('email', batch);
    if (error) throw error;
    rows.push(...(data || []) as T[]);
  }

  return rows;
}

function sqlString(value: string) {
  return `'${value.replace(/'/g, "''")}'`;
}

function sqlValue(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (Array.isArray(value)) {
    return `ARRAY[${value.map(item => sqlString(String(item))).join(', ')}]::text[]`;
  }
  if (typeof value === 'object') {
    return `${sqlString(JSON.stringify(value))}::jsonb`;
  }
  return sqlString(String(value));
}

function buildUpsertSql(table: string, row: Record<string, unknown>, conflictColumn: string) {
  const columns = Object.keys(row);
  const values = columns.map(column => sqlValue(row[column]));
  const updates = columns
    .filter(column => column !== conflictColumn)
    .map(column => `${column} = EXCLUDED.${column}`)
    .join(', ');

  return `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${values.join(', ')}) ON CONFLICT (${conflictColumn}) DO UPDATE SET ${updates};`;
}

function buildRollbackSql(
  previousClassifications: ExistingClassificationRow[],
  previousProfiles: ExistingProfileRow[],
  insertedClassificationEmails: string[],
  insertedProfileEmails: string[],
  executeId: string
) {
  const lines = [
    '-- Rollback for phase 1 briefings access activation',
    `-- execute_id: ${executeId}`,
    `-- generated_at: ${new Date().toISOString()}`,
    'BEGIN;',
    '',
  ];

  if (insertedProfileEmails.length > 0) {
    lines.push(`DELETE FROM user_profiles WHERE email IN (${insertedProfileEmails.map(sqlString).join(', ')});`);
  }

  for (const profile of previousProfiles) {
    lines.push(buildUpsertSql('user_profiles', profile as Record<string, unknown>, 'email'));
  }

  if (insertedClassificationEmails.length > 0) {
    lines.push(`DELETE FROM customer_classifications WHERE email IN (${insertedClassificationEmails.map(sqlString).join(', ')});`);
  }

  for (const classification of previousClassifications) {
    lines.push(buildUpsertSql('customer_classifications', classification as Record<string, unknown>, 'email'));
  }

  lines.push(
    '',
    `INSERT INTO experiment_log (user_email, action, reason, metadata) VALUES ('system', 'rollback_prepared', 'phase_1_activation_campaign', ${sqlString(JSON.stringify({ executeId }))}::jsonb);`,
    'COMMIT;',
    ''
  );

  return lines.join('\n');
}

async function loadKvAccess(): Promise<Map<string, KvAccessSummary>> {
  const accessByEmail = new Map<string, KvAccessSummary>();

  function get(email: string) {
    const normalized = normalizeEmail(email);
    if (!accessByEmail.has(normalized)) {
      accessByEmail.set(normalized, {
        maTier: null,
        contentTier: null,
        hasOsPro: false,
        hasRecompete: false,
        hasDatabase: false,
        hasBriefings: false,
      });
    }
    return accessByEmail.get(normalized)!;
  }

  const [marketAssassin, contentGenerator, recompete, database] = await Promise.all([
    getAllMarketAssassinAccess(),
    getAllContentGeneratorAccess(),
    getAllRecompeteAccess(),
    getAllDatabaseAccess(),
  ]);

  for (const record of marketAssassin) {
    get(record.email).maTier = normalizeTier(record.tier);
  }
  for (const record of contentGenerator) {
    get(record.email).contentTier = normalizeTier(record.tier);
  }
  for (const record of recompete) {
    get(record.email).hasRecompete = true;
  }
  for (const record of database) {
    get(record.email).hasDatabase = true;
  }

  const osProEmails = await kv.lrange('ospro:all', 0, -1) as string[];
  for (const email of osProEmails || []) {
    get(email).hasOsPro = true;
  }

  const briefingKeys = await kv.keys('briefings:*');
  for (const key of briefingKeys || []) {
    get(String(key).replace(/^briefings:/, '')).hasBriefings = true;
  }

  return accessByEmail;
}

function summarizeUser(user: UnifiedUser) {
  const validCharges = user.charges.filter(isValidCharge);
  const totalSpend = validCharges.reduce((sum, charge) => sum + charge.amount, 0);
  const activeSubscriptions = user.subscriptions.filter(isActiveSubscription);

  return {
    email: user.email,
    classification: user.classification,
    reason: user.reason,
    matches: user.matches,
    kv: user.kv,
    totalSpend: totalSpend / 100,
    chargeCount: validCharges.length,
    lastPaymentAt: validCharges
      .map(charge => charge.created_at)
      .sort()
      .reverse()[0] || null,
    activeSubscriptions: activeSubscriptions.map(subscription => ({
      amount: subscription.plan_amount,
      interval: subscription.plan_interval,
      status: subscription.status,
      currentPeriodEnd: subscription.current_period_end,
      lastMatchingPaymentAt: subscription.plan_amount
        ? getLastPaymentAt(user.charges, subscription.plan_amount - 100, subscription.plan_amount + 100)
        : null,
    })),
    accessPreview: user.accessPreview,
  };
}

function stringifyError(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

export async function GET(request: NextRequest) {
  const password = request.nextUrl.searchParams.get('password')
    || request.headers.get('x-admin-password');
  const mode = request.nextUrl.searchParams.get('mode') || 'preview';

  if (!verifyAdminPassword(password)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (mode !== 'preview' && mode !== 'execute') {
    return NextResponse.json({
      error: 'Unsupported mode. Use mode=preview or mode=execute.',
    }, { status: 400 });
  }

  try {
    const supabase = getSupabase();
    const [
      accounts,
      stripeCustomers,
      stripeCharges,
      stripeSubscriptions,
      previousClassifications,
      kvAccess,
    ] = await Promise.all([
      fetchAllRows<AccountRow>(supabase, 'user_notification_settings', 'user_email, is_active, alerts_enabled, briefings_enabled, created_at', 'user_email'),
      fetchAllRows<StripeCustomerRow>(supabase, 'stripe_customers', 'id, email, name, deleted, livemode', 'email'),
      fetchAllRows<StripeChargeRow>(supabase, 'stripe_charges', 'id, customer_id, amount, status, description, receipt_email, invoice_id, created_at, livemode, refunded, amount_refunded', 'created_at'),
      fetchAllRows<StripeSubscriptionRow>(supabase, 'stripe_subscriptions', 'id, customer_id, status, current_period_end, created_at, plan_amount, plan_interval, livemode', 'created_at'),
      fetchAllRows<ExistingClassificationRow>(supabase, 'customer_classifications', '*', 'email'),
      loadKvAccess(),
    ]);

    const userEmails = new Set<string>();
    const accountsByEmail = new Map<string, AccountRow>();
    const customerEmailsById = new Map<string, string>();
    const customerIdsByEmail = new Map<string, string[]>();
    const stripeNamesByEmail = new Map<string, string | null>();

    for (const account of accounts) {
      const email = normalizeEmail(account.user_email);
      if (!email) continue;
      userEmails.add(email);
      accountsByEmail.set(email, account);
    }

    for (const customer of stripeCustomers) {
      if (customer.livemode === false || customer.deleted) continue;
      const email = normalizeEmail(customer.email);
      if (!email) continue;
      userEmails.add(email);
      customerEmailsById.set(customer.id, email);
      customerIdsByEmail.set(email, [...(customerIdsByEmail.get(email) || []), customer.id]);
      if (customer.name) stripeNamesByEmail.set(email, customer.name);
    }

    for (const email of kvAccess.keys()) {
      if (email) userEmails.add(email);
    }

    const chargesByEmail = new Map<string, StripeChargeRow[]>();
    for (const charge of stripeCharges) {
      const emails = new Set([
        normalizeEmail(charge.receipt_email),
        normalizeEmail(charge.customer_id ? customerEmailsById.get(charge.customer_id) : ''),
      ].filter(Boolean));

      for (const email of emails) {
        chargesByEmail.set(email, [...(chargesByEmail.get(email) || []), charge]);
      }
    }

    const subscriptionsByEmail = new Map<string, StripeSubscriptionRow[]>();
    for (const subscription of stripeSubscriptions) {
      if (subscription.livemode === false) continue;
      const email = normalizeEmail(subscription.customer_id ? customerEmailsById.get(subscription.customer_id) : '');
      if (!email) continue;
      subscriptionsByEmail.set(email, [...(subscriptionsByEmail.get(email) || []), subscription]);
    }

    const classifiedUsers = [...userEmails]
      .sort()
      .map(email => classifyUser({
        email,
        account: accountsByEmail.get(email),
        stripeCustomerIds: customerIdsByEmail.get(email) || [],
        stripeName: stripeNamesByEmail.get(email),
        charges: chargesByEmail.get(email) || [],
        subscriptions: subscriptionsByEmail.get(email) || [],
        kv: kvAccess.get(email) || {
          maTier: null,
          contentTier: null,
          hasOsPro: false,
          hasRecompete: false,
          hasDatabase: false,
          hasBriefings: false,
        },
      }));

    const counts = Object.fromEntries(CATEGORY_ORDER.map(category => [
      category,
      classifiedUsers.filter(user => user.classification === category).length,
    ]));
    const totalClassified = Object.values(counts).reduce((sum, count) => sum + count, 0);

    const previousCounts = previousClassifications.reduce<Record<string, number>>((acc, row) => {
      const key = row.classification || 'unknown';
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});

    const samples = Object.fromEntries(CATEGORY_ORDER.map(category => [
      category,
      classifiedUsers
        .filter(user => user.classification === category)
        .slice(0, 10)
        .map(summarizeUser),
    ]));

    const multipleMatches = classifiedUsers
      .filter(user => user.matches.filter(match => CATEGORY_ORDER.includes(match as Classification)).length > 1)
      .slice(0, 100)
      .map(summarizeUser);

    const inconsistentData = classifiedUsers
      .filter(user => user.matches.some(match => [
        'mixed_kv_pattern',
        'full_fix_without_ma_premium',
        'ma_premium_without_full_fix',
      ].includes(match)))
      .map(summarizeUser);

    const sourceMembershipCounts = classifiedUsers.reduce<Record<string, number>>((acc, user) => {
      const sources = [
        user.account ? 'account' : null,
        user.stripeCustomerIds.length > 0 ? 'stripe' : null,
        kvAccess.has(user.email) ? 'kv' : null,
      ].filter(Boolean).join('+') || 'unknown';
      acc[sources] = (acc[sources] || 0) + 1;
      return acc;
    }, {});

    const matchCounts = classifiedUsers.reduce<Record<string, number>>((acc, user) => {
      for (const match of user.matches) {
        acc[match] = (acc[match] || 0) + 1;
      }
      return acc;
    }, {});

    const diagnostics = {
      sourceMembershipCounts,
      matchCounts,
      payingUsersWithSuccessfulNonRefundedCharge: classifiedUsers.filter(user => hasSuccessfulCharge(user.charges)).length,
      eventAmountCandidatesAnyCharge: classifiedUsers.filter(user => hasEventAmountCharge(user.charges)).length,
      eventAmountCandidatesOneTimeOnly: classifiedUsers.filter(user => hasEventCharge(user.charges)).length,
      eventAmountCandidatesExcludedByPrecedence: classifiedUsers
        .filter(user => user.classification !== 'past_event_attendee' && hasEventCharge(user.charges))
        .map(user => summarizeUser(user)),
      strictProGiantCandidates: classifiedUsers
        .filter(user => user.kv.maTier === 'standard' && isContentEngine(user.kv.contentTier))
        .map(summarizeUser),
      contentEnginePatternCandidates: classifiedUsers
        .filter(user => isContentEngine(user.kv.contentTier))
        .map(summarizeUser),
      expectedInnerCircleAudit: EXPECTED_INNER_CIRCLE_EMAILS.map(email => {
        const user = classifiedUsers.find(candidate => candidate.email === email);
        return user ? summarizeUser(user) : { email, missingFromUnifiedUniverse: true };
      }),
      spotChecks: VERIFICATION_SPOT_CHECK_EMAILS.map(email => {
        const user = classifiedUsers.find(candidate => candidate.email === email);
        return user ? summarizeUser(user) : { email, missingFromUnifiedUniverse: true };
      }),
    };

    const expected = {
      ultimate_giant: '~19',
      inner_circle_active: 5,
      pro_giant: 2,
      past_event_attendee: '~203',
      pro_member_active: '~52',
      mi_subscription: 1,
      standalone: '~292',
      internal_comp_excluded: '~16',
      inner_circle_churned_winback: '6-11',
      free: 'rest',
    };

    if (mode === 'execute') {
      const executeId = `phase1_${Date.now()}`;
      const classifiedEmails = classifiedUsers.map(user => user.email);
      const previousClassificationRows = previousClassifications;
      const previousClassificationsByEmail = new Map(previousClassificationRows.map(row => [normalizeEmail(row.email), row]));
      const previousProfileRows = await fetchRowsByEmails<ExistingProfileRow>(supabase, 'user_profiles', classifiedEmails);
      const previousProfilesByEmail = new Map(previousProfileRows.map(row => [normalizeEmail(row.email), row]));

      const profileUsers = classifiedUsers.filter(user =>
        shouldGrantEntitlement(user)
        || (shouldClearExistingEntitlement(user) && previousProfilesByEmail.has(user.email))
      );
      const previousTouchedProfileRows = profileUsers
        .map(user => previousProfilesByEmail.get(user.email))
        .filter(Boolean) as ExistingProfileRow[];

      const classificationRows = classifiedUsers.map(buildClassificationRow);
      const profileRows = profileUsers.map(user => {
        const grant = shouldGrantEntitlement(user);
        return {
          email: user.email,
          stripe_customer_id: user.stripeCustomerIds[0] || previousProfilesByEmail.get(user.email)?.stripe_customer_id || null,
          access_briefings: grant,
          access_daily_briefings: grant,
          briefings_expires_at: grant ? user.accessPreview.briefingsExpiresAt : null,
          briefing_tier: grant ? getBriefingsAccessTier(user) : 'free',
          updated_at: new Date().toISOString(),
        };
      });

      const insertedClassificationEmails = classifiedEmails.filter(email => !previousClassificationsByEmail.has(email));
      const insertedProfileEmails = profileUsers
        .map(user => user.email)
        .filter(email => !previousProfilesByEmail.has(email));

      const rollbackSql = buildRollbackSql(
        previousClassificationRows,
        previousTouchedProfileRows,
        insertedClassificationEmails,
        insertedProfileEmails,
        executeId
      );
      const rollbackAbsolutePath = path.join(process.cwd(), ROLLBACK_PATH);
      await writeFile(rollbackAbsolutePath, rollbackSql, 'utf8');

      const errors: Array<{ step: string; email?: string; error: string }> = [];
      const processBatch = async <T,>(
        items: T[],
        batchSize: number,
        fn: (batch: T[]) => Promise<void>,
        step: string
      ) => {
        for (let i = 0; i < items.length; i += batchSize) {
          const batch = items.slice(i, i + batchSize);
          try {
            await fn(batch);
          } catch (error) {
            errors.push({ step, error: stringifyError(error) });
          }
        }
      };

      await processBatch(classificationRows, 250, async batch => {
        const { error } = await supabase
          .from('customer_classifications')
          .upsert(batch, { onConflict: 'email' });
        if (error) throw error;
      }, 'customer_classifications_upsert');

      await processBatch(profileRows, 100, async batch => {
        const { error } = await supabase
          .from('user_profiles')
          .upsert(batch, { onConflict: 'email' });
        if (error) throw error;
      }, 'user_profiles_upsert');

      const logRows = classifiedUsers.map(user => {
        const previousProfile = previousProfilesByEmail.get(user.email);
        const previousAccess = Boolean(previousProfile?.access_briefings);
        const newAccess = user.classification === 'internal_comp_excluded'
          ? previousAccess
          : user.accessPreview.briefingsAccess;
        const action = !previousAccess && newAccess
          ? 'access_granted'
          : previousAccess && !newAccess
            ? 'access_removed'
            : previousAccess === newAccess
              ? 'access_unchanged'
              : 'access_modified';

        return {
          user_email: user.email,
          action,
          cohort_before: previousClassificationsByEmail.get(user.email)?.classification || null,
          cohort_after: user.classification,
          reason: EXECUTION_REASON,
          metadata: {
            execute_id: executeId,
            previous_briefings_access: previousAccess,
            new_briefings_access: newAccess,
            access_source: user.accessPreview.accessSource === 'free' ? 'free_user' : user.accessPreview.accessSource,
            expires_at: user.accessPreview.briefingsExpiresAt,
            classification: user.classification,
            matches: user.matches,
            classification_reason: user.reason,
            previous_profile_existed: previousProfilesByEmail.has(user.email),
            profile_updated: profileUsers.some(profileUser => profileUser.email === user.email),
            internal_no_access_change: user.classification === 'internal_comp_excluded',
          },
        };
      });

      await processBatch(logRows, 250, async batch => {
        const { error } = await supabase
          .from('experiment_log')
          .insert(batch);
        if (error) throw error;
      }, 'experiment_log_insert');

      const grantSummary = {
        lifetime: counts.ultimate_giant + counts.inner_circle_active,
        oneYear: counts.pro_giant,
        sixMonth: counts.past_event_attendee,
        subscriptionTied: counts.pro_member_active + counts.mi_subscription,
        betaPreview: counts.standalone,
        removedChurned: counts.inner_circle_churned_winback,
        unchangedInternalComp: counts.internal_comp_excluded,
        freeNoAccess: counts.free,
      };

      return NextResponse.json({
        success: errors.length === 0,
        mode: 'execute',
        executeId,
        generatedAt: new Date().toISOString(),
        rulesVersion: 3,
        unifiedUserCount: classifiedUsers.length,
        totalProcessed: classifiedUsers.length,
        counts,
        grantSummary,
        rowsWritten: {
          customerClassifications: errors.some(error => error.step === 'customer_classifications_upsert') ? 0 : classificationRows.length,
          userProfiles: errors.some(error => error.step === 'user_profiles_upsert') ? 0 : profileRows.length,
          experimentLog: errors.some(error => error.step === 'experiment_log_insert') ? 0 : logRows.length,
        },
        insertedRows: {
          customerClassifications: insertedClassificationEmails.length,
          userProfiles: insertedProfileEmails.length,
        },
        rollbackScript: rollbackAbsolutePath,
        errors,
        skipped: {
          internalCompNoEntitlementChange: counts.internal_comp_excluded,
          freeWithoutExistingProfileNotCreated: classifiedUsers.filter(user =>
            user.classification === 'free' && !previousProfilesByEmail.has(user.email)
          ).length,
        },
        confirmation: {
          customerClassificationsUpdated: !errors.some(error => error.step === 'customer_classifications_upsert'),
          experimentLogInserted: !errors.some(error => error.step === 'experiment_log_insert'),
          productionDataModified: true,
        },
      }, { status: errors.length === 0 ? 200 : 500 });
    }

    return NextResponse.json({
      success: true,
      mode: 'preview',
      generatedAt: new Date().toISOString(),
      rulesVersion: 2,
      sourceCounts: {
        accountRows: accounts.length,
        stripeCustomers: stripeCustomers.filter(customer => customer.livemode !== false && !customer.deleted && normalizeEmail(customer.email)).length,
        stripeCharges: stripeCharges.length,
        stripeSubscriptions: stripeSubscriptions.length,
        kvEmails: kvAccess.size,
        previousClassifierRows: previousClassifications.length,
      },
      unifiedUserCount: classifiedUsers.length,
      totalClassified,
      counts,
      expected,
      countsMatchTotal: totalClassified === classifiedUsers.length,
      previousClassifierCounts: previousCounts,
      samples,
      multipleMatches,
      inconsistentData,
      diagnostics,
      executeAvailable: false,
      note: 'Preview only. This endpoint does not modify customer_classifications, KV, user profiles, or access policy fields.',
    });
  } catch (error) {
    console.error('[classify-customers-v2] Error:', error);
    return NextResponse.json({
      success: false,
      error: stringifyError(error),
    }, { status: 500 });
  }
}
