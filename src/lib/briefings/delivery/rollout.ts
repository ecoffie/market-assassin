import { kv } from '@vercel/kv';
import { SupabaseClient } from '@supabase/supabase-js';

const DEFAULT_PAGE_SIZE = 1000;
const DEFAULT_MAX_AUDIENCE = 20000;
const DEFAULT_COHORT_SIZE = 250;
const DEFAULT_STICKY_DAYS = 14;
const DEFAULT_COOLDOWN_DAYS = 21;
const DEFAULT_MAX_FALLBACK_PERCENT = 15;

const CONFIG_KEY = 'briefings:rollout:config';
const ACTIVE_COHORT_KEY = 'briefings:rollout:active-cohort';

export type BriefingProgramType = 'daily_brief' | 'weekly_deep_dive' | 'pursuit_brief';

export type BriefingRolloutMode = 'beta_all' | 'rollout';

type AudienceSource = 'notification_settings' | 'smart_profile';

interface NotificationSettingsRow {
  user_email: string | null;
  naics_codes: string[] | null;
  agencies: string[] | null;
  timezone?: string | null;
  sms_enabled?: boolean | null;
  phone_number?: string | null;
  aggregated_profile?: {
    naics_codes?: string[];
    agencies?: string[];
  } | null;
}

interface SmartProfileRow {
  email: string | null;
  naics_codes: string[] | null;
  agencies: string[] | null;
  timezone?: string | null;
}

interface BriefingEntitlementRow {
  email: string | null;
  access_briefings: boolean | null;
  briefings_expires_at?: string | null;
}

export interface BriefingAudienceUser {
  email: string;
  naics_codes: string[];
  agencies: string[];
  timezone?: string;
  sms_enabled?: boolean;
  phone_number?: string;
  source: 'briefing_profile' | 'alert_settings';
  hasProfileData: boolean;
  usesFallback: boolean;
  hasPaidBriefingAccess?: boolean;
}

export interface BriefingRolloutConfig {
  mode: BriefingRolloutMode;
  cohortSize: number;
  stickyDays: number;
  cooldownDays: number;
  maxFallbackPercent: number;
  includeSmartProfiles: boolean;
  requiredDailyBriefs: number;
  requiredWeeklyDeepDives: number;
  requiredPursuitBriefs: number;
  updatedAt: string;
}

export interface BriefingRolloutCohort {
  id: string;
  createdAt: string;
  eligibleToRotateAt: string;
  expiresAt?: string;
  memberEmails: string[];
  profileReadyCount: number;
  fallbackCount: number;
}

export interface BriefingCohortMemberProgress {
  email: string;
  dailyBriefsSent: number;
  weeklyDeepDivesSent: number;
  pursuitBriefsSent: number;
  lastDailyBriefAt?: string;
  lastWeeklyDeepDiveAt?: string;
  lastPursuitBriefAt?: string;
  complete: boolean;
}

export interface BriefingCohortProgressSummary {
  readyToRotate: boolean;
  eligibleToRotateAt: string;
  minimumDurationMet: boolean;
  membersComplete: number;
  membersRemaining: number;
  requirements: {
    dailyBriefs: number;
    weeklyDeepDives: number;
    pursuitBriefs: number;
  };
  remainingByType: {
    dailyBriefs: number;
    weeklyDeepDives: number;
    pursuitBriefs: number;
  };
  incompleteMembersSample: BriefingCohortMemberProgress[];
}

export interface BriefingAudienceResolution {
  users: BriefingAudienceUser[];
  config: BriefingRolloutConfig;
  activeCohort: BriefingRolloutCohort | null;
  cohortProgress: BriefingCohortProgressSummary | null;
  audienceSummary: {
    totalCandidates: number;
    profileReadyCandidates: number;
    fallbackCandidates: number;
    selectedUsers: number;
    selectedProfileReady: number;
    selectedFallback: number;
  };
}

function toIsoDay(daysFromNow: number): string {
  const date = new Date();
  date.setDate(date.getDate() + daysFromNow);
  return date.toISOString();
}

