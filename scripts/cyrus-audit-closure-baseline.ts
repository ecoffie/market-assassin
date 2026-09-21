/**
 * Local three-tool baseline for Cyrus audit closure.
 * Live BQ/SAM against local code — NOT authenticated public MCP.
 *
 *   DOTENV_CONFIG_PATH=.env.local npx tsx -r dotenv/config scripts/cyrus-audit-closure-baseline.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { makeTier2Tools } from '../src/lib/chat/tier2-tools';
import { lookupSamEntity } from '../src/mcp/tools/sam-entity';
import { contractorAwardHistory } from '../src/mcp/tools/contractor-award-history';
import { clearAwardsWarehouseCoverageCache } from '../src/lib/awards-ingest/read-warehouse-coverage';

const UEI = 'N1N9JPDYHVC7';
const COMPANY = 'Cyrus Management Solutions';
const OUT = join(process.cwd(), 'tasks/evidence/cyrus-audit-closure-2026-09-20');

function sha(): string {
  try {
    return execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

function pick(obj: unknown, paths: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const root = obj as Record<string, unknown> | null;
  for (const p of paths) {
    let cur: unknown = root;
    for (const part of p.split('.')) {
      if (cur == null || typeof cur !== 'object') {
        cur = undefined;
        break;
      }
      cur = (cur as Record<string, unknown>)[part];
    }
    out[p] = cur ?? null;
  }
  return out;
}

async function main() {
  clearAwardsWarehouseCoverageCache();
  mkdirSync(OUT, { recursive: true });
  const startedAt = new Date().toISOString();
  const codeSha = sha();

  const tools = makeTier2Tools('cyrus-audit-closure@getmindy.ai');
  const profile = await tools.execute('get_contractor_profile', {
    company_name: COMPANY,
  });
  const sam = await lookupSamEntity({ uei: UEI });
  const historyRaw = await contractorAwardHistory({
    uei: UEI,
    award_limit: 20,
    actor: 'cyrus-audit-closure@getmindy.ai',
  });
  const historyUnknown = historyRaw as unknown;
  const histPayload =
    ((historyUnknown as { history?: Record<string, unknown> }).history as
      | Record<string, unknown>
      | undefined) ||
    (historyUnknown as Record<string, unknown>);
  const profileObj = profile as Record<string, unknown>;

  const cross = {
    identity: {
      profile_uei: (profileObj.company as { uei?: string } | undefined)?.uei ?? null,
      profile_name: (profileObj.company as { name?: string } | undefined)?.name ?? null,
      sam_uei:
        (sam as { entity?: { ueiSAM?: string; uei?: string } }).entity?.ueiSAM ??
        (sam as { entity?: { uei?: string } }).entity?.uei ??
        (sam as { uei?: string }).uei ??
        null,
      sam_has8a:
        (sam as { entity?: { has8a?: boolean } }).entity?.has8a ??
        (sam as { has8a?: boolean }).has8a ??
        null,
      sam_lookup_ok: Boolean((sam as { entity?: unknown }).entity),
      history_company: (histPayload as { contractor?: { company?: string } }).contractor?.company ?? null,
      history_match: (histPayload as { match?: unknown }).match ?? null,
    },
    scope: {
      profile_set_aside_scope: (profileObj.historical_set_asides as { scope?: unknown })?.scope ?? null,
      history_set_aside_scope: (histPayload as { historical_set_asides?: { scope?: unknown } })
        ?.historical_set_asides?.scope ?? null,
      profile_coverage_scope: (profileObj.coverage as { scope?: unknown })?.scope ?? null,
    },
    awards_counts: {
      profile_award_count: (profileObj.company as { award_count?: number })?.award_count ?? null,
      profile_counting_bases: profileObj.counting_bases ?? null,
      history_award_count: (histPayload as { summary?: { awardCount?: number } }).summary?.awardCount ?? null,
      history_counting_bases: (histPayload as { counting_bases?: unknown }).counting_bases ?? null,
    },
    freshness: {
      profile: pick(profileObj.coverage, [
        'as_of',
        'warehouse_max_action_date',
        'coverage_complete_established',
        'ingest.freshness_status',
        'freshness_note',
      ]),
      history: pick(histPayload.coverage_timestamp, [
        'last_recipient_action_date',
        'warehouse_max_action_date',
        'coverage_complete_established',
        'ingest.freshness_status',
        'freshness_note',
      ]),
    },
    set_asides: {
      profile: pick(profileObj.historical_set_asides, [
        'labels',
        'coverage',
        'scope',
        'null_first_positive_note',
        'deprecated.last_fy_by_label.status',
      ]),
      history: pick((histPayload as { historical_set_asides?: unknown }).historical_set_asides, [
        'labels',
        'coverage',
        'scope',
        'null_first_positive_note',
        'deprecated.last_fy_by_label.status',
      ]),
      profile_contributing_sample: (() => {
        const sa = profileObj.historical_set_asides as {
          labels?: string[];
          contributing_ueis_by_label?: Record<string, string[]>;
          supporting_actions_by_label?: Record<string, unknown[]>;
          first_observed_positive_action_fy_by_label?: Record<string, number | null>;
        } | undefined;
        const label = sa?.labels?.[0];
        if (!label || !sa) return null;
        return {
          label,
          contributing_ueis: sa.contributing_ueis_by_label?.[label] ?? [],
          supporting_actions: (sa.supporting_actions_by_label?.[label] ?? []).slice(0, 2),
          first_positive: sa.first_observed_positive_action_fy_by_label?.[label] ?? null,
        };
      })(),
    },
    activity: {
      profile_status: (profileObj.company as { activity_status?: string })?.activity_status ?? null,
      profile_last_positive: (profileObj.company as { last_positive_obligation_fy?: number })
        ?.last_positive_obligation_fy ?? null,
      history_status: (histPayload as { summary?: { activity_status?: string } }).summary
        ?.activity_status ?? null,
    },
    sam_certs: {
      has8a:
        (sam as { entity?: { has8a?: boolean } }).entity?.has8a ??
        (sam as { has8a?: boolean }).has8a ??
        null,
      hasWOSB:
        (sam as { entity?: { hasWOSB?: boolean } }).entity?.hasWOSB ?? null,
      lookup_status: (sam as { entity?: unknown }).entity ? 'found' : 'missing',
    },
    zero_dollar_cells: (() => {
      const series = ((histPayload as { series?: Array<{ fiscalYear: number; agencyBreakdown?: Array<Record<string, unknown>> }> }).series) || [];
      return series
        .flatMap((y) =>
          (y.agencyBreakdown || [])
            .filter((c) => Number(c.amount) === 0 && Number(c.count) > 0)
            .map((c) => ({ fy: y.fiscalYear, ...c })),
        )
        .slice(0, 8);
    })(),
  };

  const acceptance = {
    F1_freshness_three_clocks:
      Boolean(cross.freshness.history['warehouse_max_action_date']) &&
      cross.freshness.history['ingest.freshness_status'] != null &&
      cross.freshness.history['ingest.freshness_status'] !== 'unknown',
    F2_set_aside_provenance:
      Boolean(cross.set_asides.profile_contributing_sample?.contributing_ueis?.length) &&
      Boolean(cross.set_asides.profile?.scope) &&
      Boolean(cross.set_asides.history?.scope),
    F3_null_first_positive_note: Boolean(
      (profileObj.historical_set_asides as { null_first_positive_note?: string })
        ?.null_first_positive_note,
    ),
    F4_last_fy_deprecated:
      (profileObj.historical_set_asides as { deprecated?: { last_fy_by_label?: { status?: string } } })
        ?.deprecated?.last_fy_by_label?.status === 'deprecated',
    F4_zero_unused_vehicle_false: (cross.zero_dollar_cells as Array<{ unused_vehicle?: boolean }>).every(
      (c) => c.unused_vehicle === false,
    ),
    O6_counting_bases: Boolean(
      (profileObj.counting_bases as { unique_awards?: number })?.unique_awards != null,
    ),
    O8_agency_count_null: Array.isArray(profileObj.top_agencies)
      ? (profileObj.top_agencies as Array<{ count: unknown; count_unavailable?: boolean }>).every(
          (a) => a.count === null && a.count_unavailable === true,
        )
      : false,
    no_award_origin_field: !(
      profileObj.historical_set_asides &&
      Object.prototype.hasOwnProperty.call(profileObj.historical_set_asides, 'award_origin_fy_by_label')
    ),
  };

  const packet = {
    environment: 'local_code_against_live_data',
    not: 'authenticated_public_mcp',
    startedAt,
    finishedAt: new Date().toISOString(),
    codeSha,
    inputs: {
      get_contractor_profile: { company_name: COMPANY },
      lookup_sam_entity: { uei: UEI },
      get_contractor_award_history: { uei: UEI, award_limit: 20 },
    },
    acceptance,
    cross,
    raw_paths: {
      profile: '01-profile.json',
      sam: '02-sam.json',
      history: '03-history.json',
    },
  };

  writeFileSync(join(OUT, '01-profile.json'), JSON.stringify(profile, null, 2));
  writeFileSync(join(OUT, '02-sam.json'), JSON.stringify(sam, null, 2));
  writeFileSync(join(OUT, '03-history.json'), JSON.stringify(historyRaw, null, 2));
  writeFileSync(join(OUT, '04-baseline-summary.json'), JSON.stringify(packet, null, 2));
  console.log(JSON.stringify({ codeSha, startedAt, acceptance, cross_identity: cross.identity }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
