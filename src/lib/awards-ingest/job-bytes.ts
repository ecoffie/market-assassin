/**
 * Measured BigQuery cost of the ingest's identity MERGE path (locate / MERGE / guard), so the first
 * production run can be compared with the dry-run estimates in tasks/awards-merge-identity-2026-10-04.md
 * (locate 3.14 GiB · MERGE 3.86 GiB per FY · ASSERT 2.64 GiB).
 *
 * Reporting only: a failure to READ job statistics never fails the run. It prints "unmeasured",
 * never a 0 (a missing measurement is not a free query).
 */

/** Job ids are ours to choose (`bq --job_id=`), so the stats can be read back afterwards. */
export function mergeJobIds(now: Date, nonce: string): { locate: string; script: string } {
  const stamp = now.toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  const safe = nonce.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 12) || 'x';
  return { locate: `awards_merge_locate_${stamp}_${safe}`, script: `awards_merge_script_${stamp}_${safe}` };
}

export interface JobBytes {
  jobId: string;
  /** e.g. SELECT · MERGE · ASSERT · BEGIN_TRANSACTION · SCRIPT (BigQuery's statementType). */
  statementType: string | null;
  processedBytes: number | null;
  billedBytes: number | null;
  state: string | null;
  error: string | null;
}

function num(v: unknown): number | null {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Parse `bq show --format=json -j <id>` (one job resource). */
export function parseJobBytes(raw: string): JobBytes {
  const j = JSON.parse(raw) as {
    jobReference?: { jobId?: string };
    statistics?: { totalBytesProcessed?: string; query?: { statementType?: string; totalBytesProcessed?: string; totalBytesBilled?: string } };
    status?: { state?: string; errorResult?: { message?: string } };
  };
  const q = j.statistics?.query;
  return {
    jobId: j.jobReference?.jobId ?? '?',
    statementType: q?.statementType ?? null,
    processedBytes: num(q?.totalBytesProcessed ?? j.statistics?.totalBytesProcessed),
    billedBytes: num(q?.totalBytesBilled),
    state: j.status?.state ?? null,
    error: j.status?.errorResult?.message ?? null,
  };
}

/** Child job ids of a multi-statement script, from `bq ls -j --parent_job_id=<id> --format=json`. */
export function parseChildJobIds(raw: string): string[] {
  const rows = JSON.parse(raw) as Array<{ jobReference?: { jobId?: string } }>;
  return (Array.isArray(rows) ? rows : []).map((r) => r.jobReference?.jobId).filter((x): x is string => !!x);
}

function gib(b: number | null): string {
  return b === null ? 'unmeasured' : `${(b / 1024 ** 3).toFixed(2)} GiB`;
}

export function formatJobBytes(label: string, s: JobBytes): string {
  return `[bytes] ${label} ${s.statementType ?? '?'} job=${s.jobId} processed=${gib(s.processedBytes)} billed=${gib(s.billedBytes)}`
    + ` state=${s.state ?? '?'}${s.error ? ` error=${JSON.stringify(s.error.slice(0, 160))}` : ''}`;
}
