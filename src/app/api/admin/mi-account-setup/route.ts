import { NextRequest, NextResponse } from 'next/server';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
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
  return email === 'eric@govcongiants.com' || domain === 'govcongiants.com' || domain === 'govcongiants.org';
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

async function fetchAuthEmails(supabase: SupabaseClient): Promise<Set<string>> {
  const emails = new Set<string>();
  const perPage = 1000;

  for (let page = 1; page <= 50; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });

    if (error) {
      throw new Error(`Auth users: ${error.message}`);
    }

    const users = data?.users || [];
    for (const user of users) {
      const email = normalizeEmail(user.email);
      if (email) emails.add(email);
    }

    if (users.length < perPage) break;
  }

  return emails;
}

async function fetchEntitledCandidates(supabase: SupabaseClient, warnings: string[]): Promise<EntitledCandidate[]> {
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
      'user_email, briefings_enabled, is_active',
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

  return Array.from(candidates.entries())
    .map(([email, sources]) => ({ email, sources: Array.from(sources).sort() }))
    .sort((a, b) => a.email.localeCompare(b.email));
}

export async function GET(request: NextRequest) {
  try {
    const password = request.nextUrl.searchParams.get('password');
    if (!verifyAdminPassword(password)) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = getSupabaseAdmin();
    const warnings: string[] = [];
    const [authEmails, candidates] = await Promise.all([
      fetchAuthEmails(supabase),
      fetchEntitledCandidates(supabase, warnings),
    ]);

    const needsSetup = candidates.filter((candidate) => !authEmails.has(candidate.email));
    const hasAuth = candidates.filter((candidate) => authEmails.has(candidate.email));
    const sampleLimit = Number(request.nextUrl.searchParams.get('limit') || 500);

    return NextResponse.json({
      success: true,
      summary: {
        entitledCandidates: candidates.length,
        existingAuthAccounts: hasAuth.length,
        needsSetup: needsSetup.length,
        authDirectorySize: authEmails.size,
        warnings: warnings.length,
      },
      needsSetup: needsSetup.slice(0, sampleLimit),
      hasAuth: hasAuth.slice(0, Math.min(sampleLimit, 100)),
      warnings,
    });
  } catch (error) {
    console.error('[MI Account Setup Admin] Failed:', error);
    return NextResponse.json({ success: false, error: 'Unable to build MI account setup report' }, { status: 500 });
  }
}
