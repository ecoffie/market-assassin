/**
 * Dry-run Solicitation Family v1 backfill. READ ONLY — no writes.
 *
 * Reports measured populations. Failed queries stay unknown, never zero.
 *
 *   npx tsx scripts/dry-run-solicitation-family.ts
 */
import { config } from 'dotenv';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { createClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import {
  extractConfirmedAliases,
  familyIdentityKey,
  partitionConfirmedFamily,
  type FamilyNoticeRow,
} from '../src/lib/sam/solicitation-family';

const envCandidates = [
  resolve(process.cwd(), '.env.local'),
  resolve(process.cwd(), '../../../.env.local'),
  resolve(__dirname, '../../../../.env.local'),
  '/Users/ericcoffie/Market Assasin/market-assassin/.env.local',
];
for (const p of envCandidates) {
  if (existsSync(p)) {
    config({ path: p, quiet: true });
    break;
  }
}

function unknown(label: string, err: { message?: string } | null): Record<string, unknown> {
  return { status: 'unknown', reason: err?.message || 'query failed', population: label };
}

async function sqlScalar(query: string): Promise<Record<string, unknown>> {
  const url = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;
  if (!url) {
    return unknown('sql:' + query.slice(0, 40), { message: 'DATABASE_URL not set — grouped count not established' });
  }
  const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  try {
    await client.connect();
    const res = await client.query(query);
    return { status: 'measured', row: res.rows[0] || null };
  } catch (err) {
    return unknown('sql', { message: err instanceof Error ? err.message : String(err) });
  } finally {
    await client.end().catch(() => {});
  }
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error(JSON.stringify({
      status: 'unknown',
      error: 'missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY',
    }, null, 2));
    process.exit(1);
  }
  const sb = createClient(url, key, { auth: { persistSession: false } });
  const report: Record<string, unknown> = {
    mode: 'dry-run',
    writes: false,
    measured_at: new Date().toISOString(),
  };

  const samTotal = await sb.from('sam_opportunities').select('notice_id', { count: 'exact', head: true });
  report.sam_opportunities = samTotal.error
    ? unknown('sam_opportunities', samTotal.error)
    : { count: samTotal.count, note: samTotal.count == null ? 'count null — unknown, not zero' : 'measured' };

  report.multi_notice_families = await sqlScalar(`
    SELECT COUNT(*)::int AS families_would_create,
           COALESCE(SUM(n),0)::int AS versions_attached
    FROM (
      SELECT btrim(solicitation_number) AS sol, COUNT(*)::int AS n
      FROM sam_opportunities
      WHERE solicitation_number IS NOT NULL
        AND btrim(solicitation_number) <> ''
      GROUP BY 1
      HAVING COUNT(*) > 1
    ) s
  `);

  report.amendment_families_sql = await sqlScalar(`
    SELECT COUNT(DISTINCT btrim(solicitation_number))::int AS solicitation_numbers_with_amendment_text,
           COUNT(*)::int AS notices_with_amendment_leading_description
    FROM sam_opportunities
    WHERE description ILIKE 'Amendment%'
      AND solicitation_number IS NOT NULL
      AND btrim(solicitation_number) <> ''
  `);

  report.dual_id_sql = await sqlScalar(`
    SELECT COUNT(*)::int AS notices_with_rfp_phrase,
           COUNT(DISTINCT btrim(solicitation_number)) FILTER (
             WHERE solicitation_number IS NOT NULL AND btrim(solicitation_number) <> ''
           )::int AS solicitation_numbers_with_rfp_phrase
    FROM sam_opportunities
    WHERE description ILIKE '%Request for Proposal (RFP)%'
  `);

  // FIRST PRODUCTION SCOPE ONLY — do not apply the 44,560 multi-notice
  // population. Targeted = pipeline-touched confirmed families + dual-ID
  // aliases. Lazy known-ID / pursuit save create at request time (not counted
  // as a write batch). Failed query → unknown, never zero.
  report.targeted_backfill = await sqlScalar(`
    WITH pipe AS (
      SELECT id, notice_id
      FROM user_pipeline
      WHERE notice_id IS NOT NULL
        AND COALESCE(is_archived, false) IS NOT TRUE
    ),
    matched AS (
      SELECT p.id AS pipeline_id, p.notice_id, btrim(s.solicitation_number) AS sol, s.posted_date
      FROM pipe p
      JOIN sam_opportunities s ON s.notice_id = p.notice_id
    ),
    keyed AS (
      SELECT * FROM matched WHERE sol IS NOT NULL AND sol <> ''
    ),
    current AS (
      SELECT DISTINCT ON (btrim(solicitation_number))
        btrim(solicitation_number) AS sol,
        notice_id AS current_notice_id
      FROM sam_opportunities
      WHERE btrim(solicitation_number) IN (SELECT DISTINCT sol FROM keyed)
      ORDER BY btrim(solicitation_number), posted_date DESC NULLS LAST, notice_id DESC
    ),
    versions AS (
      SELECT btrim(solicitation_number) AS sol, COUNT(*)::int AS n
      FROM sam_opportunities
      WHERE btrim(solicitation_number) IN (SELECT DISTINCT sol FROM keyed)
      GROUP BY 1
    )
    SELECT
      (SELECT COUNT(*)::int FROM pipe) AS pipeline_rows_with_notice_id,
      (SELECT COUNT(*)::int FROM matched) AS pipeline_rows_attachable,
      (SELECT COUNT(*)::int FROM pipe p
        LEFT JOIN sam_opportunities s ON s.notice_id = p.notice_id
        WHERE s.notice_id IS NULL) AS failed_unknown_lookups,
      (SELECT COUNT(*)::int FROM matched WHERE sol IS NULL OR sol = '') AS pipeline_rows_no_sol_number,
      (SELECT COUNT(DISTINCT sol)::int FROM keyed) AS families_to_create,
      (SELECT COALESCE(SUM(n), 0)::int FROM versions) AS versions_to_attach,
      (SELECT COUNT(*)::int FROM keyed k
        JOIN current c ON c.sol = k.sol
        WHERE c.current_notice_id IS DISTINCT FROM k.notice_id) AS pursuits_on_older_siblings
  `);
  if (report.targeted_backfill && typeof report.targeted_backfill === 'object' && !('status' in (report.targeted_backfill as object))) {
    (report.targeted_backfill as Record<string, unknown>).scope =
      'pipeline-touched confirmed families + confirmed dual-ID aliases; lazy known-ID/pursuit-save at request time; NOT the 44,560 multi-notice fleet';
    (report.targeted_backfill as Record<string, unknown>).would_write = false;
  }

  // Amendment-leading: description starts with Amendment. Bounded page, then
  // say truncated if we hit the cap.
  const amdPage = await sb
    .from('sam_opportunities')
    .select('notice_id,solicitation_number,title,description,posted_date,response_deadline,active,naics_code,office,department,sub_tier,attachments')
    .ilike('description', 'Amendment%')
    .not('solicitation_number', 'is', null)
    .limit(1000);
  if (amdPage.error) {
    report.amendment_leading = unknown('amendment-leading descriptions', amdPage.error);
  } else {
    const rows = (amdPage.data || []) as FamilyNoticeRow[];
    const capped = rows.length >= 1000;
    const bySol = new Map<string, number>();
    for (const r of rows) {
      const k = (r.solicitation_number || '').trim();
      if (!k) continue;
      bySol.set(k, (bySol.get(k) || 0) + 1);
    }
    report.amendment_leading = {
      sampled_rows: rows.length,
      capped,
      distinct_solicitation_numbers: bySol.size,
      note: capped
        ? 'sample hit 1000-row PostgREST cap — not a fleet total'
        : 'sample smaller than cap',
    };
  }

  // Confirmed dual-ID aliases: official RFP phrase in description.
  const rfpPage = await sb
    .from('sam_opportunities')
    .select('notice_id,solicitation_number,description,attachments,title,posted_date,response_deadline,active,naics_code,office,department,sub_tier')
    .ilike('description', '%Request for Proposal (RFP)%')
    .limit(1000);
  if (rfpPage.error) {
    report.confirmed_dual_id_aliases = unknown('RFP phrase in description', rfpPage.error);
  } else {
    const rows = (rfpPage.data || []) as FamilyNoticeRow[];
    const aliases = extractConfirmedAliases(rows).filter((id) => id.identifier_type === 'customer_rfp');
    const uniqueAlias = new Set(aliases.map((a) => a.identifier_norm));
    const sameAsSol = aliases.filter((a) =>
      rows.some((r) => (r.solicitation_number || '').trim().toUpperCase() === a.identifier_norm),
    ).length;
    report.confirmed_dual_id_aliases = {
      sampled_rows: rows.length,
      capped: rows.length >= 1000,
      customer_rfp_alias_rows: aliases.length,
      unique_customer_rfp_tokens: uniqueAlias.size,
      aliases_that_equal_a_sampled_solicitation_number: sameAsSol,
    };
  }

  // Pipeline rows on older siblings: load pipeline notice_ids (paged) then
  // compare to current-by-sol from a bounded SAM fetch of those ids.
  const pipeCount = await sb
    .from('user_pipeline')
    .select('id', { count: 'exact', head: true })
    .not('notice_id', 'is', null)
    .neq('is_archived', true);
  if (pipeCount.error) {
    report.pipeline = unknown('user_pipeline', pipeCount.error);
  } else if (pipeCount.count == null) {
    report.pipeline = unknown('user_pipeline', { message: 'count was null (unknown, not zero)' });
  } else {
    const { data: pipeRows, error: pipeErr } = await sb
      .from('user_pipeline')
      .select('id,notice_id')
      .not('notice_id', 'is', null)
      .neq('is_archived', true)
      .limit(1000);
    if (pipeErr) {
      report.pipeline = { total_with_notice: pipeCount.count, sample: unknown('pipeline sample', pipeErr) };
    } else {
      const noticeIds = [...new Set((pipeRows || []).map((r: { notice_id: string }) => r.notice_id))];
      const { data: samRows, error: samErr } = await sb
        .from('sam_opportunities')
        .select('notice_id,solicitation_number,posted_date,response_deadline,active,description,title,department,sub_tier,office,naics_code,psc_code,set_aside_description,notice_type,archive_date,ui_link,attachments')
        .in('notice_id', noticeIds.slice(0, 500));
      if (samErr) {
        report.pipeline = {
          total_with_notice: pipeCount.count,
          sampled_pipeline_rows: pipeRows?.length ?? null,
          sam_match: unknown('sam match for pipeline notices', samErr),
        };
      } else {
        const solNums = [...new Set((samRows || []).map((r: { solicitation_number?: string | null }) => r.solicitation_number).filter(Boolean))] as string[];
        const { data: siblings, error: sibErr } = solNums.length
          ? await sb
            .from('sam_opportunities')
            .select('notice_id,solicitation_number,posted_date,response_deadline,active,description,title,department,sub_tier,office,naics_code,psc_code,set_aside_description,notice_type,archive_date,ui_link,attachments')
            .in('solicitation_number', solNums.slice(0, 200))
            .limit(1000)
          : { data: samRows, error: null };
        if (sibErr) {
          report.pipeline = {
            total_with_notice: pipeCount.count,
            sam_siblings: unknown('sibling notices', sibErr),
          };
        } else {
          const { indexFamiliesByNoticeId } = await import('../src/lib/sam/solicitation-family');
          const indexed = indexFamiliesByNoticeId((siblings || []) as FamilyNoticeRow[]);
          let attachable = 0;
          let onOlder = 0;
          for (const p of pipeRows || []) {
            const fam = indexed.get(p.notice_id);
            if (!fam) continue;
            attachable++;
            if (fam.current_notice_id !== p.notice_id) onOlder++;
          }
          report.pipeline = {
            total_with_notice: pipeCount.count,
            sampled_pipeline_rows: pipeRows?.length,
            sampled_capped: (pipeRows?.length || 0) >= 1000,
            pursuits_attachable_in_sample: attachable,
            pursuits_on_older_versions_in_sample: onOlder,
          };
        }
      }
    }
  }

  // MASA gold fixture proof (read-only).
  const masaIds = [
    'ce85c48dc296497eb902a0a73ac45680',
    'd85b93617ae54e8e9b05b7e7a23ffe61',
    '8ca5ef19cc974f288722a8d5913cda5c',
    'f1aa309fa39040a4929d90a7d88fd091',
  ];
  const { data: masaRows, error: masaErr } = await sb
    .from('sam_opportunities')
    .select('notice_id,solicitation_number,title,description,posted_date,response_deadline,active,archive_date,naics_code,office,department,sub_tier,psc_code,set_aside_description,notice_type,ui_link,attachments,points_of_contact')
    .in('notice_id', masaIds);
  if (masaErr) {
    report.masa = unknown('MASA fixture', masaErr);
  } else {
    const rows = (masaRows || []) as FamilyNoticeRow[];
    const { buildFamilyView } = await import('../src/lib/sam/solicitation-family');
    const view = buildFamilyView(rows, { query: 'N0017426R1003', now: new Date('2026-09-18T18:00:00.000Z') });
    report.masa = {
      stored_notices: rows.length,
      identity_key: view?.identity_key || null,
      current_notice_id: view?.current_notice_id || null,
      current_deadline: view?.current_deadline || null,
      current_status: view?.current_status || null,
      current_amendment: view?.current_amendment || null,
      versions: view?.versions.length ?? null,
      customer_rfp_alias: view?.identifiers.some((id) => id.identifier_norm === 'N0017426R1003') ?? false,
      documents_on_current: view?.documents.current.attachments.length ?? null,
      documents_historical_sets: view?.documents.historical.length ?? null,
    };
  }

  // False-merge sample: same DoDAAC prefix + NAICS, different solicitation_number.
  const { data: n00174, error: n00174Err } = await sb
    .from('sam_opportunities')
    .select('notice_id,solicitation_number,title,naics_code,description')
    .eq('naics_code', '332710')
    .ilike('solicitation_number', 'N00174%')
    .limit(50);
  if (n00174Err) {
    report.false_merge_sample = unknown('N00174 + 332710', n00174Err);
  } else {
    const rows = n00174 || [];
    const mixed = partitionConfirmedFamily(rows as FamilyNoticeRow[], 'N0017426R1003');
    const solSet = new Set(rows.map((r: { solicitation_number?: string | null }) => (r.solicitation_number || '').trim()).filter(Boolean));
    report.false_merge_sample = {
      sampled_n00174_332710_rows: rows.length,
      distinct_solicitation_numbers: solSet.size,
      rejected_unrelated_when_seeding_masa: mixed.rejected.length,
      accepted: mixed.accepted.length,
      titles: rows.slice(0, 8).map((r: { title?: string | null; solicitation_number?: string | null }) => ({
        sol: r.solicitation_number,
        title: r.title,
      })),
    };
  }

  report.would_write = {
    families_created: 'none — dry-run',
    versions_attached: 'none — dry-run',
    aliases_created: 'none — dry-run',
    pipeline_updates: 'none — dry-run',
  };
  report.identity_key_example = familyIdentityKey('N0017425RFPREQIHDMDept0002', masaIds[3]);
  report.ambiguous_records_rejected = report.false_merge_sample;

  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error(JSON.stringify({
    status: 'unknown',
    error: err instanceof Error ? err.message : String(err),
  }, null, 2));
  process.exit(1);
});
