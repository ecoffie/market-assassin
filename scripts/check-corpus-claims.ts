/**
 * check-corpus-claims — do the numbers we ADVERTISE still match the database?
 *
 * Eric, 2026-08-02: "we need to update our numbers in the mindy data core and
 * the locations."
 *
 * The MCP tool descriptions are not comments — they are the prompt. When
 * `get_agency_forecasts` said "~7,700 records across ~12 agencies" while the
 * table held 33,075 across 21, the model was repeating that to users as fact.
 * A stale number in a tool description is a stale number in the product's mouth.
 *
 * This is read-only and cheap. Run it after any ingest that moves a corpus
 * materially, and before quoting a figure anywhere.
 *
 *   npx tsx scripts/check-corpus-claims.ts
 *
 * Exits non-zero when a claim drifts past its tolerance, so it can gate a push
 * later if that proves useful.
 */
import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

config({ path: '.env.local', override: true });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error('Missing Supabase env'); process.exit(1); }
const db = createClient(url, key);

/** How far a published figure may drift before it is misleading. */
const TOLERANCE = 0.15;

interface Claim {
  what: string;
  file: string;
  /** The number as written in the file. */
  claimed: number;
  /** The live number it describes. */
  actual: () => Promise<number>;
}

async function countOf(table: string, filter?: (q: never) => unknown): Promise<number> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q: any = db.from(table).select('id', { count: 'exact', head: true });
  if (filter) q = filter(q as never);
  const { count, error } = await q;
  if (error) throw new Error(`${table}: ${error.message}`);
  return count ?? 0;
}

/** Pull the first number matching a pattern out of a file — the CLAIM as written. */
function claimIn(file: string, re: RegExp): number {
  const m = re.exec(readFileSync(file, 'utf8'));
  if (!m) return NaN;
  return Number(m[1].replace(/[,~]/g, ''));
}

async function main() {
  const REG = 'src/lib/mcp/tool-registry.ts';

  const claims: Claim[] = [
    {
      what: 'MCP get_agency_forecasts — record count',
      file: REG,
      claimed: claimIn(REG, /~?([\d,]+) records across \d+ agencies/),
      actual: () => countOf('agency_forecasts'),
    },
    {
      what: 'MCP get_agency_forecasts — agency count',
      file: REG,
      claimed: claimIn(REG, /records across (\d+) agencies/),
      actual: async () => {
        // count(DISTINCT) needs a scan; page it rather than trust one select.
        const seen = new Set<string>();
        for (let from = 0; ; from += 1000) {
          const { data, error } = await db.from('agency_forecasts')
            .select('source_agency').order('id').range(from, from + 999);
          if (error) throw new Error(error.message);
          if (!data?.length) break;
          for (const r of data) seen.add(String((r as { source_agency?: string }).source_agency || ''));
          if (data.length < 1000) break;
        }
        seen.delete('');
        return seen.size;
      },
    },
    {
      what: 'MCP get_agency_forecasts — rows with no place of performance',
      file: REG,
      claimed: claimIn(REG, /\(([\d,]+) of [\d,]+\) carry NO place of performance/),
      actual: () => countOf('agency_forecasts', (q) =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (q as any).is('pop_state', null)),
    },
  ];

  let bad = 0;
  console.log('\nCORPUS CLAIMS — what we advertise vs what the database holds\n');
  console.log('claim                                                    written     actual   drift');
  for (const c of claims) {
    let actual: number;
    try { actual = await c.actual(); }
    catch (e) { console.log(`${c.what.padEnd(56)}  ERROR  ${(e as Error).message}`); bad++; continue; }

    if (!Number.isFinite(c.claimed)) {
      console.log(`${c.what.padEnd(56)}  NOT FOUND in ${c.file} — the pattern moved`);
      bad++; continue;
    }
    const drift = c.claimed === 0 ? 1 : Math.abs(actual - c.claimed) / Math.max(actual, c.claimed);
    const ok = drift <= TOLERANCE;
    if (!ok) bad++;
    console.log(
      `${c.what.padEnd(56)} ${String(c.claimed).padStart(8)} ${String(actual).padStart(10)}`
      + ` ${(drift * 100).toFixed(0).padStart(5)}%  ${ok ? '✓' : '✗'}`,
    );
  }

  console.log('');
  if (bad) {
    console.log(`✗ ${bad} claim(s) drifted past ${TOLERANCE * 100}% — a tool description is the PROMPT,`);
    console.log('  so a stale number here is a stale number the model tells users as fact.');
    process.exit(1);
  }
  console.log('✓ every advertised number is within tolerance of the live corpus.');
}

main().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
