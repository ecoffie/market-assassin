/**
 * Admin: MI Growth Brief
 *
 * Read-only internal operating brief for activation, engagement, upgrade,
 * and white-glove queues.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { isExcludedFromMetrics } from '@/lib/mindy/campaign-exclusions';
import { verifyAdminPassword } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const DEFAULT_NAICS_SET = new Set(['541512', '541611', '541330', '541990', '561210']);
const SUPABASE_PAGE_SIZE = 1000;
const MAX_QUEUE_ITEMS = 25;

type SourceStatus = {
  source: string;
  ok: boolean;
  rows: number;
  warning?: string;
};

type QueueUser = {
  email: string;
  reason: string;
  owner: string;
  nextAction: string;
  signals: string[];
};

type NotificationSetting = {
  user_email: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  naics_codes?: string[] | null;
  alerts_enabled?: boolean | null;
  alert_frequency?: string | null;
  briefings_enabled?: boolean | null;
  is_active?: boolean | null;
};

type UserProfile = {
  email: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  naics_codes?: string[] | null;
  company_name?: string | null;
  access_briefings?: boolean | null;
  access_hunter_pro?: boolean | null;
  access_assassin_standard?: boolean | null;
  access_assassin_premium?: boolean | null;
  access_recompete?: boolean | null;
  access_contractor_db?: boolean | null;
  access_content_standard?: boolean | null;
  access_content_full_fix?: boolean | null;
  access_team?: boolean | null;
};

type CustomerClassification = {
  email: string | null;
  briefings_access?: string | null;
  classification_version?: number | null;
  briefings_expiry?: string | null;
};

type PurchaseRow = {
  user_email?: string | null;
};

type EngagementRow = {
  user_email: string | null;
  event_type: string | null;
  event_source?: string | null;
  metadata?: Record<string, unknown> | null;
  created_at: string | null;
};

type EmailEventRow = {
  user_email?: string | null;
  event_type?: string | null;
  metadata?: Record<string, unknown> | null;
  occurred_at?: string | null;
};

type EmailSendRow = {
  user_email?: string | null;
  email_type?: string | null;
  sent_at?: string | null;
};

type UserState = {
  email: string;
  createdAt?: string;
  updatedAt?: string;
  hasSettings: boolean;
  hasProfile: boolean;
  hasCustomProfile: boolean;
  hasDefaultProfile: boolean;
  alertsEnabled: boolean;
  alertFrequency?: string | null;
  briefingsEnabled: boolean;
  proEntitled: boolean;      // real Pro: any purchase / entitlement grant (the union)
  trialUser: boolean;        // beta_preview trial that is NOT already Pro (separable, should expire)
  internal: boolean;
  engagementEvents: number;
  appEvents: number;
  emailOpens: number;
  emailClicks: number;
  timeMinutes: number;
  topAreas: Set<string>;
};

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    return null;
  }

  return createClient(url, key);
}

async function fetchAllRows<T>(
  buildQuery: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message?: string } | null }>
): Promise<T[]> {
  const rows: T[] = [];
  let from = 0;

  while (true) {
    const to = from + SUPABASE_PAGE_SIZE - 1;
    const { data, error } = await buildQuery(from, to);

    if (error) {
      throw new Error(error.message || 'Unknown Supabase error');
    }

    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < SUPABASE_PAGE_SIZE) break;
    from += SUPABASE_PAGE_SIZE;
  }

  return rows;
}

async function safeSource<T>(
  source: string,
  query: () => Promise<T[]>,
  statuses: SourceStatus[]
): Promise<T[]> {
  try {
    const rows = await query();
    statuses.push({ source, ok: true, rows: rows.length });
    return rows;
  } catch (error) {
    statuses.push({
      source,
      ok: false,
      rows: 0,
      warning: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

function normalizeEmail(email?: string | null): string {
  return String(email || '').trim().toLowerCase();
}

/**
 * Collapse per-notice email link labels into a single readable bucket for the
 * Top Links list. The daily-alert "Track in Mindy" affordance carries a UNIQUE
 * label per opportunity (`track_btn_<noticeId>` on the button, `track_<noticeId>`
 * on the title link), which would otherwise scatter adoption across dozens of
 * one-off rows and bury it. Fold them all into "📌 Track in Mindy". Other tracked
 * CTAs (open_mindy, alert_keyword_setup, bootcamp_register) are already stable
 * labels — leave them as-is. (See Alert→Action card on the command center.)
 */
