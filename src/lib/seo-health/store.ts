/**
 * The ONLY database access for SEO health. It reads and writes the four seo_health_*
 * tables and nothing else. guard.unit.test.ts fails if this file (or any file in the
 * job's import graph) names another table.
 *
 * Every Supabase call checks { error }: a swallowed error here would turn "could not
 * record" into "nothing was wrong".
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchAllPaged } from '@/lib/supabase/paged-read';
import type { Cursor, Outcome, Stratum, Stream, UrlCheck } from './types';

export const SEO_HEALTH_TABLES = ['seo_health_runs', 'seo_health_url_checks', 'seo_health_cursors', 'seo_health_stratum_daily'] as const;

export interface RunRecord {
  status: 'running' | 'ok' | 'partial' | 'failed';
  population?: number;
  population_hash?: string;
  crawl_planned?: number;
  crawl_done?: number;
  crawl_cursor_start?: string | null;
  crawl_cursor_end?: string | null;
  inspect_planned?: number;
  inspect_done?: number;
  inspect_cursor_start?: string | null;
  inspect_cursor_end?: string | null;
  summary?: Record<string, unknown>;
  escalations?: unknown[];
  slack_state?: 'posted' | 'failed' | 'skipped';
  error?: string | null;
  finished_at?: string;
}

export interface SeoHealthStore {
  startRun(): Promise<number>;
  updateRun(id: number, patch: RunRecord): Promise<void>;
  loadCursor(stream: Stream, stratum: Stratum): Promise<Cursor>;
  saveCursor(cursor: Cursor, runId: number): Promise<void>;
  /** Inserts checks; returns the URLs whose rows were actually written. */
  insertChecks(runId: number, checks: UrlCheck[]): Promise<Set<string>>;
  upsertStratumDaily(rows: Array<{ day: string; stratum: Stratum; clicks: number; impressions: number; pages: number }>): Promise<void>;
  crawlHistory(urls: string[], sinceIso: string): Promise<Array<{ url: string; outcome: Outcome; checked_at: string }>>;
  /** Canary outcomes of the last run that completed ok/partial before `beforeRunId`, or null. */
  previousCompletedCanaries(beforeRunId: number): Promise<Record<string, Outcome> | null>;
  previousRunSummary(beforeRunId: number): Promise<Record<string, unknown> | null>;
  inspections(sinceIso: string): Promise<Array<{ stratum: Stratum; outcome: Outcome; checked_at: string }>>;
  /** Most recent runs, newest first (watchdog). */
  latestRuns(limit: number): Promise<Array<{ id: number; status: string; started_at: string; finished_at: string | null }>>;
}

function fail(what: string, error: { message: string }): never {
  throw new Error(`seo-health store: ${what}: ${error.message}`);
}

export function createStore(db: SupabaseClient): SeoHealthStore {
  return {
    async startRun() {
      const { data, error } = await db.from('seo_health_runs').insert({ status: 'running' }).select('id').single();
      if (error) fail('startRun', error);
      return (data as { id: number }).id;
    },

    async updateRun(id, patch) {
      const { error } = await db.from('seo_health_runs').update(patch).eq('id', id);
      if (error) fail('updateRun', error);
    },

    async loadCursor(stream, stratum) {
      const { data, error } = await db.from('seo_health_cursors').select('stream, stratum, last_url, cycle').eq('stream', stream).eq('stratum', stratum).maybeSingle();
      if (error) fail('loadCursor', error);
      return (data as Cursor | null) ?? { stream, stratum, last_url: null, cycle: 0 };
    },

    async saveCursor(cursor, runId) {
      const { error } = await db
        .from('seo_health_cursors')
        .upsert({ stream: cursor.stream, stratum: cursor.stratum, last_url: cursor.last_url, cycle: cursor.cycle, updated_at: new Date().toISOString(), updated_by_run: runId }, { onConflict: 'stream,stratum' });
      if (error) fail('saveCursor', error);
    },

    async insertChecks(runId, checks) {
      const written = new Set<string>();
      for (let i = 0; i < checks.length; i += 200) {
        const chunk = checks.slice(i, i + 200);
        const { error } = await db.from('seo_health_url_checks').insert(chunk.map((c) => ({ ...c, run_id: runId })));
        if (error) fail('insertChecks', error);
        for (const c of chunk) written.add(c.url);
      }
      return written;
    },

    async upsertStratumDaily(rows) {
      if (!rows.length) return;
      const { error } = await db.from('seo_health_stratum_daily').upsert(rows.map((r) => ({ ...r, fetched_at: new Date().toISOString() })), { onConflict: 'day,stratum' });
      if (error) fail('upsertStratumDaily', error);
    },

    async crawlHistory(urls, sinceIso) {
      const out: Array<{ url: string; outcome: Outcome; checked_at: string }> = [];
      for (let i = 0; i < urls.length; i += 100) {
        const slice = urls.slice(i, i + 100);
        out.push(...(await fetchAllPaged<{ url: string; outcome: Outcome; checked_at: string }>(() =>
          db.from('seo_health_url_checks').select('url, outcome, checked_at').eq('source', 'crawl').in('url', slice).gte('checked_at', sinceIso).order('id'),
        )));
      }
      return out;
    },

    async previousCompletedCanaries(beforeRunId) {
      const { data, error } = await db
        .from('seo_health_runs')
        .select('id')
        .lt('id', beforeRunId)
        .in('status', ['ok', 'partial'])
        .order('id', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) fail('previousCompletedCanaries run', error);
      const prevId = (data as { id: number } | null)?.id;
      if (!prevId) return null;
      const rows = await fetchAllPaged<{ url: string; outcome: Outcome }>(() =>
        db.from('seo_health_url_checks').select('url, outcome').eq('run_id', prevId).eq('source', 'crawl').eq('detail->>canary', 'true').order('id'),
      );
      if (!rows.length) return null; // that run did not crawl (e.g. crawl skipped): nothing to compare
      return Object.fromEntries(rows.map((r) => [r.url, r.outcome]));
    },

    async previousRunSummary(beforeRunId) {
      const { data, error } = await db
        .from('seo_health_runs')
        .select('summary')
        .lt('id', beforeRunId)
        .in('status', ['ok', 'partial'])
        .order('id', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) fail('previousRunSummary', error);
      return (data as { summary: Record<string, unknown> } | null)?.summary ?? null;
    },

    async inspections(sinceIso) {
      return fetchAllPaged<{ stratum: Stratum; outcome: Outcome; checked_at: string }>(() =>
        db.from('seo_health_url_checks').select('stratum, outcome, checked_at').eq('source', 'inspect').gte('checked_at', sinceIso).order('id'),
      );
    },

    async latestRuns(limit) {
      const { data, error } = await db.from('seo_health_runs').select('id, status, started_at, finished_at').order('id', { ascending: false }).limit(limit);
      if (error) fail('latestRuns', error);
      return (data as Array<{ id: number; status: string; started_at: string; finished_at: string | null }>) ?? [];
    },
  };
}
