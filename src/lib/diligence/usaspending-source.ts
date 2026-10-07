/**
 * USASpending retrieval for the diligence register. Every function here FAILS CLOSED:
 * a failed job, a timeout, a page error, or a row count that does not match what the
 * source said it produced throws. A partial register is never returned as a register.
 */
import { parse } from 'csv-parse/sync';
import { unzipSync, strFromU8 } from 'fflate';
import { parseTxnRow, type DiligenceTxn } from './transactions';

const API = 'https://api.usaspending.gov/api/v2';
/** USASpending's search/download time filter cannot start earlier than this. Disclosed, not hidden. */
export const USASPENDING_EARLIEST_SEARCH_DATE = '2007-10-01';

const CONTRACT_TYPES = ['A', 'B', 'C', 'D'];
const IDV_TYPES = ['IDV_A', 'IDV_B', 'IDV_B_A', 'IDV_B_B', 'IDV_B_C', 'IDV_C', 'IDV_D', 'IDV_E'];

export interface SourceSubaward {
  prime_award_key: string;
  prime_awardee_uei: string | null;
  prime_awardee_name: string | null;
  subawardee_uei: string | null;
  subawardee_name: string | null;
  subaward_number: string | null;
  subaward_amount: number | null;
  subaward_action_date: string | null;
}

export interface TransactionDownload {
  file_name: string;
  file_url: string;
  requested_at: string;
  finished_at: string;
  source_total_rows: number;
  contract_rows: number;
  subaward_rows: number;
  transactions: DiligenceTxn[];
  subawards: SourceSubaward[];
  end_date: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Bounded retry on 5xx / network errors only. After the last attempt it throws (fail closed). */
async function postJson(url: string, body: unknown, attempts = 4): Promise<any> {
  let last = '';
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const text = await res.text();
      if (res.ok) return JSON.parse(text);
      last = `HTTP ${res.status}: ${text.replace(/\s+/g, ' ').slice(0, 200)}`;
      if (res.status < 500) break; // a 4xx is our request, not a transient fault
    } catch (e) {
      last = e instanceof Error ? e.message : String(e);
    }
    if (i < attempts) await sleep(2000 * i);
  }
  throw new Error(`${url} -> ${last} (after retries)`);
}

/**
 * One prime-transaction download covering every contract and IDV action for the given
 * UEIs. USASpending's recipient text search also returns awards whose reported PARENT is
 * one of the UEIs; the register decides what is in scope, not this function.
 */
