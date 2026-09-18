/**
 * Read-only: fixture proof + fleet compare of CURRENT unordered limit(1)
 * vs CANONICAL resolver. Does not repair rows. Does not extrapolate.
 *
 *   npx tsx scripts/dry-run-canonical-solicitation.ts
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import {
  deriveSolicitationStatus,
  resolveCanonicalSolicitation,
} from '../src/lib/sam/resolve-solicitation';

const envCandidates = [
  resolve(process.cwd(), '.env.local'),
  resolve(__dirname, '../../../.env.local'),
  resolve(__dirname, '../../../../.env.local'),
  '/Users/ericcoffie/Market Assasin/market-assassin/.env.local',
];
for (const p of envCandidates) {
  if (existsSync(p)) dotenv.config({ path: p, quiet: true });
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const sb = createClient(url, key, { auth: { persistSession: false } });
const NOW = new Date('2026-09-18T18:00:00.000Z');
const AMD3 = 'f1aa309fa39040a4929d90a7d88fd091';
const SAMPLE_CAP = 40;

type CurrentRow = {
  notice_id: string;
  posted_date: string | null;
  response_deadline: string | null;
  active: boolean | null;
  archive_date: string | null;
};

async function currentReader(token: string): Promise<CurrentRow | null> {
  const { data, error } = await sb
    .from('sam_opportunities')
    .select('notice_id, posted_date, response_deadline, active, archive_date')
    .ilike('solicitation_number', token)
    .limit(1);
  if (error) throw error;
  return (data?.[0] as CurrentRow) ?? null;
}

function statusOf(row: { active: boolean | null; response_deadline: string | null; archive_date: string | null }) {
  return deriveSolicitationStatus(row, NOW);
}

async function proveFixture() {
  const cases = [
    { label: 'A. N0017426R1003', q: 'N0017426R1003' },
    { label: 'B. RFPREQ', q: 'N0017425RFPREQIHDMDept0002' },
    { label: 'F. trailing whitespace', q: '  N0017426R1003  ' },
  ];
  const out: Record<string, unknown>[] = [];
  for (const c of cases) {
    const t0 = Date.now();
    const canonical = await resolveCanonicalSolicitation(c.q, { client: sb, now: NOW });
    const ms = Date.now() - t0;
    out.push({
      label: c.label,
      queried: c.q,
      ms,
      notice_id: canonical?.notice.notice_id ?? null,
      matched_by: canonical?.matched_by ?? null,
      amendment: canonical?.amendment ?? null,
      deadline: canonical?.response_deadline ?? null,
      status: canonical?.status ?? null,
      version_count: canonical?.version_count ?? 0,
      identifiers: canonical?.identifiers ?? [],
      source: canonical?.source ?? null,
      versions: canonical?.versions.map((v) => v.notice_id) ?? [],
    });
  }
  return out;
}

async function fleetSample() {
  const { data, error } = await sb
    .from('sam_opportunities')
    .select('notice_id, solicitation_number, posted_date, response_deadline, active, archive_date, description')
    .not('solicitation_number', 'is', null)
    .gte('posted_date', '2026-06-01')
    .order('posted_date', { ascending: false })
    .limit(800);
  if (error) throw error;
  const rows = (data || []) as Array<{
    notice_id: string;
    solicitation_number: string;
    posted_date: string | null;
    response_deadline: string | null;
    active: boolean | null;
    archive_date: string | null;
    description: string | null;
  }>;

  const bySol = new Map<string, typeof rows>();
  for (const r of rows) {
    const k = r.solicitation_number;
    if (!bySol.has(k)) bySol.set(k, []);
    bySol.get(k)!.push(r);
  }
  const families = [...bySol.entries()]
    .filter(([, list]) => list.length >= 2)
    .slice(0, SAMPLE_CAP);

  const diffs = {
    sample_families: families.length,
    sample_window: 'posted_date >= 2026-06-01, first 800 rows then grouped',
    different_notice_id: 0,
    different_deadline: 0,
    different_status: 0,
    current_unresolved: 0,
    canonical_unresolved: 0,
    canonical_unresolved_ids: [] as string[],
    recovered_description_ids: [] as string[],
    examples: [] as Record<string, unknown>[],
  };

  for (const [sol, list] of families) {
    const current = await currentReader(sol);
    const canonical = await resolveCanonicalSolicitation(sol, { client: sb, now: NOW });
    if (!current) diffs.current_unresolved += 1;
    if (!canonical) {
      diffs.canonical_unresolved += 1;
      diffs.canonical_unresolved_ids.push(sol);
    }
    if (!current || !canonical) continue;
    const curStatus = statusOf(current);
    const changedId = current.notice_id !== canonical.notice.notice_id;
    const changedDl = (current.response_deadline || '') !== (canonical.response_deadline || '');
    const changedSt = curStatus !== canonical.status;
    if (changedId) diffs.different_notice_id += 1;
    if (changedDl) diffs.different_deadline += 1;
    if (changedSt) diffs.different_status += 1;
    if ((changedId || changedDl || changedSt) && diffs.examples.length < 8) {
      diffs.examples.push({
        solicitation_number: sol,
        family_size_in_sample: list.length,
        current: {
          notice_id: current.notice_id,
          posted_date: current.posted_date,
          deadline: current.response_deadline,
          status: curStatus,
        },
        canonical: {
          notice_id: canonical.notice.notice_id,
          posted_date: canonical.notice.posted_date,
          deadline: canonical.response_deadline,
          status: canonical.status,
          amendment: canonical.amendment,
          version_count: canonical.version_count,
        },
      });
    }
  }

  const recovered: string[] = [];
  for (const r of rows.slice(0, 200)) {
    const m = r.description?.match(/\bN\d{5,}[A-Z0-9]{2,}\b/);
    if (!m) continue;
    const token = m[0];
    if (token.toUpperCase() === r.solicitation_number.toUpperCase()) continue;
    if (recovered.length >= 15) break;
    const current = await currentReader(token);
    const canonical = await resolveCanonicalSolicitation(token, { client: sb, now: NOW });
    if (!current && canonical) recovered.push(token);
  }
  diffs.recovered_description_ids = [...new Set(recovered)];
  return diffs;
}

async function main() {
  const fixture = await proveFixture();
  const fleet = await fleetSample();
  const report = {
    as_of: NOW.toISOString(),
    fixture,
    fixture_pass: {
      A_resolves_despite_RFPREQ_column: fixture[0]?.notice_id === AMD3,
      B_RFPREQ_same_notice: fixture[1]?.notice_id === AMD3,
      C_amd0003: fixture[0]?.notice_id === AMD3 && fixture[0]?.amendment === 'Amendment 0003',
      D_deadline_aug27: String(fixture[0]?.deadline || '').startsWith('2026-08-27'),
      E_not_open: fixture[0]?.status !== 'open',
      F_whitespace: fixture[2]?.notice_id === AMD3,
      K_four_versions: fixture[0]?.version_count === 4,
    },
    fleet,
    note: 'Fleet counts are this sample only. Do not extrapolate to the full corpus.',
  };
  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
