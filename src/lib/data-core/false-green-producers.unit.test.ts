/**
 * Workstream B — parking the producers that manufacture evidence of health.
 *
 * Measured on production over 30 days (status AND http_status):
 *   snapshot-multisite-darpa  30/30 success + HTTP 200 → last wrote 2026-04-05 (168d)
 *   snapshot-multisite-nsf    30/30 success + HTTP 200 → never wrote a row
 *   snapshot-multisite-nih    advancing: 100 rows in 7d, 451 in 30d
 *
 * Exact-DDL validated in a transaction then rolled back: DARPA →
 * parked_historical, NSF → parked_never_advanced, NIH untouched and
 * running_advancing.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  getResearchProducerStatus,
  falseGreenProducers,
  isHealthyProducer,
} from './specialty-advancement';

const MIGRATION = readFileSync(
  join(process.cwd(), 'supabase/migrations/20260921_park_false_green_producers.sql'),
  'utf8',
);
const SQL = MIGRATION.replace(/--.*$/gm, '');

const ROWS = [
  { source: 'nih_reporter', job_name: 'snapshot-multisite-nih', job_enabled: true, rows_held: 1416, last_scraped_at: '2026-09-14T04:00:29Z', days_since_scrape: 7, producer_state: 'running_advancing' },
  { source: 'darpa_baa', job_name: 'snapshot-multisite-darpa', job_enabled: false, rows_held: 6, last_scraped_at: '2026-04-05T12:22:04Z', days_since_scrape: 169, producer_state: 'parked_historical' },
  { source: 'nsf_sbir', job_name: 'snapshot-multisite-nsf', job_enabled: false, rows_held: 0, last_scraped_at: null, days_since_scrape: null, producer_state: 'parked_never_advanced' },
];
const db = (rows = ROWS) => ({ rpc: vi.fn(async () => ({ data: rows, error: null })) }) as never;

describe('the false-green paths cannot keep claiming health', () => {
  it('both misleading producers are disabled by the migration', () => {
    expect(SQL).toMatch(/UPDATE public\.cron_jobs[\s\S]*?SET enabled = FALSE/);
    expect(SQL).toMatch(/'snapshot-multisite-darpa', 'snapshot-multisite-nsf'/);
  });

  it('a parked producer is never reported healthy', async () => {
    const rows = await getResearchProducerStatus(db());
    for (const r of rows.filter((x) => x.state.startsWith('parked'))) {
      expect(isHealthyProducer(r)).toBe(false);
    }
  });

  it('after parking there are NO false-green producers left', async () => {
    expect(falseGreenProducers(await getResearchProducerStatus(db()))).toHaveLength(0);
  });

  it('a still-scheduled non-advancing producer WOULD be flagged', async () => {
    const stillRunning = [{ ...ROWS[1], job_enabled: true, producer_state: 'running_not_advancing' }];
    const flagged = falseGreenProducers(await getResearchProducerStatus(db(stillRunning)));
    expect(flagged.map((f) => f.source)).toEqual(['darpa_baa']);
  });

  it('an unrecognised state degrades to the ALARMING reading, never healthy', async () => {
    const weird = [{ ...ROWS[0], producer_state: 'looks_fine' }];
    const rows = await getResearchProducerStatus(db(weird));
    expect(rows[0].state).toBe('running_never_advanced');
    expect(isHealthyProducer(rows[0])).toBe(false);
  });
});

describe('historical rows and registration survive', () => {
  it('the migration deletes nothing', () => {
    expect(SQL).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(SQL).not.toMatch(/\bDROP\s+TABLE\b/i);
    expect(SQL).not.toMatch(/\bTRUNCATE\b/i);
    expect(SQL).not.toMatch(/DELETE FROM public\.aggregated_opportunities/i);
    expect(SQL).not.toMatch(/DELETE FROM public\.data_source_instances/i);
  });

  it("DARPA's 6 rows are preserved", async () => {
    const darpa = (await getResearchProducerStatus(db())).find((r) => r.source === 'darpa_baa')!;
    expect(darpa.rowsHeld).toBe(6);
  });

  it('NSF absence stays VISIBLE rather than disappearing with the job', async () => {
    const nsf = (await getResearchProducerStatus(db())).find((r) => r.source === 'nsf_sbir');
    expect(nsf).toBeDefined();
    expect(nsf!.rowsHeld).toBe(0);
    expect(nsf!.state).toBe('parked_never_advanced');
  });
});

describe('control-plane state stays truthful', () => {
  it('NSF is unmeasured, NOT stale — stale would imply it once worked', () => {
    expect(SQL).toMatch(/SET source_state\s+= 'unmeasured'[\s\S]*?source_key = 'research_nsf_sbir'/);
    expect(SQL).not.toMatch(/SET source_state\s+= 'content_stale'[\s\S]*?source_key = 'research_nsf_sbir'/);
  });

  it('DARPA is unreachable, not routine lag, and not CLOSED/current', () => {
    expect(SQL).toMatch(/SET source_state\s+= 'unreachable'[\s\S]*?source_key = 'research_darpa_baa'/);
    expect(SQL).not.toMatch(/source_state\s+= 'current'/);
  });

  it('both are intervention_state blocked — parked pending a decision', () => {
    expect(SQL.match(/intervention_state = 'blocked'/g) ?? []).toHaveLength(2);
  });
});

describe('NIH, DIBBS and Grants are NOT swept in', () => {
  it('NIH is classified by data movement and stays enabled', async () => {
    const nih = (await getResearchProducerStatus(db())).find((r) => r.source === 'nih_reporter')!;
    expect(nih.jobEnabled).toBe(true);
    expect(nih.state).toBe('running_advancing');
    expect(isHealthyProducer(nih)).toBe(true);
  });

  it('the migration never disables NIH, DIBBS or Grants', () => {
    expect(SQL).not.toMatch(/snapshot-multisite-nih[^)]*enabled = FALSE/);
    expect(SQL).not.toContain('sync-dibbs');
    expect(SQL).not.toContain('sync-grants');
  });

  it('no SBIR expansion occurred', () => {
    expect(SQL).not.toMatch(/INSERT INTO public\.aggregated_opportunities/i);
    expect(SQL).not.toMatch(/sbir\.gov/i);
  });
});
