import { NextRequest, NextResponse } from 'next/server';
import { createClient, SupabaseClient, User } from '@supabase/supabase-js';
import { verifyAdminPassword } from '@/lib/admin-auth';

type EntitledCandidate = {
  email: string;
  sources: string[];
};

type CandidateRow = {
  email?: string | null;
  user_email?: string | null;
  briefings_access?: string | null;
  briefings_expiry?: string | null;
  classification_version?: number | null;
  access_hunter_pro?: boolean | null;
  access_assassin_standard?: boolean | null;
  access_assassin_premium?: boolean | null;
  access_recompete?: boolean | null;
  access_contractor_db?: boolean | null;
  access_content_standard?: boolean | null;
  access_content_full_fix?: boolean | null;
  access_briefings?: boolean | null;
  briefings_enabled?: boolean | null;
  is_active?: boolean | null;
  alerts_enabled?: boolean | null;
  naics_codes?: string[] | null;
  keywords?: string[] | null;
  agencies?: string[] | null;
};

type EmailSendRow = {
  user_email?: string | null;
  email_type?: string | null;
  subject?: string | null;
  status?: string | null;
  sent_at?: string | null;
};

type AuthUserSummary = {
  email: string;
  createdAt: string | null;
  emailConfirmedAt: string | null;
  lastSignInAt: string | null;
};

type AccountStatus = 'ready' | 'needs_setup' | 'needs_profile' | 'needs_attention';

type AccountStatusRow = {
  email: string;
  status: AccountStatus;
  recommendedAction: string;
  sources: string[];
  isInternal: boolean;
  auth: {
    hasAccount: boolean;
    createdAt: string | null;
    emailConfirmedAt: string | null;
    lastSignInAt: string | null;
  };
  profile: {
    exists: boolean;
    accessBriefings: boolean;
  };
  settings: {
    exists: boolean;
    isActive: boolean;
    alertsEnabled: boolean;
    briefingsEnabled: boolean;
    hasProfileSignals: boolean;
  };
  setupEmail: {
    sent: boolean;
    sentAt: string | null;
    type: string | null;
    status: string | null;
    subject: string | null;
  };
};

const ENTITLED_BRIEFING_ACCESS = new Set(['lifetime', '1_year', '6_month', 'subscription', 'beta_preview']);
const PAID_PROFILE_FLAGS = [
  'access_hunter_pro',
  'access_assassin_standard',
  'access_assassin_premium',
  'access_recompete',
  'access_contractor_db',
  'access_content_standard',
  'access_content_full_fix',
  'access_briefings',
] as const;

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error('Supabase service role is not configured');
  }

  // NOTE: kept on the PRIMARY (not getReadClient) because this route also calls
  // supabase.auth.admin.listUsers — GoTrue admin against a read-replica client is
  // unproven, so we don't risk it here. The Postgres analytics scans below are the
  // heavy part; if a replica-safe auth path lands later, split this.
  return createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

function normalizeEmail(value: string | null | undefined): string {
  return (value || '').toLowerCase().trim();
}

function isInternalEmail(email: string): boolean {
  const domain = email.split('@')[1] || '';
  return email === 'eric@govcongiants.com' || domain === 'govcongiants.com' || domain === 'govcongiants.com';
}

function addCandidate(candidates: Map<string, Set<string>>, email: string, source: string) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail || !normalizedEmail.includes('@')) return;

  if (!candidates.has(normalizedEmail)) {
    candidates.set(normalizedEmail, new Set());
  }
  candidates.get(normalizedEmail)?.add(source);
}

async function fetchAllRows<T>(
  supabase: SupabaseClient,
  table: string,
  select: string,
  warnings: string[]
): Promise<T[]> {
  const rows: T[] = [];
  const pageSize = 1000;

  for (let from = 0; from < 50000; from += pageSize) {
    const to = from + pageSize - 1;
    const { data, error } = await supabase.from(table).select(select).range(from, to);

    if (error) {
      warnings.push(`${table}: ${error.message}`);
      return rows;
    }

    rows.push(...((data || []) as T[]));
    if (!data || data.length < pageSize) break;
  }

  return rows;
}

async function fetchAuthUsers(supabase: SupabaseClient): Promise<Map<string, AuthUserSummary>> {
  const usersByEmail = new Map<string, AuthUserSummary>();
  const perPage = 1000;

  for (let page = 1; page <= 50; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });

    if (error) {
      throw new Error(`Auth users: ${error.message}`);
    }

    const users = data?.users || [];
    for (const user of users) {
      const email = normalizeEmail(user.email);
      if (email) {
        usersByEmail.set(email, summarizeAuthUser(user));
      }
    }

    if (users.length < perPage) break;
  }

  return usersByEmail;
}

