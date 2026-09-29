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
import type { Cursor, Outcome, Stream, UrlCheck } from './types';

export const SEO_HEALTH_TABLES = ['seo_health_runs', 'seo_health_url_checks', 'seo_health_cursors', 'seo_health_section_daily'] as const;

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
  loadCursor(stream: Stream): Promise<Cursor>;
  saveCursor(cursor: Cursor, runId: number): Promise<void>;
  /** Inserts checks; returns the URLs whose rows were actually written. */
  insertChecks(runId: number, checks: UrlCheck[]): Promise<Set<string>>;
  upsertSectionDaily(rows: Array<{ day: string; section: string; clicks: number; impressions: number; pages: number }>): Promise<void>;
  crawlHistory(urls: string[], sinceIso: string): Promise<Array<{ url: string; outcome: Outcome; checked_at: string }>>;
  canaryHistory(runs: number): Promise<Array<Record<string, Outcome>>>;
  previousRunSummary(beforeRunId: number): Promise<Record<string, unknown> | null>;
  sectionDaily(sinceDay: string): Promise<Array<{ day: string; section: string; impressions: number }>>;
  inspections(sinceIso: string): Promise<Array<{ outcome: Outcome; checked_at: string }>>;
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

    async loadCursor(stream) {
      const { data, error } = await db.from('seo_health_cursors').select('stream, last_url, cycle').eq('stream', stream).maybeSingle();
      if (error) fail('loadCursor', error);
      return (data as Cursor | null) ?? { stream, last_url: null, cycle: 0 };
    },

    async saveCursor(cursor, runId) {
      const { error } = await db
        .from('seo_health_cursors')
        .upsert({ stream: cursor.stream, last_url: cursor.last_url, cycle: cursor.cycle, updated_at: new Date().toISOString(), updated_by_run: runId }, { onConflict: 'stream' });
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

    async upsertSectionDaily(rows) {
      if (!rows.length) return;
      const { error } = await db.from('seo_health_section_daily').upsert(rows.map((r) => ({ ...r, fetched_at: new Date().toISOString() })), { onConflict: 'day,section' });
      if (error) fail('upsertSectionDaily', error);
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

    async canaryHistory(runs) {
      const { data, error } = await db.from('seo_health_runs').select('id').neq('status', 'running').order('id', { ascending: false }).limit(runs + 1);
      if (error) fail('canaryHistory runs', error);
      const ids = ((data as Array<{ id: number }>) ?? []).map((r) => r.id);
      if (!ids.length) return [];
      const rows = await fetchAllPaged<{ run_id: number; url: string; outcome: Outcome }>(() =>
        db.from('seo_health_url_checks').select('run_id, url, outcome').in('run_id', ids).eq('source', 'crawl').eq('detail->>canary', 'true').order('id'),
      );
      const byRun = new Map<number, Record<string, Outcome>>();
      for (const r of rows) byRun.set(r.run_id, { ...(byRun.get(r.run_id) ?? {}), [r.url]: r.outcome });
      return ids.map((id) => byRun.get(id)).filter((x): x is Record<string, Outcome> => !!x).slice(0, runs);
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

    async sectionDaily(sinceDay) {
      return fetchAllPaged<{ day: string; section: string; impressions: number }>(() =>
        db.from('seo_health_section_daily').select('day, section, impressions').gte('day', sinceDay).order('day').order('section'),
      );
    },

    async inspections(sinceIso) {
      return fetchAllPaged<{ outcome: Outcome; checked_at: string }>(() =>
        db.from('seo_health_url_checks').select('outcome, checked_at').eq('source', 'inspect').gte('checked_at', sinceIso).order('id'),
      );
    },
  };
}
