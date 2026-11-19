/**
 * The daily scorecard must not invent a zero, must not count a cron success
 * or a row touch as new, and must stay on GET.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CORPORA,
  EXAMPLE_CAP,
  READ_FAILED,
  SCORECARD_BEGIN,
  SCORECARD_END,
  SOURCE_BINDINGS,
  buildDailyScorecard,
  classifyStalled,
  measureCustomerFindability,
  dailyWindows,
  lastNonemptyIngest,
  publicJson,
  publicLink,
  publicMarkdown,
  renderMarkdown,
  scrubPublicText,
} from '../../scripts/daily-acquisition-scorecard.mjs';

const SECRET_LEAK = [
  /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i,
  /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/,
  /supabase\.(co|in|net)/i,
  /Bearer\s+\S+/i,
  /postgres:\/\//i,
  /api[_-]?key\s*[=:]/i,
  /service[_-]?role/i,
  /SUPABASE_SERVICE_ROLE_KEY/,
  /sk_live_/,
];

function expectNoSecrets(text: string) {
  for (const pattern of SECRET_LEAK) expect(text).not.toMatch(pattern);
}

const NOW = new Date('2026-11-18T12:00:00.000Z');

function okRows(rows: unknown[]) {
  return { ok: true, error: null, rows, count: null };
}

function fakeIo(handlers: {
  count?: (table: string, filters: Record<string, string>) => { ok: boolean; error: string | null; rows: unknown[]; count: number | null };
  rows?: (table: string, filters: Record<string, string>) => { ok: boolean; error: string | null; rows: unknown[]; count: number | null };
} = {}) {
  const calls: { op: string; table: string; filters: Record<string, string> }[] = [];
  return {
    calls,
    async count(table: string, filters: Record<string, string>) {
      calls.push({ op: 'count', table, filters });
      return handlers.count?.(table, filters) ?? { ok: true, error: null, rows: [], count: 0 };
    },
    async rows(table: string, filters: Record<string, string>) {
      calls.push({ op: 'rows', table, filters });
      return handlers.rows?.(table, filters) ?? okRows([]);
    },
  };
}

describe('dailyWindows', () => {
  it('is a rolling 24h and 7d ending at the given instant', () => {
    const w = dailyWindows(NOW);
    expect(w.h24.end).toBe('2026-11-18T12:00:00.000Z');
    expect(w.h24.start).toBe('2026-11-17T12:00:00.000Z');
    expect(w.d7.start).toBe('2026-11-11T12:00:00.000Z');
    expect(w.d7.end).toBe(w.h24.end);
  });
});

describe('classifyStalled', () => {
  const fresh = {
    source_key: 'sam_opportunities_sam_gov',
    source_state: 'current',
    watch_cadence_days: 1,
    last_verified_ingest: '2026-11-18T00:00:00.000Z',
    last_data_advance: null,
    last_poll: '2026-11-18T11:00:00.000Z',
  };

  it('a current label with no nonempty clock is unknown, not stalled-false', () => {
    const flag = classifyStalled({ ...fresh, last_verified_ingest: null }, { now: NOW });
    expect(flag.status).toBe('unknown');
    expect(flag.value).toBeNull();
  });

  it('does not treat last_poll as the ingest', () => {
    const clock = lastNonemptyIngest({ ...fresh, last_verified_ingest: null, last_data_advance: null });
    expect(clock.status).toBe('measured');
    expect(clock.value).toBeNull();
    expect(clock.value).not.toBe(fresh.last_poll);
  });

  it('a nonempty ingest inside cadence is not stalled', () => {
    const flag = classifyStalled(fresh, { now: NOW, producerEnabled: true });
    expect(flag).toMatchObject({ status: 'measured', value: false });
  });

  it('a nonempty ingest past two cycles is stalled', () => {
    const flag = classifyStalled(
      { ...fresh, last_verified_ingest: '2026-11-15T00:00:00.000Z' },
      { now: NOW, producerEnabled: true },
    );
    expect(flag).toMatchObject({ status: 'measured', value: true });
  });

  it('content_stale is stalled even when the enabled flag could not be read', () => {
    const flag = classifyStalled(
      { ...fresh, source_state: 'content_stale' },
      { now: NOW, producerEnabled: 'unreadable' },
    );
    expect(flag).toMatchObject({ status: 'measured', value: true });
  });

  it('a disabled producer is stalled even when the last ingest is fresh', () => {
    const flag = classifyStalled(fresh, { now: NOW, producerEnabled: false });
    expect(flag).toMatchObject({ status: 'measured', value: true });
    expect(flag.reason).toMatch(/disabled/);
  });

  it('refuses a not-stalled answer when the enabled flag could not be read', () => {
    const flag = classifyStalled(fresh, { now: NOW, producerEnabled: 'unreadable' });
    expect(flag.status).toBe('unknown');
    expect(flag.value).toBeNull();
  });
});

describe('buildDailyScorecard', () => {
  it('counts created_at, not a cron success or a synced_at touch', async () => {
    const windows = dailyWindows(NOW);
    const io = fakeIo({
      rows(table) {
        if (table === 'data_source_instances') {
          return okRows([
            {
              source_key: 'sam_opportunities_sam_gov',
              name: 'SAM.gov',
              dataset_key: 'sam_opportunities',
              source_state: 'current',
              watch_cadence_days: 1,
              last_verified_ingest: '2026-11-18T00:00:00.000Z',
              last_data_advance: null,
              last_poll: '2026-11-18T11:00:00.000Z',
            },
            {
              source_key: 'dibbs_dla_flat_files',
              name: 'DIBBS',
              dataset_key: 'dibbs_rfqs',
              source_state: 'current',
              watch_cadence_days: 1,
              last_verified_ingest: '2026-11-18T00:00:00.000Z',
              last_data_advance: null,
              last_poll: '2026-11-18T11:00:00.000Z',
            },
            {
              source_key: 'forecast_navy_lrae',
              name: 'Navy LRAE',
              dataset_key: 'forecast_intelligence',
              source_state: 'content_stale',
              watch_cadence_days: 1,
              last_verified_ingest: null,
              last_data_advance: '2026-11-01T00:00:00.000Z',
              last_poll: '2026-11-18T11:00:00.000Z',
            },
          ]);
        }
        if (table === 'cron_jobs') {
          return okRows([
            { job_name: 'sync-dibbs', enabled: false },
            { job_name: 'sync-grants', enabled: true },
            { job_name: 'institute-gao-sync', enabled: true },
            { job_name: 'sync-forecasts', enabled: true },
            { job_name: 'extract-sam-events', enabled: true },
          ]);
        }
        if (table === 'cron_job_runs') {
          return okRows([{ job_name: 'sync-dibbs', started_at: '2026-11-18T08:00:00.000Z', status: 'success', http_status: 200, finished_at: '2026-11-18T08:01:00.000Z' }]);
        }
        if (table === 'agency_pain_points_db') {
          return okRows([
            { pain_point: 'Grid', agency: 'Energy', source_url: 'https://www.gao.gov/products/GAO-26-1', created_at: '2026-11-18T01:00:00.000Z' },
            { pain_point: 'two', agency: 'VA', source_url: 'https://example.test/2', created_at: '2026-11-17T01:00:00.000Z' },
            { pain_point: 'three', agency: 'DHS', source_url: 'https://example.test/3', created_at: '2026-11-16T01:00:00.000Z' },
            { pain_point: 'four', agency: 'DOJ', source_url: 'https://example.test/4', created_at: '2026-11-15T01:00:00.000Z' },
            { pain_point: 'five', agency: 'NASA', source_url: 'https://example.test/5', created_at: '2026-11-14T01:00:00.000Z' },
            { pain_point: 'six should be dropped', agency: 'GSA', source_url: 'https://example.test/6', created_at: '2026-11-13T01:00:00.000Z' },
          ]);
        }
        return okRows([]);
      },
      count(table, filters) {
        const clause = String(filters.and ?? '');
        if (table === 'sam_opportunities' && clause.includes('last_modified')) return { ok: true, error: null, rows: [], count: 2 };
        if (table === 'sam_opportunities' && clause.includes(windows.h24.start)) return { ok: true, error: null, rows: [], count: 4 };
        if (table === 'sam_opportunities') return { ok: true, error: null, rows: [], count: 11 };
        return { ok: true, error: null, rows: [], count: 0 };
      },
    });

    const report = await buildDailyScorecard(io, { now: NOW });
    const sam = report.sources.find((s) => s.sourceKey === 'sam_opportunities_sam_gov');
    expect(sam.newUnique24h).toMatchObject({ status: 'measured', value: 4, column: 'created_at' });
    expect(sam.newUnique7d).toMatchObject({ status: 'measured', value: 11, column: 'created_at' });
    expect(sam.materiallyUpdated24h).toMatchObject({ status: 'measured', value: 2, column: 'last_modified' });
    expect(sam.stalled).toMatchObject({ status: 'measured', value: false });

    const dibbs = report.sources.find((s) => s.sourceKey === 'dibbs_dla_flat_files');
    expect(dibbs.newUnique24h.status).toBe('unknown');
    expect(dibbs.newUnique24h.value).toBeNull();
    expect(dibbs.newUnique24h.reason).toMatch(/no created_at or first_seen/);
    expect(dibbs.stalled).toMatchObject({ status: 'measured', value: true });
    expect(dibbs.materiallyUpdated7d.status).toBe('unknown');

    const navy = report.sources.find((s) => s.sourceKey === 'forecast_navy_lrae');
    expect(navy.newUnique24h.status).toBe('unknown');
    expect(navy.newUnique24h.reason).toMatch(/forecasts corpus/);
    expect(navy.stalled.value).toBe(true);
    expect(navy.lastNonemptyIngest).toMatchObject({ status: 'measured', value: '2026-11-01T00:00:00.000Z', column: 'last_data_advance' });

    const forecasts = report.corpora.find((c) => c.key === 'forecasts');
    expect(forecasts.newUnique24h).toMatchObject({ status: 'measured', value: 0, column: 'created_at' });
    expect(forecasts.lastNonemptyIngest.value).toBe('2026-11-01T00:00:00.000Z');
    expect(forecasts.stalled.value).toBe(true);

    const events = report.corpora.find((c) => c.key === 'events');
    expect(events.newUnique24h.status).toBe('unknown');
    expect(events.newUnique24h.value).toBeNull();
    expect(events.newUnique24h.reason).toMatch(/extracted_at/);
    expect(report.examples.events.status).toBe('unknown');
    expect(report.examples.events.value).toBeNull();

    expect(report.examples.pain_points.value).toHaveLength(EXAMPLE_CAP);
    expect(report.examples.pain_points.value[0]).toMatchObject({
      agency: 'Energy',
      link: 'https://www.gao.gov/products/GAO-26-1',
      title: 'Grid',
    });

    const countCalls = io.calls.filter((c) => c.op === 'count');
    expect(countCalls.some((c) => c.table === 'cron_job_runs')).toBe(false);
    expect(countCalls.some((c) => c.table === 'dibbs_rfqs')).toBe(false);
    expect(countCalls.some((c) => c.table === 'sam_events')).toBe(false);
    for (const call of countCalls) {
      const encoded = JSON.stringify(call.filters);
      expect(encoded).not.toMatch(/synced_at|extracted_at|last_poll/);
    }
    const samNew = countCalls.find((c) => c.table === 'sam_opportunities' && !String(c.filters.and).includes('last_modified'));
    expect(samNew?.filters.and).toMatch(/^\(created_at\.gte\./);
    const samMaterial = countCalls.find((c) => c.table === 'sam_opportunities' && String(c.filters.and).includes('last_modified'));
    expect(samMaterial?.filters.and).toMatch(/created_at\.lt\./);
    expect(io.calls.filter((c) => c.table === 'cron_job_runs').every((c) => c.op === 'rows')).toBe(true);

    const dibbsRun = report.runHistory.find((r) => r.job === 'sync-dibbs');
    expect(dibbsRun.latest.value.status).toBe('success');
    expect(dibbs.newUnique24h.value).toBeNull();

    const md = renderMarkdown(report);
    expect(md).toContain('Energy');
    expect(md).toContain('https://www.gao.gov/products/GAO-26-1');
    expect(md).not.toContain('six should be dropped');
    expect(md).toContain('unknown — dibbs_rfqs has scraped_at');
    expect(md).not.toMatch(/new unique 24h: 0 \(scraped_at\)/);
  });

  it('a failed count is unknown, never zero', async () => {
    const io = fakeIo({
      rows(table) {
        if (table === 'data_source_instances') {
          return okRows([{
            source_key: 'sam_opportunities_sam_gov',
            name: 'SAM.gov',
            dataset_key: 'sam_opportunities',
            source_state: 'current',
            watch_cadence_days: 1,
            last_verified_ingest: '2026-11-18T00:00:00.000Z',
          }]);
        }
        return okRows([]);
      },
      count(table) {
        if (table === 'sam_opportunities') {
          return { ok: false, error: 'column created_at does not exist', rows: [], count: 0 };
        }
        return { ok: true, error: null, rows: [], count: 0 };
      },
    });
    const report = await buildDailyScorecard(io, { now: NOW, jobs: [], corpora: [] });
    const sam = report.sources[0];
    expect(sam.newUnique24h.status).toBe('unknown');
    expect(sam.newUnique24h.value).toBeNull();
    expect(sam.newUnique24h.reason).toBe(READ_FAILED);
    const published = publicMarkdown(report);
    expect(published).toContain(`unknown — ${READ_FAILED}`);
    expect(published).not.toContain('column created_at does not exist');
    expect(published).not.toContain('new unique 24h: 0');
    expectNoSecrets(published);
    expectNoSecrets(publicJson(report));
  });

  it('a failed instance read does not become an empty source list counted as zero', async () => {
    const io = fakeIo({
      rows(table) {
        if (table === 'data_source_instances') return { ok: false, error: 'relation missing', rows: [], count: null };
        return okRows([]);
      },
    });
    const report = await buildDailyScorecard(io, { now: NOW, jobs: [], corpora: CORPORA.slice(0, 1), bindings: {} });
    expect(report.instanceList.readOk).toBe(false);
    expect(report.instanceList.status).toBe('unknown');
    expect(report.instanceList.value).toBeNull();
    expect(report.sources).toEqual([]);
    expect(report.corpora[0].newUnique24h.status).toBe('measured');
  });

  it('public output keeps a government link and drops secrets, emails, and internal hosts', async () => {
    const io = fakeIo({
      rows(table) {
        if (table === 'data_source_instances') {
          return okRows([{
            source_key: 'sam_opportunities_sam_gov',
            name: 'SAM.gov buyer alice@agency.gov',
            dataset_key: 'sam_opportunities',
            source_state: 'current',
            watch_cadence_days: 1,
            last_verified_ingest: '2026-11-18T00:00:00.000Z',
          }]);
        }
        if (table === 'agency_pain_points_db') {
          return okRows([{
            pain_point: 'Grid contact bob@energy.gov and Bearer eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.sig',
            agency: 'Department of Energy',
            source_url: 'https://www.gao.gov/products/GAO-26-1?api_key=supersecret',
            created_at: '2026-11-18T01:00:00.000Z',
          }, {
            pain_point: 'internal',
            agency: 'VA',
            source_url: 'https://abcdcompany.supabase.co/rest/v1/agency_pain_points_db?apikey=sb_secret_value',
            created_at: '2026-11-18T01:00:00.000Z',
          }]);
        }
        if (table === 'cron_job_runs') {
          return { ok: false, error: 'postgres://svc:p@10.1.1.5/postgres password=hunter2', rows: [], count: null };
        }
        return okRows([]);
      },
    });
    const report = await buildDailyScorecard(io, { now: NOW, jobs: ['sync-dibbs'], corpora: CORPORA.filter((c) => c.key === 'pain_points') });
    const md = publicMarkdown(report);
    const json = publicJson(report);
    expect(publicLink('https://www.gao.gov/products/GAO-26-1?api_key=supersecret')).toBe('https://www.gao.gov/products/GAO-26-1');
    expect(publicLink('https://abcdcompany.supabase.co/rest/v1/x')).toBeNull();
    expect(publicLink('https://user:pass@www.gao.gov/x')).toBeNull();
    expect(md).toContain('https://www.gao.gov/products/GAO-26-1');
    expect(md).toContain('Department of Energy');
    expect(md).not.toContain('api_key=');
    expect(md).not.toContain('bob@energy.gov');
    expect(md).not.toContain('alice@agency.gov');
    expect(md).not.toContain('abcdcompany');
    expect(md).not.toContain('hunter2');
    expect(md).not.toContain('10.1.1.5');
    expect(json).not.toContain('eyJ');
    expectNoSecrets(md);
    expectNoSecrets(json);
    expect(scrubPublicText('see https://db.example.supabase.co/rest and sk_live_abc123')).not.toMatch(/supabase|sk_live_/);
  });

  it('customer findability reports found, not found, and a public citation from the customer reader', async () => {
    const seen: string[] = [];
    const readCustomer = async (agency: string) => {
      seen.push(agency);
      if (agency === 'Department of Energy') {
        return {
          sourced: [{
            institute_source_id: 'ig-1',
            document_number: 'OIG-26-3',
            pain_point: 'Scheduling delays (Source: OIG-26-3)',
            source_url: 'https://www.oversight.gov/report/oig-26-3?api_key=supersecret',
          }],
        };
      }
      return {
        sourced: [],
        legacy: [{ pain_point: 'Legacy only (Source: GAO-26-100001)', document_number: 'GAO-26-100001', source_url: 'https://www.gao.gov/products/GAO-26-100001' }],
      };
    };
    const io = fakeIo({
      rows(table) {
        if (table === 'agency_pain_points_db') {
          return okRows([
            { id: 'a', agency: 'Department of Energy', pain_point: 'Scheduling delays (Source: OIG-26-3)', institute_source_ids: ['ig-1'], created_at: '2026-11-18T01:00:00.000Z' },
            { id: 'b', agency: 'Department of Veterans Affairs', pain_point: 'Legacy only (Source: GAO-26-100001)', institute_source_ids: ['gao-1'], created_at: '2026-11-18T02:00:00.000Z' },
            { id: 'c', agency: 'Library of Congress', pain_point: 'not an institute pain point', institute_source_ids: ['crs-1'], created_at: '2026-11-18T03:00:00.000Z' },
          ]);
        }
        if (table === 'institute_sources') {
          return okRows([
            { id: 'ig-1', source_type: 'ig_report', document_number: 'OIG-26-3', title: 'Scheduling' },
            { id: 'gao-1', source_type: 'gao_report', document_number: 'GAO-26-100001', title: 'A GAO report' },
            { id: 'crs-1', source_type: 'crs_report', document_number: 'R12345', title: 'CRS' },
          ]);
        }
        return okRows([]);
      },
    });
    const block = await measureCustomerFindability(io, dailyWindows(NOW).h24, readCustomer, async () => ({ value: 200, status: 'measured', reason: null, column: null }));
    expect(block.status).toBe('measured');
    expect(block.checked.value).toBe(2);
    expect(block.found.value).toBe(1);
    expect(block.notFound.value).toBe(1);
    expect(block.citationPresent.value).toBe(1);
    expect(seen.sort()).toEqual(['Department of Energy', 'Department of Veterans Affairs']);
    const energy = block.rows.find((r) => r.agency === 'Department of Energy');
    expect(energy.found.value).toBe(true);
    expect(energy.citation).toBe('https://www.oversight.gov/report/oig-26-3');
    expect(energy.httpStatus.value).toBe(200);
    const va = block.rows.find((r) => r.agency === 'Department of Veterans Affairs');
    expect(va.found.value).toBe(false);
    expect(va.citation).toBeNull();
    const md = publicMarkdown({
      measured: true,
      generatedAt: NOW.toISOString(),
      windows: dailyWindows(NOW),
      sources: [],
      corpora: [],
      examples: {},
      findability: { h24: block, d7: block },
      runHistory: [],
    });
    expect(md).toContain('https://www.oversight.gov/report/oig-26-3');
    expect(md).not.toContain('api_key');
    expectNoSecrets(md);
  });

  it('a thrown customer read is unknown and is not counted as not found', async () => {
    const io = fakeIo({
      rows(table) {
        if (table === 'agency_pain_points_db') {
          return okRows([{ id: 'a', agency: 'Department of Energy', pain_point: 'Scheduling delays', institute_source_ids: ['ig-1'], created_at: '2026-11-18T01:00:00.000Z' }]);
        }
        if (table === 'institute_sources') return okRows([{ id: 'ig-1', source_type: 'ig_report', document_number: 'OIG-26-1', title: 'Scheduling' }]);
        return okRows([]);
      },
    });
    const block = await measureCustomerFindability(
      io,
      dailyWindows(NOW).h24,
      async () => { throw new Error('postgres://svc:secret@10.1.1.5/postgres Bearer eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.sigvalue'); },
    );
    expect(block.status).toBe('unknown');
    expect(block.found.status).toBe('unknown');
    expect(block.found.value).toBeNull();
    expect(block.notFound.value).toBeNull();
    expect(block.unknownRows.value).toBe(1);
    expect(JSON.stringify(block)).not.toMatch(/postgres:\/\/|10\.1\.1\.5|eyJ/);
  });

  it('a failed pain-point read does not become zero new claims', async () => {
    const block = await measureCustomerFindability(
      { rows: async () => ({ ok: false, error: 'supabase host db.abcd.supabase.co key=secret', rows: [], count: 0 }) },
      dailyWindows(NOW).h24,
      async () => ({ sourced: [] }),
    );
    expect(block.checked.value).toBeNull();
    expect(block.rows).toBeNull();
    expect(JSON.stringify(block)).not.toMatch(/supabase\.co|key=secret/);
  });

  it('the real catalog never binds extracted_at or synced_at as a new-row clock', () => {
    for (const spec of [...Object.values(SOURCE_BINDINGS), ...CORPORA]) {
      expect(spec.newColumn).not.toBe('synced_at');
      expect(spec.newColumn).not.toBe('extracted_at');
      expect(spec.newColumn).not.toBe('updated_at');
      expect(spec.materialColumn).not.toBe('synced_at');
      expect(spec.materialColumn).not.toBe('updated_at');
    }
    expect(SOURCE_BINDINGS.institute_gao.newColumn).toBe('discovered_at');
    expect(CORPORA.find((c) => c.key === 'events')?.newColumn).toBeNull();
  });
});

describe('the script and the workflow stay read-only', () => {
  const src = readFileSync(join(process.cwd(), 'scripts/daily-acquisition-scorecard.mjs'), 'utf8');
  const workflow = readFileSync(join(process.cwd(), '.github/workflows/daily-acquisition-scorecard.yml'), 'utf8');

  it('has no write method and only reaches PostgREST through the shared GET client', () => {
    expect(src).not.toMatch(/\.insert\(/);
    expect(src).not.toMatch(/\.update\(/);
    expect(src).not.toMatch(/\.delete\(/);
    expect(src).not.toMatch(/\.upsert\(/);
    expect(src).not.toMatch(/method:\s*'POST'/);
    expect(src).not.toMatch(/method:\s*'PATCH'/);
    expect(src).not.toMatch(/method:\s*'DELETE'/);
    expect(src).not.toContain("select: '*'");
    expect(src).not.toContain('SUPABASE_SERVICE_ROLE_KEY');
    expect(src).toContain('SCORECARD_READONLY_JWT');
    expect(src).toContain('getAgencySourcedIntelligence');
    expect(src).toContain('restGet');
    expect(src).toContain("fact(null, 'unknown'");
  });

  it('schedules weekdays, publishes the artifact and summary, and uses the existing Actions secrets', () => {
    expect(workflow).toContain("cron: '45 12 * * 1-5'");
    expect(workflow).toContain('8:45 AM ET');
    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).toContain('./node_modules/.bin/tsx scripts/daily-acquisition-scorecard.mjs');
    expect(workflow).toContain('contents: read');
    expect(workflow).not.toMatch(/contents:\s*write/);
    expect(workflow).not.toMatch(/pull_request:/);
    expect(workflow).not.toMatch(/pull_request_target:/);
    expect(workflow).toContain('daily-acquisition-scorecard');
    expect(workflow).toContain('GITHUB_STEP_SUMMARY');
    expect(workflow).toContain('actions/upload-artifact');
    expect(workflow).toContain('set +x');
    expect(workflow).toContain(SCORECARD_BEGIN);
    expect(workflow).not.toContain('SUPABASE_SERVICE_ROLE_KEY');
    expect(workflow).not.toMatch(/echo\s+.*secrets\./);
    expect(workflow).toContain('scorecard-readonly-check.mjs');
    const build = workflow.split('- name: Build scorecard')[1].split('- name:')[0];
    expect(build).toContain('secrets.NEXT_PUBLIC_SUPABASE_URL');
    expect(build).toContain('secrets.SCORECARD_READONLY_JWT');
    expect(workflow.replace(build, '')).not.toContain('SCORECARD_READONLY_JWT');
    expect(workflow.replace(build, '')).not.toContain('NEXT_PUBLIC_SUPABASE_URL');
  });

  it('the daily command does not run the seven-day scorecard', () => {
    const dir = mkdtempSync(join(tmpdir(), 'scorecard-'));
    const script = join(process.cwd(), 'scripts/daily-acquisition-scorecard.mjs');
    const planted = 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.sigvalue';
    const plantedService = 'service-role-planted-value';
    let code = 0;
    let stdout = '';
    try {
      stdout = execFileSync(process.execPath, [script, '--out-dir', dir], {
        cwd: dir,
        encoding: 'utf8',
        env: {
          PATH: process.env.PATH,
          SUPABASE_SERVICE_ROLE_KEY: plantedService,
          SCORECARD_READONLY_JWT: planted,
        },
      });
    } catch (err) {
      const thrown = err as { status?: number; stdout?: string };
      code = thrown.status ?? 1;
      stdout = thrown.stdout ?? '';
    }
    expect(code).toBe(2);
    expect(stdout.indexOf(SCORECARD_BEGIN)).toBeGreaterThanOrEqual(0);
    expect(stdout.indexOf(SCORECARD_END)).toBeGreaterThan(stdout.indexOf(SCORECARD_BEGIN));
    const report = JSON.parse(readFileSync(join(dir, 'acquisition-scorecard.json'), 'utf8'));
    expect(report.label).toBe('Daily acquisition scorecard');
    expect(report.measured).toBe(false);
    expect(report.corpora[0].newUnique24h.value).toBeNull();
    const md = readFileSync(join(dir, 'acquisition-scorecard.md'), 'utf8');
    expect(md).toContain('None of them are zero.');
    expect(md).not.toMatch(/\b0\b/);
    expectNoSecrets(stdout);
    expectNoSecrets(md);
    expectNoSecrets(JSON.stringify(report));
    expect(stdout).not.toContain(planted);
    expect(stdout).not.toContain(plantedService);
    expect(md).not.toContain(planted);
    expect(md).not.toContain(plantedService);
  });
});

describe('the read-only credential', () => {
  it('the migration grants select only and keeps rollback out of the applied SQL', () => {
    const sql = readFileSync(join(process.cwd(), 'supabase/migrations/20261119_scorecard_reader.sql'), 'utf8');
    const applied = sql.split('-- ROLLBACK —')[0];
    expect(applied).toContain('CREATE ROLE scorecard_reader NOLOGIN NOINHERIT');
    expect(applied).toContain('GRANT scorecard_reader TO authenticator');
    expect(applied).not.toMatch(/\bDROP\b/i);
    expect(applied).not.toMatch(/\bDELETE\b/i);
    expect(applied).not.toMatch(/\bTRUNCATE\b/i);
    expect(applied).not.toMatch(/\bUPDATE\b/i);
    expect(applied).not.toMatch(/\bINSERT\b/i);
    expect(applied).not.toMatch(/\bALTER\s+(ROLE|POLICY)\b/i);
    expect(sql).toContain('DROP ROLE IF EXISTS scorecard_reader');
    expect(applied).toContain('GRANT SELECT (created_at, last_modified)');
    expect(applied).not.toMatch(/GRANT SELECT \([^)]*\bsynced_at\b/);
    expect(applied).not.toContain('GRANT SELECT (job_name, route');
  });

  it('a permission-denied write passes and a constraint error means the key can write', async () => {
    const { classifyWriteAttempt } = await import('../../scripts/scorecard-readonly-check.mjs');
    expect(classifyWriteAttempt(401, '{"code":"42501","message":"permission denied for table data_source_instances"}').ok).toBe(true);
    expect(classifyWriteAttempt(403, 'permission denied for table data_source_instances').ok).toBe(true);
    expect(classifyWriteAttempt(400, '{"code":"23502","message":"null value in column \\"name\\""}').ok).toBe(false);
    expect(classifyWriteAttempt(401, 'new row violates row-level security policy').ok).toBe(false);
    expect(classifyWriteAttempt(201, '').ok).toBe(false);
    expect(classifyWriteAttempt(401, 'Invalid API key').ok).toBe(false);
  });
});