export async function downloadPrimeTransactions(opts: {
  ueis: string[];
  endDate: string;
  timeoutMs?: number;
}): Promise<TransactionDownload> {
  const requestedAt = new Date().toISOString();
  const job = await postJson(`${API}/download/transactions/`, {
    filters: {
      recipient_search_text: opts.ueis,
      prime_award_types: [...CONTRACT_TYPES, ...IDV_TYPES],
      time_period: [{ start_date: USASPENDING_EARLIEST_SEARCH_DATE, end_date: opts.endDate }],
    },
    file_format: 'csv',
    limit: 500000,
  });
  if (!job.status_url || !job.file_url) throw new Error(`download request returned no job: ${JSON.stringify(job).slice(0, 300)}`);

  const deadline = Date.now() + (opts.timeoutMs ?? 10 * 60_000);
  let status: any;
  for (;;) {
    const res = await fetch(job.status_url);
    status = await res.json();
    if (status.status === 'finished') break;
    if (status.status === 'failed') throw new Error(`download failed: ${status.message ?? JSON.stringify(status).slice(0, 300)}`);
    if (Date.now() > deadline) throw new Error(`download timed out in status "${status.status}"`);
    await sleep(5000);
  }

  const zipRes = await fetch(job.file_url);
  if (!zipRes.ok) throw new Error(`download file -> HTTP ${zipRes.status}`);
  const files = unzipSync(new Uint8Array(await zipRes.arrayBuffer()));
  const names = Object.keys(files);
  const contractFiles = names.filter((n) => n.startsWith('Contracts_PrimeTransactions'));
  const subFiles = names.filter((n) => n.startsWith('Contracts_Subawards'));
  if (contractFiles.length === 0) throw new Error(`download has no Contracts_PrimeTransactions file: ${names.join(', ')}`);

  const transactions: DiligenceTxn[] = [];
  for (const n of contractFiles) {
    const rows = parse(strFromU8(files[n]), { columns: true, skip_empty_lines: true }) as Record<string, string>[];
    for (const r of rows) transactions.push(parseTxnRow(r));
  }
  const subawards: SourceSubaward[] = [];
  for (const n of subFiles) {
    const rows = parse(strFromU8(files[n]), { columns: true, skip_empty_lines: true }) as Record<string, string>[];
    for (const r of rows) {
      const amt = r.subaward_amount?.trim();
      subawards.push({
        prime_award_key: r.prime_award_unique_key,
        prime_awardee_uei: r.prime_awardee_uei || null,
        prime_awardee_name: r.prime_awardee_name || null,
        subawardee_uei: r.subawardee_uei || null,
        subawardee_name: r.subawardee_name || null,
        subaward_number: r.subaward_number || null,
        subaward_amount: amt ? Number(amt) : null,
        subaward_action_date: r.subaward_action_date?.slice(0, 10) || null,
      });
    }
  }

  // Assistance files can be present and empty; every row the job reports must be accounted for.
  const otherRows = names
    .filter((n) => !contractFiles.includes(n) && !subFiles.includes(n) && n.endsWith('.csv'))
    .reduce((s, n) => s + (parse(strFromU8(files[n]), { columns: true, skip_empty_lines: true }) as unknown[]).length, 0);
  const sourceTotal = Number(status.total_rows);
  const parsed = transactions.length + subawards.length + otherRows;
  if (!Number.isFinite(sourceTotal) || parsed !== sourceTotal) {
    throw new Error(`row count mismatch: source reported ${status.total_rows}, parsed ${parsed}`);
  }

  return {
    file_name: job.file_name,
    file_url: job.file_url,
    requested_at: requestedAt,
    finished_at: new Date().toISOString(),
    source_total_rows: sourceTotal,
    contract_rows: transactions.length,
    subaward_rows: subawards.length,
    transactions,
    subawards,
    end_date: opts.endDate,
  };
}

export interface LiveAwardListing {
  generated_internal_id: string;
  award_id: string;
  group: 'contracts' | 'idvs';
  recipient_uei: string | null;
  recipient_name: string | null;
  start_date: string | null;
}

/**
 * The independent denominator: USASpending's award search for the same UEIs, every page.
 * Separate endpoint, separate index from the download, so agreement between them is evidence.
 */
export async function listAwardsLive(opts: { ueis: string[]; endDate: string }): Promise<LiveAwardListing[]> {
  const out: LiveAwardListing[] = [];
  for (const [group, codes] of [['contracts', CONTRACT_TYPES], ['idvs', IDV_TYPES]] as const) {
    for (let page = 1; ; page++) {
      if (page > 200) throw new Error('award listing exceeded 200 pages; refusing to guess');
      const j = await postJson(`${API}/search/spending_by_award/`, {
        filters: {
          recipient_search_text: opts.ueis,
          award_type_codes: codes,
          time_period: [{ start_date: USASPENDING_EARLIEST_SEARCH_DATE, end_date: opts.endDate }],
        },
        fields: ['Award ID', 'Recipient Name', 'Recipient UEI', 'Start Date', 'generated_internal_id'],
        limit: 100,
        page,
        sort: 'Award ID',
        order: 'asc',
      });
      if (!Array.isArray(j.results) || !j.page_metadata) throw new Error(`award listing page ${page} malformed`);
      for (const r of j.results) {
        if (!r.generated_internal_id) throw new Error(`award listing row without generated_internal_id on page ${page}`);
        out.push({
          generated_internal_id: r.generated_internal_id,
          award_id: r['Award ID'],
          group,
          recipient_uei: r['Recipient UEI'] ?? null,
          recipient_name: r['Recipient Name'] ?? null,
          start_date: r['Start Date'] ?? null,
        });
      }
      if (!j.page_metadata.hasNext) break;
    }
  }
  return out;
}
