/**
 * GET /api/admin/member-contract-wins?password=<ADMIN_PASSWORD>
 *
 * "How many federal contracts have Mindy members won?" (Eric, 2026-11-10).
 *
 * A win can only be tied to a member through their company's SAM UEI, so the population is the
 * members who saved a valid 12-character UEI in their Company Vault (user_identity_profile).
 * Their UEIs are looked up in the BigQuery awards table (TRANSACTION grain: one award has many
 * rows, so contracts = DISTINCT award_id and dollars = each award's summed obligation, counting
 * only awards whose net obligation is positive).
 *
 * Two answers, never blended:
 *   lifetime     — every award those companies ever received.
 *   sinceJoining — awards whose first action is on/after the member joined Mindy (the earlier of
 *                  their alert-settings row and their Vault row). This is the one that can back a
 *                  "Mindy members have won…" claim.
 * Coverage is always returned: a number without its population is not defensible.
 * Read-only. Any failed read is an error, never a zero.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyAdminPassword } from '@/lib/admin-auth';
import { bqQuery, bqJobOptions, BQ_TABLES } from '@/lib/bigquery/client';
import { memberUeis, recentWinners, sinceJoining, tallyWins, type AwardRow, type ProfileRow, type SettingsRow } from '@/lib/admin/member-wins';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const PAGE = 1000;
const BQ_CHUNK = 500;

function sb() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
}

async function readAll<T>(table: string, columns: string): Promise<T[]> {
  const supabase = sb();
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase.from(table).select(columns).order('user_email').range(from, from + PAGE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...((data ?? []) as T[]));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

export async function GET(req: NextRequest) {
  if (!verifyAdminPassword(req.nextUrl.searchParams.get('password'))) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const profiles = await readAll<ProfileRow>('user_identity_profile', 'user_email, uei, created_at');
    // Join date = earliest known record of the member. Alert settings usually predate the Vault.
    const settings = await readAll<SettingsRow>('user_notification_settings', 'user_email, created_at');
    const { joined: ueiJoined, withUei } = memberUeis(profiles, settings);
    const ueis = [...ueiJoined.keys()];

    const awards: AwardRow[] = [];
    for (let i = 0; i < ueis.length; i += BQ_CHUNK) {
      const rows = await bqQuery<AwardRow>({
        query: `
          SELECT recipient_uei, award_id,
                 CAST(MIN(action_date) AS STRING) AS first_action,
                 SUM(obligation_amount) AS amount,
                 ANY_VALUE(recipient_name) AS recipient_name,
                 ANY_VALUE(awarding_agency) AS awarding_agency
          FROM ${BQ_TABLES.awards}
          WHERE recipient_uei IN UNNEST(@ueis)
          GROUP BY recipient_uei, award_id
        `,
        params: { ueis: ueis.slice(i, i + BQ_CHUNK) },
        ...bqJobOptions({ feature: 'admin_member_contract_wins', tool: 'admin_api', queryFamily: 'awards_by_uei' }),
      });
      awards.push(...rows);
    }

    const sinceRows = sinceJoining(awards, ueiJoined);

    // ?recentMonths=N → which members won a NEW award (first action) in the last N months.
    const recentMonths = Number(req.nextUrl.searchParams.get('recentMonths') || 0);
    let recent: ReturnType<typeof recentWinners> | undefined;
    if (Number.isFinite(recentMonths) && recentMonths > 0) {
      const emailsByUei = new Map<string, string[]>();
      for (const p of profiles) {
        const uei = (p.uei || '').trim().toUpperCase();
        if (!ueiJoined.has(uei)) continue;
        const list = emailsByUei.get(uei) ?? [];
        if (p.user_email && !list.includes(p.user_email.toLowerCase())) list.push(p.user_email.toLowerCase());
        emailsByUei.set(uei, list);
      }
      recent = recentWinners(awards, emailsByUei, recentMonths);
    }
    const unknownJoin = ueis.filter((u) => !Number.isFinite(ueiJoined.get(u) as number)).length;

    return NextResponse.json({
      success: true,
      coverage: {
        vaultProfiles: profiles.length,
        profilesWithValidUei: withUei,
        distinctCompanies: ueis.length,
        companiesWithUnknownJoinDate: unknownJoin,
        note: 'Only members who saved a valid SAM UEI in their Company Vault can be counted.',
      },
      lifetime: tallyWins(awards),
      sinceJoining: tallyWins(sinceRows),
      ...(recent ? { recentWinners: { months: recentMonths, ...recent } } : {}),
      definitions: {
        contract: 'A distinct award (award_id) with positive net obligation.',
        dollars: 'Sum of each award\'s net obligated dollars (USASpending via BigQuery).',
        sinceJoining: 'Award first action on/after the member\'s earliest Mindy record.',
      },
    });
  } catch (err) {
    console.error('[member-contract-wins]', err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Failed to compute member wins' },
      { status: 502 },
    );
  }
}