function summarizeAuthUser(user: User): AuthUserSummary {
  return {
    email: normalizeEmail(user.email),
    createdAt: user.created_at || null,
    emailConfirmedAt: user.email_confirmed_at || null,
    lastSignInAt: user.last_sign_in_at || null,
  };
}

async function fetchEntitlementData(supabase: SupabaseClient, warnings: string[]) {
  const candidates = new Map<string, Set<string>>();
  const now = Date.now();

  const [classificationRows, profileRows, settingsRows] = await Promise.all([
    fetchAllRows<CandidateRow>(
      supabase,
      'customer_classifications',
      'email, briefings_access, briefings_expiry, classification_version',
      warnings
    ),
    fetchAllRows<CandidateRow>(
      supabase,
      'user_profiles',
      'email, access_hunter_pro, access_assassin_standard, access_assassin_premium, access_recompete, access_contractor_db, access_content_standard, access_content_full_fix, access_briefings',
      warnings
    ),
    fetchAllRows<CandidateRow>(
      supabase,
      'user_notification_settings',
      'user_email, briefings_enabled, alerts_enabled, is_active, naics_codes, keywords, agencies',
      warnings
    ),
  ]);

  const latestClassificationVersion = classificationRows.reduce(
    (max, row) => Math.max(max, Number(row.classification_version || 0)),
    0
  );

  for (const row of classificationRows) {
    const email = normalizeEmail(row.email);
    if (!email) continue;

    if (isInternalEmail(email)) {
      addCandidate(candidates, email, 'internal_domain');
    }

    if (Number(row.classification_version || 0) !== latestClassificationVersion) continue;
    if (!ENTITLED_BRIEFING_ACCESS.has(row.briefings_access || '')) continue;
    if (row.briefings_expiry && new Date(row.briefings_expiry).getTime() <= now) continue;

    addCandidate(candidates, email, `customer_classifications:${row.briefings_access}`);
  }

  for (const row of profileRows) {
    const email = normalizeEmail(row.email);
    if (!email) continue;

    if (isInternalEmail(email)) {
      addCandidate(candidates, email, 'internal_domain');
    }

    if (PAID_PROFILE_FLAGS.some((flag) => row[flag] === true)) {
      addCandidate(candidates, email, 'user_profiles:paid_tool_access');
    }
  }

  for (const row of settingsRows) {
    const email = normalizeEmail(row.user_email);
    if (!email) continue;

    if (isInternalEmail(email)) {
      addCandidate(candidates, email, 'internal_domain');
    }

    if (row.is_active !== false && row.briefings_enabled === true) {
      addCandidate(candidates, email, 'user_notification_settings:briefings_enabled');
    }
  }

  const entitledCandidates = Array.from(candidates.entries())
    .map(([email, sources]) => ({ email, sources: Array.from(sources).sort() }))
    .sort((a, b) => a.email.localeCompare(b.email));

  return {
    candidates: entitledCandidates,
    profilesByEmail: new Map(profileRows.map((row) => [normalizeEmail(row.email), row])),
    settingsByEmail: new Map(settingsRows.map((row) => [normalizeEmail(row.user_email), row])),
  };
}

async function fetchLatestSetupEmails(
  supabase: SupabaseClient,
  emails: string[],
  warnings: string[]
): Promise<Map<string, EmailSendRow>> {
  const latestByEmail = new Map<string, EmailSendRow>();
  const setupTypes = ['mi_account_setup', 'market_intelligence_welcome', 'profile_reminder'];

  for (let i = 0; i < emails.length; i += 200) {
    const chunk = emails.slice(i, i + 200);
    const { data, error } = await supabase
      .from('email_provider_sends')
      .select('user_email, email_type, subject, status, sent_at')
      .in('user_email', chunk)
      .in('email_type', setupTypes)
      .order('sent_at', { ascending: false })
      .limit(1000);

    if (error) {
      warnings.push(`email_provider_sends: ${error.message}`);
      return latestByEmail;
    }

    for (const row of (data || []) as EmailSendRow[]) {
      const email = normalizeEmail(row.user_email);
      if (email && !latestByEmail.has(email)) {
        latestByEmail.set(email, row);
      }
    }
  }

  return latestByEmail;
}

function hasProfileSignals(settings?: CandidateRow): boolean {
  if (!settings) return false;
  return Boolean(
    settings.naics_codes?.length ||
    settings.keywords?.length ||
    settings.agencies?.length
  );
}

function getAccountStatus(row: {
  hasAuth: boolean;
  hasSettings: boolean;
  hasProfileSignals: boolean;
  briefingsEnabled: boolean;
}): { status: AccountStatus; recommendedAction: string } {
  if (!row.hasAuth) {
    return {
      status: 'needs_setup',
      recommendedAction: 'Send account setup link and confirm they can create a password.',
    };
  }

  if (!row.hasSettings || !row.hasProfileSignals) {
    return {
      status: 'needs_profile',
      recommendedAction: 'Nudge profile setup so alerts and briefings are personalized.',
    };
  }

  if (!row.briefingsEnabled) {
    return {
      status: 'needs_attention',
      recommendedAction: 'Review entitlement versus notification settings before outreach.',
    };
  }

  return {
    status: 'ready',
    recommendedAction: 'No account setup action needed.',
  };
}