function getAssignmentKey(email: string): string {
  return `briefings:rollout:last-assigned:${email.toLowerCase()}`;
}

function getProgressKey(cohortId: string, email: string): string {
  return `briefings:rollout:cohort:${cohortId}:member:${email.toLowerCase()}:progress`;
}

function normalizeArray(values: string[] | null | undefined): string[] {
  return Array.isArray(values)
    ? values.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    : [];
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

async function fetchAllRows<T>(
  fetchPage: (from: number, to: number) => Promise<T[] | null | undefined>,
  maxRows = DEFAULT_MAX_AUDIENCE
): Promise<T[]> {
  const rows: T[] = [];

  for (let from = 0; from < maxRows; from += DEFAULT_PAGE_SIZE) {
    const page = await fetchPage(from, from + DEFAULT_PAGE_SIZE - 1);
    if (!page || page.length === 0) break;
    rows.push(...page);
    if (page.length < DEFAULT_PAGE_SIZE) break;
  }

  return rows;
}

async function fetchNotificationSettings(supabase: SupabaseClient): Promise<NotificationSettingsRow[]> {
  return fetchAllRows(async (from, to) => {
    const { data, error } = await supabase
      .from('user_notification_settings')
      .select('user_email, naics_codes, agencies, timezone, sms_enabled, phone_number, aggregated_profile')
      .eq('is_active', true)
      .order('user_email')
      .range(from, to);

    if (error) throw error;
    return (data || []) as NotificationSettingsRow[];
  });
}

async function fetchSmartProfiles(supabase: SupabaseClient): Promise<SmartProfileRow[]> {
  const rows = await fetchAllRows(async (from, to) => {
    const { data, error } = await supabase
      .from('smart_user_profiles')
      .select('email, naics_codes, agencies, timezone')
      .order('email')
      .range(from, to);

    if (error) {
      if (error.message.includes('Could not find the table') || error.message.includes('schema cache')) {
        return [];
      }
      throw error;
    }

    return (data || []) as SmartProfileRow[];
  });

  return rows;
}

async function fetchBriefingEntitlements(supabase: SupabaseClient): Promise<Set<string>> {
  const rows = await fetchAllRows(async (from, to) => {
    const { data, error } = await supabase
      .from('user_profiles')
      .select('email, access_briefings, briefings_expires_at')
      .eq('access_briefings', true)
      .order('email')
      .range(from, to);

    if (error) {
      if (error.message.includes('Could not find the table') || error.message.includes('schema cache')) {
        return [];
      }
      throw error;
    }

    return (data || []) as BriefingEntitlementRow[];
  });

  const entitled = new Set<string>();
  const now = Date.now();

  for (const row of rows) {
    const email = row.email?.toLowerCase().trim();
    if (!email || !row.access_briefings) continue;
    if (row.briefings_expires_at && new Date(row.briefings_expires_at).getTime() < now) {
      continue;
    }
    entitled.add(email);
  }

  return entitled;
}

function buildCandidate(
  existing: BriefingAudienceUser | undefined,
  next: {
    email: string;
    naics_codes: string[];
    agencies: string[];
    timezone?: string;
    sms_enabled?: boolean;
    phone_number?: string;
    source: AudienceSource;
  }
): BriefingAudienceUser {
  const mergedNaics = Array.from(new Set([...(existing?.naics_codes || []), ...next.naics_codes]));
  const mergedAgencies = Array.from(new Set([...(existing?.agencies || []), ...next.agencies]));
  const hasProfileData = mergedNaics.length > 0 || mergedAgencies.length > 0;

  return {
    email: next.email,
    naics_codes: mergedNaics,
    agencies: mergedAgencies,
    timezone: next.timezone || existing?.timezone,
    sms_enabled: next.sms_enabled ?? existing?.sms_enabled,
    phone_number: next.phone_number ?? existing?.phone_number,
    source: next.source === 'notification_settings' ? 'briefing_profile' : 'alert_settings',
    hasProfileData,
    usesFallback: !hasProfileData,
  };
}

export async function fetchBriefingAudienceCandidates(
  supabase: SupabaseClient,
  options?: { includeSmartProfiles?: boolean }
): Promise<BriefingAudienceUser[]> {
  const includeSmartProfiles = options?.includeSmartProfiles ?? true;
  const usersByEmail = new Map<string, BriefingAudienceUser>();
  const entitledEmails = await fetchBriefingEntitlements(supabase);

  const notificationSettings = await fetchNotificationSettings(supabase);
  for (const row of notificationSettings) {
    const email = row.user_email?.toLowerCase().trim();
    if (!email) continue;

    const aggregatedNaics = normalizeArray(row.aggregated_profile?.naics_codes);
    const aggregatedAgencies = normalizeArray(row.aggregated_profile?.agencies);
    const candidate = buildCandidate(usersByEmail.get(email), {
      email,
      naics_codes: Array.from(new Set([...normalizeArray(row.naics_codes), ...aggregatedNaics])),
      agencies: Array.from(new Set([...normalizeArray(row.agencies), ...aggregatedAgencies])),
      timezone: row.timezone || undefined,
      sms_enabled: Boolean(row.sms_enabled),
      phone_number: row.phone_number || undefined,
      source: 'notification_settings',
    });
    usersByEmail.set(email, candidate);
  }

  if (includeSmartProfiles) {
    const smartProfiles = await fetchSmartProfiles(supabase);
    for (const row of smartProfiles) {
      const email = row.email?.toLowerCase().trim();
      if (!email) continue;

      const candidate = buildCandidate(usersByEmail.get(email), {
        email,
        naics_codes: normalizeArray(row.naics_codes),
        agencies: normalizeArray(row.agencies),
        timezone: row.timezone || undefined,
        source: 'smart_profile',
      });
      usersByEmail.set(email, candidate);
    }
  }

  return Array.from(usersByEmail.values())
    .map(user => ({
      ...user,
      hasPaidBriefingAccess: entitledEmails.has(user.email),
    }))
    .sort((a, b) => a.email.localeCompare(b.email));
}

export async function getBriefingRolloutConfig(): Promise<BriefingRolloutConfig> {
  const stored = await kv.get<Partial<BriefingRolloutConfig>>(CONFIG_KEY);

  return {
    mode: stored?.mode === 'rollout' ? 'rollout' : 'beta_all',
    cohortSize: clampNumber(stored?.cohortSize || DEFAULT_COHORT_SIZE, 25, 2000),
    stickyDays: clampNumber(stored?.stickyDays || DEFAULT_STICKY_DAYS, 14, 30),
    cooldownDays: clampNumber(stored?.cooldownDays || DEFAULT_COOLDOWN_DAYS, 1, 90),
    maxFallbackPercent: clampNumber(stored?.maxFallbackPercent || DEFAULT_MAX_FALLBACK_PERCENT, 0, 100),
    includeSmartProfiles: stored?.includeSmartProfiles ?? true,
    requiredDailyBriefs: clampNumber(stored?.requiredDailyBriefs || 2, 1, 14),
    requiredWeeklyDeepDives: clampNumber(stored?.requiredWeeklyDeepDives || 2, 1, 8),
    requiredPursuitBriefs: clampNumber(stored?.requiredPursuitBriefs || 2, 1, 14),
    updatedAt: stored?.updatedAt || new Date().toISOString(),
  };
}

export async function saveBriefingRolloutConfig(
  partial: Partial<BriefingRolloutConfig>
): Promise<BriefingRolloutConfig> {
  const current = await getBriefingRolloutConfig();
  const next: BriefingRolloutConfig = {
    ...current,
    ...partial,
    cohortSize: clampNumber(partial.cohortSize ?? current.cohortSize, 25, 2000),
    stickyDays: clampNumber(partial.stickyDays ?? current.stickyDays, 14, 30),
    cooldownDays: clampNumber(partial.cooldownDays ?? current.cooldownDays, 1, 90),
    maxFallbackPercent: clampNumber(partial.maxFallbackPercent ?? current.maxFallbackPercent, 0, 100),
    requiredDailyBriefs: clampNumber(partial.requiredDailyBriefs ?? current.requiredDailyBriefs, 1, 14),
    requiredWeeklyDeepDives: clampNumber(partial.requiredWeeklyDeepDives ?? current.requiredWeeklyDeepDives, 1, 8),
    requiredPursuitBriefs: clampNumber(partial.requiredPursuitBriefs ?? current.requiredPursuitBriefs, 1, 14),
    updatedAt: new Date().toISOString(),
  };

  await kv.set(CONFIG_KEY, next);
  return next;
}

export async function clearActiveBriefingCohort(): Promise<void> {
  await kv.del(ACTIVE_COHORT_KEY);
}

async function getActiveCohort(): Promise<BriefingRolloutCohort | null> {
  const cohort = await kv.get<BriefingRolloutCohort>(ACTIVE_COHORT_KEY);
  if (!cohort) return null;

  return {
    ...cohort,
    eligibleToRotateAt: cohort.eligibleToRotateAt || cohort.expiresAt || cohort.createdAt,
  };
}

function isMemberComplete(
  progress: Omit<BriefingCohortMemberProgress, 'email' | 'complete'>,
  config: BriefingRolloutConfig
): boolean {
  return (
    progress.dailyBriefsSent >= config.requiredDailyBriefs &&
    progress.weeklyDeepDivesSent >= config.requiredWeeklyDeepDives &&
    progress.pursuitBriefsSent >= config.requiredPursuitBriefs
  );
}

async function getCohortProgressSummary(
  cohort: BriefingRolloutCohort | null,
  config: BriefingRolloutConfig
): Promise<BriefingCohortProgressSummary | null> {
  if (!cohort) return null;

  const keys = cohort.memberEmails.map(email => getProgressKey(cohort.id, email));
  const rows = keys.length > 0
    ? await kv.mget<Partial<BriefingCohortMemberProgress>[]>(...keys)
    : [];

  const members: BriefingCohortMemberProgress[] = cohort.memberEmails.map((email, index) => {
    const row = rows[index] || {};
    const base = {
      dailyBriefsSent: typeof row?.dailyBriefsSent === 'number' ? row.dailyBriefsSent : 0,
      weeklyDeepDivesSent: typeof row?.weeklyDeepDivesSent === 'number' ? row.weeklyDeepDivesSent : 0,
      pursuitBriefsSent: typeof row?.pursuitBriefsSent === 'number' ? row.pursuitBriefsSent : 0,
      lastDailyBriefAt: row?.lastDailyBriefAt,
      lastWeeklyDeepDiveAt: row?.lastWeeklyDeepDiveAt,
      lastPursuitBriefAt: row?.lastPursuitBriefAt,
    };

    return {
      email,
      ...base,
      complete: isMemberComplete(base, config),
    };
  });

  const minimumDurationMet = new Date(cohort.eligibleToRotateAt).getTime() <= Date.now();
  const membersComplete = members.filter(member => member.complete).length;
  const remainingByType = members.reduce(
    (acc, member) => {
      if (member.dailyBriefsSent < config.requiredDailyBriefs) acc.dailyBriefs++;
      if (member.weeklyDeepDivesSent < config.requiredWeeklyDeepDives) acc.weeklyDeepDives++;
      if (member.pursuitBriefsSent < config.requiredPursuitBriefs) acc.pursuitBriefs++;
      return acc;
    },
    { dailyBriefs: 0, weeklyDeepDives: 0, pursuitBriefs: 0 }
  );

  return {
    readyToRotate: minimumDurationMet && membersComplete === cohort.memberEmails.length,
    eligibleToRotateAt: cohort.eligibleToRotateAt,
    minimumDurationMet,
    membersComplete,
    membersRemaining: cohort.memberEmails.length - membersComplete,
    requirements: {
      dailyBriefs: config.requiredDailyBriefs,
      weeklyDeepDives: config.requiredWeeklyDeepDives,
      pursuitBriefs: config.requiredPursuitBriefs,
    },
    remainingByType,
    incompleteMembersSample: members.filter(member => !member.complete).slice(0, 25),
  };
}

export async function recordBriefingProgramDelivery(
  cohortId: string | null,
  email: string,
  type: BriefingProgramType
): Promise<void> {
  if (!cohortId) return;

  const key = getProgressKey(cohortId, email);
  const existing = await kv.get<Partial<BriefingCohortMemberProgress>>(key);
  const now = new Date().toISOString();
  const next = {
    dailyBriefsSent: existing?.dailyBriefsSent || 0,
    weeklyDeepDivesSent: existing?.weeklyDeepDivesSent || 0,
    pursuitBriefsSent: existing?.pursuitBriefsSent || 0,
    lastDailyBriefAt: existing?.lastDailyBriefAt,
    lastWeeklyDeepDiveAt: existing?.lastWeeklyDeepDiveAt,
    lastPursuitBriefAt: existing?.lastPursuitBriefAt,
  };

  if (type === 'daily_brief') {
    next.dailyBriefsSent += 1;
    next.lastDailyBriefAt = now;
  } else if (type === 'weekly_deep_dive') {
    next.weeklyDeepDivesSent += 1;
    next.lastWeeklyDeepDiveAt = now;
  } else if (type === 'pursuit_brief') {
    next.pursuitBriefsSent += 1;
    next.lastPursuitBriefAt = now;
  }

  await kv.set(key, next, { ex: 60 * 60 * 24 * 120 });
}

function scoreCandidate(candidate: BriefingAudienceUser): number {
  let score = candidate.naics_codes.length > 0 ? 200 : 0;
  score += candidate.hasProfileData ? 100 : 0;
  if (candidate.hasPaidBriefingAccess) score += 1000;
  if (candidate.source === 'briefing_profile') score += 25;
  if (!candidate.usesFallback) score += 25;
  return score;
}

async function buildNewCohort(
  candidates: BriefingAudienceUser[],
  config: BriefingRolloutConfig
): Promise<BriefingRolloutCohort> {
  const now = new Date();
  const rolloutCandidates = candidates.filter(candidate => candidate.naics_codes.length > 0);
  const profiled: BriefingAudienceUser[] = [];
  const fallback: BriefingAudienceUser[] = [];
  const assignmentKeys = rolloutCandidates.map(candidate => getAssignmentKey(candidate.email));
  const existingAssignments = assignmentKeys.length > 0
    ? await kv.mget<string[]>(...assignmentKeys)
    : [];
  const recentlyAssigned = new Set<string>();

  for (let index = 0; index < rolloutCandidates.length; index++) {
    if (existingAssignments[index]) {
      recentlyAssigned.add(rolloutCandidates[index].email);
    }
  }

  for (const candidate of rolloutCandidates.sort((a, b) => scoreCandidate(b) - scoreCandidate(a) || a.email.localeCompare(b.email))) {
    if (recentlyAssigned.has(candidate.email)) continue;

    if (candidate.hasProfileData) {
      profiled.push(candidate);
    } else {
      fallback.push(candidate);
    }
  }

  const maxFallback = Math.floor(config.cohortSize * (config.maxFallbackPercent / 100));
  const selected: BriefingAudienceUser[] = [];

  for (const candidate of profiled) {
    if (selected.length >= config.cohortSize) break;
    selected.push(candidate);
  }

  let fallbackIncluded = 0;
  for (const candidate of fallback) {
    if (selected.length >= config.cohortSize) break;
    if (fallbackIncluded >= maxFallback && selected.length >= Math.min(profiled.length, config.cohortSize)) {
      continue;
    }
    selected.push(candidate);
    fallbackIncluded++;
  }

  if (selected.length < config.cohortSize) {
    const remainder = fallback.filter(candidate => !selected.some(selectedCandidate => selectedCandidate.email === candidate.email));
    for (const candidate of remainder) {
      if (selected.length >= config.cohortSize) break;
      selected.push(candidate);
      fallbackIncluded++;
    }
  }

  const cohort: BriefingRolloutCohort = {
    id: `cohort-${now.toISOString().slice(0, 10)}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: now.toISOString(),
    eligibleToRotateAt: toIsoDay(config.stickyDays),
    memberEmails: selected.map(candidate => candidate.email),
    profileReadyCount: selected.filter(candidate => candidate.hasProfileData).length,
    fallbackCount: selected.filter(candidate => candidate.usesFallback).length,
  };

  await kv.set(ACTIVE_COHORT_KEY, cohort, { ex: 60 * 60 * 24 * 120 });
  for (const email of cohort.memberEmails) {
    await kv.set(getAssignmentKey(email), now.toISOString(), { ex: config.cooldownDays * 24 * 60 * 60 });
  }

  return cohort;
}

export async function resolveBriefingAudience(
  supabase: SupabaseClient
): Promise<BriefingAudienceResolution> {
  const config = await getBriefingRolloutConfig();
  const candidates = await fetchBriefingAudienceCandidates(supabase, {
    includeSmartProfiles: config.includeSmartProfiles,
  });

  const profileReadyCandidates = candidates.filter(candidate => candidate.hasProfileData).length;
  const fallbackCandidates = candidates.length - profileReadyCandidates;

  if (config.mode === 'beta_all') {
    return {
      users: candidates,
      config,
      activeCohort: null,
      cohortProgress: null,
      audienceSummary: {
        totalCandidates: candidates.length,
        profileReadyCandidates,
        fallbackCandidates,
        selectedUsers: candidates.length,
        selectedProfileReady: profileReadyCandidates,
        selectedFallback: fallbackCandidates,
      },
    };
  }

  const activeCohort = await getActiveCohort();
  const cohort = activeCohort || await buildNewCohort(candidates, config);
  const cohortProgress = await getCohortProgressSummary(cohort, config);
  const candidateMap = new Map(candidates.map(candidate => [candidate.email, candidate]));
  const selectedUsers = cohort.memberEmails
    .map(email => candidateMap.get(email))
    .filter((candidate): candidate is BriefingAudienceUser => Boolean(candidate));
  const entitledUsers = candidates.filter(candidate => candidate.hasPaidBriefingAccess);
  const selectedByEmail = new Map(selectedUsers.map(user => [user.email, user]));
  for (const user of entitledUsers) {
    selectedByEmail.set(user.email, user);
  }
  const finalUsers = Array.from(selectedByEmail.values())
    .sort((a, b) => scoreCandidate(b) - scoreCandidate(a) || a.email.localeCompare(b.email));

  return {
    users: finalUsers,
    config,
    activeCohort: cohort,
    cohortProgress,
    audienceSummary: {
      totalCandidates: candidates.length,
      profileReadyCandidates,
      fallbackCandidates,
      selectedUsers: finalUsers.length,
      selectedProfileReady: finalUsers.filter(candidate => candidate.hasProfileData).length,
      selectedFallback: finalUsers.filter(candidate => candidate.usesFallback).length,
    },
  };
}

export async function previewBriefingRollout(
  supabase: SupabaseClient
): Promise<BriefingAudienceResolution & { recommendedCohort: BriefingAudienceUser[] }> {
  const resolution = await resolveBriefingAudience(supabase);
  const candidates = await fetchBriefingAudienceCandidates(supabase, {
    includeSmartProfiles: resolution.config.includeSmartProfiles,
  });

  const activeEmails = new Set(resolution.activeCohort?.memberEmails || []);
  const recommendedCohort = candidates
    .filter(candidate => !activeEmails.has(candidate.email))
    .sort((a, b) => scoreCandidate(b) - scoreCandidate(a) || a.email.localeCompare(b.email))
    .slice(0, resolution.config.cohortSize);

  return {
    ...resolution,
    recommendedCohort,
  };
}
