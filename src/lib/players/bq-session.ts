/**
 * Ephemeral BigQuery SESSION for previewing the Players dataset without creating a production
 * table. `CREATE TEMP TABLE _SESSION.<name>` lives only inside the session and is dropped when the
 * session is aborted (or expires). Used by `verify:oracles -- --only players --players-preview`
 * and `players:rebuild` (dry-run preview). Nothing here writes to the usaspending dataset.
 */
import { getBigQueryClient } from '@/lib/bigquery/client';

export const SESSION_PLAYERS_TABLE = '_SESSION.players_naics_recipients';

export interface BqSession {
  query<T = Record<string, unknown>>(sql: string, params?: Record<string, unknown>, maxBytes?: number): Promise<T[]>;
  close(): Promise<void>;
}

const GiB = 1024 ** 3;

export async function openBqSession(firstStatement: string, maxBytes = 20 * GiB): Promise<BqSession> {
  const bq = getBigQueryClient();
  const [job] = await bq.createQueryJob({ query: firstStatement, createSession: true, maximumBytesBilled: String(maxBytes) });
  await job.getQueryResults();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sessionId: string = (job.metadata?.statistics as any)?.sessionInfo?.sessionId;
  if (!sessionId) throw new Error('BigQuery did not return a session id');
  const props = [{ key: 'session_id', value: sessionId }];
  return {
    async query<T>(sql: string, params?: Record<string, unknown>, mb = 5 * GiB): Promise<T[]> {
      const [rows] = await bq.query({ query: sql, params, connectionProperties: props, maximumBytesBilled: String(mb) });
      return rows as T[];
    },
    async close() {
      await bq.query({ query: 'CALL BQ.ABORT_SESSION()', connectionProperties: props }).catch(() => {});
    },
  };
}

/** `CREATE OR REPLACE TABLE <target>` → `CREATE TEMP TABLE _SESSION.<...>` for the preview. */
export function asSessionTempTable(createSql: string, target: string): string {
  return createSql.replace(`CREATE OR REPLACE TABLE ${target}`, `CREATE TEMP TABLE ${SESSION_PLAYERS_TABLE}`);
}
