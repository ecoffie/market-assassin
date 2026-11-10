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
import { companyBreakdown, memberUeis, recentWinners, sinceJoining, tallyWins, type CompanyBreakdown, type AwardRow, type ProfileRow, type SettingsRow } from '@/lib/admin/member-wins';

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
        // Admin-only and run on demand: scanning ~113 member UEIs with names + agencies measured 5.5 GB,
        // just over the 5 GB runtime default. 10 GB keeps a hard ceiling while letting it run.
        ...bqJobOptions({ feature: 'admin_member_contract_wins', tool: 'admin_api', queryFamily: 'awards_by_uei', maximumBytesBilled: 10 * 1024 * 1024 * 1024 }),
      });
      awards.push(...rows);
    }

    const sinceRows = sinceJoining(awards, ueiJoined);

    const emailsByUei = new Map<string, string[]>();
    for (const p of profiles) {
      const uei = (p.uei || '').trim().toUpperCase();
      if (!ueiJoined.has(uei) || !p.user_email) continue;
      const list = emailsByUei.get(uei) ?? [];
      if (!list.includes(p.user_email.toLowerCase())) list.push(p.user_email.toLowerCase());
      emailsByUei.set(uei, list);
    }
    const breakdown = companyBreakdown(awards, emailsByUei, ueiJoined);

    // ?recentMonths=N -> which members won a NEW award (first action) in the last N months.
    const recentMonths = Number(req.nextUrl.searchParams.get('recentMonths') || 0);
    const recent = Number.isFinite(recentMonths) && recentMonths > 0 ? recentWinners(awards, emailsByUei, recentMonths) : undefined;
    const last12 = recentWinners(awards, emailsByUei, 12);
    const unknownJoin = ueis.filter((u) => !Number.isFinite(ueiJoined.get(u) as number)).length;

    const report = {
      success: true,
      coverage: {
        vaultProfiles: profiles.length,
        profilesWithValidUei: withUei,
        distinctCompanies: ueis.length,
        companiesWithUnknownJoinDate: unknownJoin,
        note: 'Only members who saved a valid SAM UEI in their Company Vault can be counted.',
      },
      lifetime: tallyWins(awards),
      last12Months: { companiesWithWins: last12.companiesWithWins, contracts: last12.contracts, dollars: last12.dollars },
      sinceJoining: tallyWins(sinceRows),
      ...(recent ? { recentWinners: { months: recentMonths, ...recent } } : {}),
      breakdown,
      definitions: {
        contract: 'A distinct award (award_id) with positive net obligation.',
        dollars: "Sum of each award's net obligated dollars (USASpending via BigQuery).",
        sinceJoining: "Award first action on/after the member's earliest Mindy record.",
        last12Months: 'Award first action in the last 12 months.',
      },
    };
    // A browser gets a readable page; ?format=json gets the raw data.
    if (req.nextUrl.searchParams.get('format') === 'json') return NextResponse.json(report);
    return new NextResponse(renderHtml(report), {
      headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
    });
  } catch (err) {
    console.error('[member-contract-wins]', err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Failed to compute member wins' },
      { status: 502 },
    );
  }
}

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
const esc = (v: unknown) => String(v ?? '').replace(/[&<>"]/g, (c) => ESC[c]);
const usd = (n: number) =>
  n >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${Math.round(n / 1e3)}K` : `$${n}`;

type Totals = { companiesWithWins: number; contracts: number; dollars: number };

function renderHtml(r: {
  coverage: { distinctCompanies: number; profilesWithValidUei: number; vaultProfiles: number };
  lifetime: Totals; sinceJoining: Totals; last12Months: Totals; breakdown: CompanyBreakdown[];
}) {
  const top = r.breakdown[0];
  const topShare = top && r.lifetime.dollars ? Math.round((top.lifetime.dollars / r.lifetime.dollars) * 100) : 0;
  const card = (label: string, t: Totals) =>
    `<div class="card"><div class="l">${label}</div><div class="v">${usd(t.dollars)}</div>`
    + `<div class="s">${t.contracts.toLocaleString()} contracts &middot; ${t.companiesWithWins} companies</div></div>`;
  const cell = (t: { contracts: number; dollars: number }) =>
    t.contracts ? `${usd(t.dollars)}<div class="m">${t.contracts}</div>` : '&mdash;';
  const rows = r.breakdown.map((c, i) => `<tr>
    <td>${i + 1}</td><td><b>${esc(c.company || c.uei)}</b><div class="m">${esc(c.uei)}</div></td>
    <td>${c.emails.map(esc).join('<br>')}</td><td>${esc(c.joined ?? '')}</td>
    <td class="n">${cell(c.lifetime)}</td><td class="n">${cell(c.last12Months)}</td><td class="n">${cell(c.sinceJoining)}</td>
    <td>${esc(c.latestAward ?? '')}</td><td>${c.agencies.map(esc).join('<br>')}</td></tr>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Member contract wins</title>
<style>body{font:14px/1.45 Inter,system-ui,sans-serif;color:#12100E;background:#FBFAF7;margin:0;padding:28px}
h1{font:600 24px Georgia,serif;margin:0 0 4px}.sub{color:#6B6459;margin:0 0 20px}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;margin-bottom:18px}
.card{background:#fff;border:1px solid #DCD8CF;border-radius:12px;padding:14px 16px}
.l{color:#6B6459;font-size:12px;text-transform:uppercase;letter-spacing:.06em}
.v{font:600 26px Georgia,serif;margin-top:4px}.s{color:#6B6459;font-size:13px}
.note{background:#FFFAEB;border:1px solid #FEDF89;border-radius:10px;padding:10px 14px;margin-bottom:18px;color:#3A352E}
.wrap{overflow-x:auto}table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #DCD8CF}
th,td{padding:9px 10px;border-bottom:1px solid #EDEAE3;text-align:left;vertical-align:top}
th{background:#F3F0E9;font-size:12px;color:#3A352E}.n{text-align:right;white-space:nowrap}.m{color:#7A7266;font-size:12px}</style>
</head><body>
<h1>Federal contracts won by Mindy members</h1>
<p class="sub">Based on ${r.coverage.distinctCompanies} member companies with a SAM ID (${r.coverage.profilesWithValidUei} of ${r.coverage.vaultProfiles} Vault profiles). Source: USASpending.</p>
<div class="cards">${card('Lifetime', r.lifetime)}${card('Last 12 months', r.last12Months)}${card('Since joining Mindy', r.sinceJoining)}</div>
${top ? `<div class="note"><b>${esc(top.company || top.uei)}</b> is ${topShare}% of the lifetime total. Check that before quoting the lifetime number.</div>` : ''}
<div class="wrap"><table><thead><tr><th>#</th><th>Company</th><th>Member email</th><th>Joined Mindy</th><th>Lifetime</th><th>Last 12 months</th><th>Since joining</th><th>Latest award</th><th>Top agencies</th></tr></thead>
<tbody>${rows || '<tr><td colspan="9">No member company has a federal award yet.</td></tr>'}</tbody></table></div>
<p class="sub" style="margin-top:14px">Each dollar cell shows total dollars, with the number of contracts underneath. Add <code>&amp;format=json</code> for the raw data.</p>
</body></html>`;
}