function buildAccountRows({
  candidates,
  authUsers,
  profilesByEmail,
  settingsByEmail,
  setupEmails,
}: {
  candidates: EntitledCandidate[];
  authUsers: Map<string, AuthUserSummary>;
  profilesByEmail: Map<string, CandidateRow>;
  settingsByEmail: Map<string, CandidateRow>;
  setupEmails: Map<string, EmailSendRow>;
}): AccountStatusRow[] {
  return candidates.map((candidate) => {
    const authUser = authUsers.get(candidate.email);
    const profile = profilesByEmail.get(candidate.email);
    const settings = settingsByEmail.get(candidate.email);
    const setupEmail = setupEmails.get(candidate.email);
    const profileSignals = hasProfileSignals(settings);
    const accountState = getAccountStatus({
      hasAuth: Boolean(authUser),
      hasSettings: Boolean(settings),
      hasProfileSignals: profileSignals,
      briefingsEnabled: settings?.briefings_enabled === true,
    });

    return {
      email: candidate.email,
      status: accountState.status,
      recommendedAction: accountState.recommendedAction,
      sources: candidate.sources,
      isInternal: isInternalEmail(candidate.email),
      auth: {
        hasAccount: Boolean(authUser),
        createdAt: authUser?.createdAt || null,
        emailConfirmedAt: authUser?.emailConfirmedAt || null,
        lastSignInAt: authUser?.lastSignInAt || null,
      },
      profile: {
        exists: Boolean(profile),
        accessBriefings: profile?.access_briefings === true,
      },
      settings: {
        exists: Boolean(settings),
        isActive: settings?.is_active === true,
        alertsEnabled: settings?.alerts_enabled === true,
        briefingsEnabled: settings?.briefings_enabled === true,
        hasProfileSignals: profileSignals,
      },
      setupEmail: {
        sent: Boolean(setupEmail),
        sentAt: setupEmail?.sent_at || null,
        type: setupEmail?.email_type || null,
        status: setupEmail?.status || null,
        subject: setupEmail?.subject || null,
      },
    };
  }).sort((a, b) => {
    const statusOrder: Record<AccountStatus, number> = {
      needs_setup: 0,
      needs_profile: 1,
      needs_attention: 2,
      ready: 3,
    };
    return statusOrder[a.status] - statusOrder[b.status] || a.email.localeCompare(b.email);
  });
}

export async function GET(request: NextRequest) {
  try {
    const password = request.nextUrl.searchParams.get('password');
    if (!verifyAdminPassword(password)) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = getSupabaseAdmin();
    const warnings: string[] = [];
    const [authUsers, entitlementData] = await Promise.all([
      fetchAuthUsers(supabase),
      fetchEntitlementData(supabase, warnings),
    ]);
    const candidates = entitlementData.candidates;
    const setupEmails = await fetchLatestSetupEmails(
      supabase,
      candidates.map((candidate) => candidate.email),
      warnings
    );
    const accounts = buildAccountRows({
      candidates,
      authUsers,
      profilesByEmail: entitlementData.profilesByEmail,
      settingsByEmail: entitlementData.settingsByEmail,
      setupEmails,
    });

    const sampleLimit = Number(request.nextUrl.searchParams.get('limit') || 500);
    const byStatus = accounts.reduce<Record<AccountStatus, number>>((acc, row) => {
      acc[row.status] += 1;
      return acc;
    }, {
      ready: 0,
      needs_setup: 0,
      needs_profile: 0,
      needs_attention: 0,
    });

    return NextResponse.json({
      success: true,
      summary: {
        entitledCandidates: candidates.length,
        existingAuthAccounts: accounts.filter((row) => row.auth.hasAccount).length,
        needsSetup: byStatus.needs_setup,
        needsProfile: byStatus.needs_profile,
        needsAttention: byStatus.needs_attention,
        ready: byStatus.ready,
        setupEmailsSent: accounts.filter((row) => row.setupEmail.sent).length,
        internalUsers: accounts.filter((row) => row.isInternal).length,
        authDirectorySize: authUsers.size,
        warnings: warnings.length,
      },
      accounts: accounts.slice(0, sampleLimit),
      needsSetup: accounts.filter((row) => row.status === 'needs_setup').slice(0, sampleLimit),
      hasAuth: accounts.filter((row) => row.auth.hasAccount).slice(0, Math.min(sampleLimit, 100)),
      warnings,
    });
  } catch (error) {
    console.error('[MI Account Setup Admin] Failed:', error);
    return NextResponse.json({ success: false, error: 'Unable to build MI account setup report' }, { status: 500 });
  }
}