function rollupLinkLabel(label: string): string {
  const l = String(label || '').toLowerCase();
  if (l.startsWith('track')) return '📌 Track in Mindy';
  return label;
}

function isInternalOrTestEmail(email: string): boolean {
  const normalized = normalizeEmail(email);
  if (!normalized || !normalized.includes('@')) return true;
  if (normalized.endsWith('@govcongiants.com')) return true;
  if (normalized.includes('+test') || normalized.includes('test@')) return true;
  if (normalized.endsWith('@example.com')) return true;
  if (normalized.includes('healthcheck')) return true;
  // Comp/advocate/partner accounts are not customers — exclude from all growth
  // metrics + queues (they flow through the .internal flag downstream).
  if (isExcludedFromMetrics(normalized)) return true;
  return false;
}

function isDefaultNaicsOnly(naicsCodes?: string[] | null): boolean {
  const codes = Array.isArray(naicsCodes) ? naicsCodes.filter(Boolean) : [];
  return codes.length > 0 && codes.every(code => DEFAULT_NAICS_SET.has(String(code)));
}

function hasCustomNaics(naicsCodes?: string[] | null): boolean {
  const codes = Array.isArray(naicsCodes) ? naicsCodes.filter(Boolean) : [];
  return codes.length > 0 && !isDefaultNaicsOnly(codes);
}

function percent(numerator: number, denominator: number): string {
  return denominator > 0 ? `${Math.round((numerator / denominator) * 100)}%` : 'N/A';
}

function clampDays(value: string | null): number {
  const parsed = Number.parseInt(value || '7', 10);
  if (!Number.isFinite(parsed)) return 7;
  return Math.min(Math.max(parsed, 1), 30);
}

