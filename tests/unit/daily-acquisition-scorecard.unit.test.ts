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
  SOURCE_BINDINGS,
  buildDailyScorecard,
  classifyStalled,
  dailyWindows,
  lastNonemptyIngest,
  renderMarkdown,
} from '../../scripts/daily-acquisition-scorecard.mjs';

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
    expect(sam.newUnique24h.reason).toBe('column created_at does not exist');
    expect(renderMarkdown(report)).toContain('unknown — column created_at does not exist');
    expect(renderMarkdown(report)).not.toContain('new unique 24h: 0');
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
    expect(src).toContain('restGet');
    expect(src).toContain("fact(null, 'unknown'");
  });

  it('schedules weekdays, publishes the artifact and summary, and uses the existing Actions secrets', () => {
    expect(workflow).toContain("cron: '0 12 * * 1-5'");
    expect(workflow).toContain('secrets.NEXT_PUBLIC_SUPABASE_URL');
    expect(workflow).toContain('secrets.SUPABASE_SERVICE_ROLE_KEY');
    expect(workflow).toContain('daily-acquisition-scorecard');
    expect(workflow).toContain('GITHUB_STEP_SUMMARY');
    expect(workflow).toContain('actions/upload-artifact');
    expect(workflow).toContain('set +x');
    expect(workflow).not.toMatch(/^\s*pull_request:/m);
    expect(workflow).not.toMatch(/echo\s+.*SUPABASE_SERVICE_ROLE_KEY/);
    expect(workflow).not.toMatch(/echo\s+.*secrets\./);
  });

  it('the daily command does not run the seven-day scorecard', () => {
    const dir = mkdtempSync(join(tmpdir(), 'scorecard-'));
    const script = join(process.cwd(), 'scripts/daily-acquisition-scorecard.mjs');
    let code = 0;
    try {
      execFileSync(process.execPath, [script, '--out-dir', dir], {
        cwd: dir,
        env: { PATH: process.env.PATH },
      });
    } catch (err) {
      code = (err as { status?: number }).status ?? 1;
    }
    expect(code).toBe(2);
    const report = JSON.parse(readFileSync(join(dir, 'acquisition-scorecard.json'), 'utf8'));
    expect(report.label).toBe('Daily acquisition scorecard');
    expect(report.measured).toBe(false);
    expect(report.corpora[0].newUnique24h.value).toBeNull();
    const md = readFileSync(join(dir, 'acquisition-scorecard.md'), 'utf8');
    expect(md).toContain('None of them are zero.');
    expect(md).not.toMatch(/\b0\b/);
  });
});