function eventArea(row: EngagementRow): string {
  const metadata = row.metadata || {};
  const raw = typeof metadata.panel === 'string'
    ? metadata.panel
    : typeof metadata.feature === 'string'
      ? metadata.feature
      : row.event_source || 'market_intelligence';
  return String(raw)
    .replace(/[_-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function getDurationMinutes(metadata?: Record<string, unknown> | null): number {
  const durationMs = metadata && typeof metadata.duration_ms === 'number' ? metadata.duration_ms : 0;
  return Number.isFinite(durationMs) ? Math.round((durationMs / 60000) * 10) / 10 : 0;
}

function getOrCreateUser(users: Map<string, UserState>, email: string): UserState {
  const normalized = normalizeEmail(email);
  let user = users.get(normalized);

  if (!user) {
    user = {
      email: normalized,
      hasSettings: false,
      hasProfile: false,
      hasCustomProfile: false,
      hasDefaultProfile: false,
      alertsEnabled: false,
      briefingsEnabled: false,
      proEntitled: false,
      trialUser: false,
      internal: isInternalOrTestEmail(normalized),
      engagementEvents: 0,
      appEvents: 0,
      emailOpens: 0,
      emailClicks: 0,
      timeMinutes: 0,
      topAreas: new Set<string>(),
    };
    users.set(normalized, user);
  }

  return user;
}

function queueItem(user: UserState, reason: string, owner: string, nextAction: string, extraSignals: string[] = []): QueueUser {
  const signals = [
    user.proEntitled ? 'Mindy Pro' : user.alertsEnabled ? 'Mindy Free' : 'Imported',
    user.hasCustomProfile ? 'custom profile' : user.hasDefaultProfile ? 'default profile only' : 'no profile',
    user.emailClicks > 0 ? `${user.emailClicks} email clicks` : '',
    user.appEvents > 0 ? `${user.appEvents} app events` : '',
    ...extraSignals,
  ].filter(Boolean);

  return {
    email: user.email,
    reason,
    owner,
    nextAction,
    signals,
  };
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const password = searchParams.get('password');

  if (!verifyAdminPassword(password)) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = getSupabase();
  if (!supabase) {
    return NextResponse.json(
      { success: false, error: 'Supabase is not configured for this environment.' },
      { status: 500 }
    );
  }

  const days = clampDays(searchParams.get('days'));
  const now = new Date();
  const periodStart = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const todayStart = new Date(now);
  todayStart.setUTCHours(0, 0, 0, 0);

  const statuses: SourceStatus[] = [];
  const users = new Map<string, UserState>();

  const [
    settings,
    profiles,
    classifications,
    purchases,
    engagements,
    emailSends,
    emailEvents,
  ] = await Promise.all([
    safeSource<NotificationSetting>('user_notification_settings', () =>
      fetchAllRows((from, to) =>
        supabase
          .from('user_notification_settings')
          .select('user_email, created_at, updated_at, naics_codes, alerts_enabled, alert_frequency, briefings_enabled, is_active')
          .range(from, to)
      ), statuses),
    safeSource<UserProfile>('user_profiles', () =>
      fetchAllRows((from, to) =>
        supabase
          .from('user_profiles')
          .select('email, created_at, updated_at, naics_codes, company_name, access_briefings, access_hunter_pro, access_assassin_standard, access_assassin_premium, access_recompete, access_contractor_db, access_content_standard, access_content_full_fix, access_team')
          .range(from, to)
      ), statuses),
    safeSource<CustomerClassification>('customer_classifications', () =>
      fetchAllRows((from, to) =>
        supabase
          .from('customer_classifications')
          .select('email, briefings_access, classification_version, briefings_expiry')
          .range(from, to)
      ), statuses),
    safeSource<PurchaseRow>('purchases', () =>
      fetchAllRows((from, to) =>
        supabase
          .from('purchases')
          .select('user_email')
          .range(from, to)
      ), statuses),
    safeSource<EngagementRow>('user_engagement', () =>
      fetchAllRows((from, to) =>
        supabase
          .from('user_engagement')
          .select('user_email, event_type, event_source, metadata, created_at')
          .gte('created_at', periodStart.toISOString())
          .range(from, to)
      ), statuses),
    safeSource<EmailSendRow>('email_provider_sends', () =>
      fetchAllRows((from, to) =>
        supabase
          .from('email_provider_sends')
          .select('user_email, email_type, sent_at')
          .gte('sent_at', periodStart.toISOString())
          .range(from, to)
      ), statuses),
    safeSource<EmailEventRow>('email_provider_events', () =>
      fetchAllRows((from, to) =>
        supabase
          .from('email_provider_events')
          .select('user_email, event_type, metadata, occurred_at')
          .gte('occurred_at', periodStart.toISOString())
          .range(from, to)
      ), statuses),
  ]);

  for (const row of settings) {
    const email = normalizeEmail(row.user_email);
    if (!email) continue;
    const user = getOrCreateUser(users, email);
    user.hasSettings = true;
    user.createdAt = row.created_at || user.createdAt;
    user.updatedAt = row.updated_at || user.updatedAt;
    user.hasCustomProfile = user.hasCustomProfile || hasCustomNaics(row.naics_codes);
    user.hasDefaultProfile = user.hasDefaultProfile || isDefaultNaicsOnly(row.naics_codes);
    user.alertsEnabled = row.is_active !== false && row.alerts_enabled === true;
    user.alertFrequency = row.alert_frequency;
    user.briefingsEnabled = row.is_active !== false && row.briefings_enabled === true;
  }

  for (const row of profiles) {
    const email = normalizeEmail(row.email);
    if (!email) continue;
    const user = getOrCreateUser(users, email);
    user.hasProfile = true;
    user.createdAt = row.created_at || user.createdAt;
    user.updatedAt = row.updated_at || user.updatedAt;
    user.hasCustomProfile = user.hasCustomProfile || hasCustomNaics(row.naics_codes);
    user.hasDefaultProfile = user.hasDefaultProfile || isDefaultNaicsOnly(row.naics_codes);
    user.proEntitled = user.proEntitled || Boolean(
      row.access_briefings ||
      row.access_hunter_pro ||
      row.access_assassin_standard ||
      row.access_assassin_premium ||
      row.access_recompete ||
      row.access_contractor_db ||
      row.access_content_standard ||
      row.access_content_full_fix ||
      row.access_team
    );
  }

  const latestClassificationVersion = classifications.reduce(
    (max, row) => Math.max(max, Number(row.classification_version || 0)),
    0
  );
  // PAID classifications = real Pro. beta_preview = a free trial that should EXPIRE —
  // NOT Pro. (Counting beta_preview as Pro was the miPro-inflation bug: 481 free trial
  // users read as paying.) Split them: paid → proEntitled, beta_preview → trialUser.
  const paidAccess = new Set(['lifetime', '1_year', '6_month', 'subscription']);
  const nowMs = now.getTime();

  for (const row of classifications) {
    const email = normalizeEmail(row.email);
    if (!email) continue;
    const sameVersion = latestClassificationVersion === 0 || Number(row.classification_version || 0) === latestClassificationVersion;
    const notExpired = !row.briefings_expiry || new Date(row.briefings_expiry).getTime() > nowMs;
    if (!sameVersion || !notExpired) continue;
    const access = row.briefings_access || '';
    if (paidAccess.has(access)) {
      getOrCreateUser(users, email).proEntitled = true;
    } else if (access === 'beta_preview') {
      getOrCreateUser(users, email).trialUser = true;
    }
  }

  // Union source #4: the purchases table — every paying customer (bundles, lifetime,
  // founders, spend-threshold grants). This is where the ~59 buyers who never got the
  // access_briefings flag written live. Reconciled 2026-07-07: the DISTINCT union of
  // purchases ∪ access_* ∪ paid-classifications ∪ access_team = the true Pro population
  // (~118), which no single flag captures. (memory: pro_population_is_a_union)
  for (const row of purchases) {
    const email = normalizeEmail(row.user_email);
    if (!email) continue;
    getOrCreateUser(users, email).proEntitled = true;
  }

  const appEventTypes = new Set(['page_view', 'tool_use', 'report_generate', 'export', 'login', 'profile_update', 'onboarding_step']);
  const activeToday = new Set<string>();
  const active7d = new Set<string>();
  const areaStats = new Map<string, { minutes: number; events: number; users: Set<string> }>();
  const trackedEmailLinks: Record<string, number> = {};

  for (const row of engagements) {
    const email = normalizeEmail(row.user_email);
    if (!email || !row.created_at) continue;
    const user = getOrCreateUser(users, email);
    const createdAt = new Date(row.created_at).getTime();

    user.engagementEvents++;

    if (row.event_type === 'email_open') user.emailOpens++;
    if (row.event_type === 'link_click') {
      user.emailClicks++;
      const metadata = row.metadata || {};
      const rawLabel = typeof metadata.link_text === 'string'
        ? metadata.link_text
        : typeof metadata.url === 'string'
          ? metadata.url
          : 'link_click';
      trackedEmailLinks[rollupLinkLabel(rawLabel)] = (trackedEmailLinks[rollupLinkLabel(rawLabel)] || 0) + 1;
    }

    if (row.event_type && appEventTypes.has(row.event_type)) {
      user.appEvents++;
      active7d.add(email);
      if (createdAt >= todayStart.getTime()) activeToday.add(email);

      const minutes = getDurationMinutes(row.metadata);
      user.timeMinutes += minutes;
      const area = eventArea(row);
      user.topAreas.add(area);
      const item = areaStats.get(area) || { minutes: 0, events: 0, users: new Set<string>() };
      item.minutes += minutes;
      item.events++;
      item.users.add(email);
      areaStats.set(area, item);
    }
  }

  const providerTopLinks: Record<string, number> = {};
  const providerEmail = {
    sent: emailSends.length,
    delivered: 0,
    opened: 0,
    clicked: 0,
    bounced: 0,
    complained: 0,
    failed: 0,
  };

  for (const row of emailEvents) {
    const type = row.event_type || '';
    if (type === 'email.delivered') providerEmail.delivered++;
    else if (type === 'email.opened') providerEmail.opened++;
    else if (type === 'email.clicked') {
      providerEmail.clicked++;
      const metadata = row.metadata || {};
      const resend = typeof metadata.resend === 'object' && metadata.resend ? metadata.resend as Record<string, unknown> : {};
      const click = typeof resend.click === 'object' && resend.click ? resend.click as Record<string, unknown> : {};
      const link = typeof click.link === 'string' ? click.link : 'email clicked';
      providerTopLinks[link] = (providerTopLinks[link] || 0) + 1;
    } else if (type === 'email.bounced') providerEmail.bounced++;
    else if (type === 'email.complained') providerEmail.complained++;
    else if (type === 'email.failed') providerEmail.failed++;
  }

  const customerUsers = Array.from(users.values()).filter(user => !user.internal);
  const miPro = customerUsers.filter(user => user.proEntitled).length;
  // Trial = a beta_preview user who is NOT already Pro (34 beta users had also purchased —
  // they're Pro, not trial). This is the separable expiring-trial bucket.
  const miTrial = customerUsers.filter(user => user.trialUser && !user.proEntitled).length;
  // Free = alerts-on, and neither Pro nor trial.
  const miFree = customerUsers.filter(user => !user.proEntitled && !user.trialUser && user.alertsEnabled).length;
  const profileComplete = customerUsers.filter(user => user.hasCustomProfile).length;
  const importedNoAccount = customerUsers.filter(user => user.hasSettings && !user.hasProfile && user.appEvents === 0).length;
  const accountCreatedNoProfile = customerUsers.filter(user => user.hasProfile && !user.hasCustomProfile).length;

  const setupInvite = customerUsers
    .filter(user => user.hasSettings && !user.hasProfile && user.appEvents === 0)
    .slice(0, MAX_QUEUE_ITEMS)
    .map(user => queueItem(
      user,
      'Imported or alert-enabled user has no profile/account activity signal.',
      'Shanoor / Sikander',
      'Send account setup invite and confirm they can log in.'
    ));

  const profileNudge = customerUsers
    .filter(user => (user.hasSettings || user.hasProfile) && !user.hasCustomProfile)
    .slice(0, MAX_QUEUE_ITEMS)
    .map(user => queueItem(
      user,
      'User needs custom NAICS/profile data before matching can feel personal.',
      'Annelle / Sikander',
      'Nudge profile completion and offer quick setup help.'
    ));

  const activationRescue = customerUsers
    .filter(user => user.hasCustomProfile && user.emailClicks > 0 && user.appEvents === 0)
    .slice(0, MAX_QUEUE_ITEMS)
    .map(user => queueItem(
      user,
      'User clicked email but did not spend time in MI.',
      'Shanoor / Sikander',
      'Send a direct deep link and ask what blocked them.'
    ));

  const proUpgrade = customerUsers
    .filter(user => !user.proEntitled && user.hasCustomProfile && (user.emailClicks > 0 || user.appEvents >= 2))
    .slice(0, MAX_QUEUE_ITEMS)
    .map(user => queueItem(
      user,
      'Mindy Free user is showing enough intent for a Mindy Pro conversation.',
      'Branden',
      'Offer Pro plan walkthrough tied to their active NAICS/profile.'
    ));

  const whiteGloveCandidate = customerUsers
    .filter(user => user.proEntitled && (user.appEvents >= 5 || user.emailClicks >= 3 || user.timeMinutes >= 10))
    .slice(0, MAX_QUEUE_ITEMS)
    .map(user => queueItem(
      user,
      'High-intent Mindy Pro user may be ready for white-glove or founder outreach.',
      'Eric / Branden',
      'Review activity, call fit, and decide whether to invite to white-glove.'
    ));

  const topAreas = Array.from(areaStats.entries())
    .sort((a, b) => (b[1].minutes - a[1].minutes) || (b[1].events - a[1].events))
    .slice(0, 8)
    .map(([area, stats]) => ({
      area,
      minutes: Math.round(stats.minutes * 10) / 10,
      events: stats.events,
      users: stats.users.size,
    }));

  const trackedTopLinks = Object.keys(providerTopLinks).length > 0 ? providerTopLinks : trackedEmailLinks;
  const topLinks = Object.entries(trackedTopLinks)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([label, count]) => ({ label, count }));

  const missingSources = statuses.filter(status => !status.ok);
  const recommendedActions = [
    setupInvite.length > 0 ? {
      priority: 'high',
      lever: 'Account setup',
      owner: 'Shanoor / Sikander',
      action: `Work the first ${Math.min(setupInvite.length, 25)} setup invite candidates.`,
      why: `${importedNoAccount} users appear imported or alert-enabled without a profile/account activity signal.`,
    } : null,
    profileNudge.length > 0 ? {
      priority: 'high',
      lever: 'Profile completion',
      owner: 'Annelle / Sikander',
      action: 'Help users add real NAICS/profile data.',
      why: `${accountCreatedNoProfile} users have account/profile rows but still need a useful profile.`,
    } : null,
    activationRescue.length > 0 ? {
      priority: 'medium',
      lever: 'Email-to-app activation',
      owner: 'Shanoor / Sikander',
      action: 'Follow up with clickers who never made it into MI.',
      why: 'Clicks without app time usually means a deep-link, loading, or first-screen problem.',
    } : null,
    proUpgrade.length > 0 ? {
      priority: 'medium',
      lever: 'Mindy Pro upgrade',
      owner: 'Branden',
      action: 'Invite high-intent Mindy Free users into a Pro walkthrough.',
      why: `${proUpgrade.length} sampled users show intent without Pro entitlement.`,
    } : null,
    whiteGloveCandidate.length > 0 ? {
      priority: 'medium',
      lever: 'White-glove qualification',
      owner: 'Eric / Branden',
      action: 'Review high-intent Pro users for founder or enterprise package outreach.',
      why: `${whiteGloveCandidate.length} sampled users show stronger usage or click intent.`,
    } : null,
    missingSources.length > 0 ? {
      priority: 'low',
      lever: 'Data quality',
      owner: 'Product / Engineering',
      action: 'Fix missing or failing sources before automating outreach.',
      why: `${missingSources.length} source checks returned warnings.`,
    } : null,
  ].filter(Boolean);

  return NextResponse.json({
    success: true,
    generatedAt: now.toISOString(),
    window: {
      label: `last_${days}_days`,
      days,
      start: periodStart.toISOString(),
      end: now.toISOString(),
    },
    freshness: {
      sourceStatus: statuses,
      warnings: missingSources.map(status => `${status.source}: ${status.warning}`),
    },
    audience: {
      totalUsers: customerUsers.length,
      miFree,
      miPro,
      miTrial,
      miInternal: Array.from(users.values()).filter(user => user.internal).length,
      importedNoAccount,
      accountCreatedNoProfile,
      profileComplete,
      // Rate is against the ACTIVE audience (alerts-on), not the dead-import total —
      // 9,865 never-activated imports made this read a misleading 11% (memory:
      // command-center measures the graveyard). Real active base is the honest denominator.
      profileCompletionRate: percent(profileComplete, Math.max(1, customerUsers.filter(user => user.alertsEnabled).length)),
      activeAlertAudience: customerUsers.filter(user => user.alertsEnabled).length,
      briefingsEligible: customerUsers.filter(user => user.proEntitled && user.briefingsEnabled && user.hasCustomProfile).length,
      briefingsNeedProfile: customerUsers.filter(user => user.proEntitled && !user.hasCustomProfile).length,
    },
    engagement: {
      activeToday: activeToday.size,
      active7d: active7d.size,
      timeInMiMinutes: Math.round(customerUsers.reduce((sum, user) => sum + user.timeMinutes, 0) * 10) / 10,
      avgMinutesPerActiveUser: active7d.size > 0
        ? Math.round((customerUsers.reduce((sum, user) => sum + user.timeMinutes, 0) / active7d.size) * 10) / 10
        : 0,
      topAreas,
    },
    email: {
      sent: providerEmail.sent,
      delivered: providerEmail.delivered,
      opened: providerEmail.opened || customerUsers.reduce((sum, user) => sum + user.emailOpens, 0),
      clicked: providerEmail.clicked || customerUsers.reduce((sum, user) => sum + user.emailClicks, 0),
      bounced: providerEmail.bounced,
      complained: providerEmail.complained,
      failed: providerEmail.failed,
      deliveryRate: percent(providerEmail.delivered, providerEmail.sent),
      clickRate: percent(providerEmail.clicked || customerUsers.reduce((sum, user) => sum + user.emailClicks, 0), providerEmail.delivered || providerEmail.sent),
      topLinks,
      note: 'Opens can be undercounted by privacy tools. Clicks and app activity are stronger signals.',
    },
    queues: {
      setupInvite,
      profileNudge,
      activationRescue,
      proUpgrade,
      whiteGloveCandidate,
    },
    recommendedActions,
    dataQuality: {
      excludedInternalOrTestUsers: Array.from(users.values()).filter(user => user.internal).length,
      queueLimit: MAX_QUEUE_ITEMS,
      notes: [
        'V1 is read-only and does not send email or change entitlements.',
        'Imported-no-account is inferred from settings/profile/app signals until Supabase Auth user joins are added.',
        'Profile complete means custom NAICS exists beyond the default starter set.',
      ],
    },
  });
}
