/**
 * Vehicle membership verifier — which parent IDVs belong to which contract VEHICLE, from each
 * IDV's OWN USASpending record. Read-only everywhere: Supabase SELECT + public USASpending GETs.
 * Two outputs, both checked in: the full per-parent evidence (tasks/task-order-parent-scope/
 * parent-idv-solicitations.json — every candidate, its recorded solicitation, recipient, fetch status)
 * and, via --compile, the compact membership the runtime registry reads
 * (src/data/vehicles/vehicle-parents.json). No production writes.
 *
 * Why a solicitation id, not a PIID prefix: `47QRCA…` is a GSA contracting-office code, not a
 * vehicle, and ORIGINAL OASIS holders carry `47QRAD…` PIIDs under solicitation GS00Q-13-DR-0002
 * (measured 2026-09-24: CONT_IDV_47QRAD20D1001_4732). A prefix rule would conflate the two
 * vehicles. Every holder IDV records the solicitation it was awarded under
 * (`latest_transaction_contract_data.solicitation_identifier`), which is the vehicle's identity.
 *
 * Candidates = every distinct parent IDV that appears on an ORDER in recompete_opportunities for
 * the GSA parent-agency codes (4732 FAS, 4730, 4740) — the population the parent-scoped search
 * and the Map read. A candidate whose record could not be fetched is kept as `unresolved` (never
 * dropped, never guessed): membership of an unresolved parent is UNKNOWN.
 *
 *   npx tsx scripts/verify-vehicle-parents.ts            # all candidates (resumable), then compiles
 *   npx tsx scripts/verify-vehicle-parents.ts --limit 50 # smoke
 *   npx tsx scripts/verify-vehicle-parents.ts --compile  # recompile the runtime registry from the evidence only
 */
import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { VEHICLES } from '../src/lib/vehicles/definitions';

config({ path: '.env.local', quiet: true });

const OUT = 'tasks/task-order-parent-scope/parent-idv-solicitations.json';
const COMPILED = 'src/data/vehicles/vehicle-parents.json';
const AGENCIES = ['4732', '4730', '4740'];
const CONCURRENCY = 6;

interface ParentRecord {
  parent_id: string;
  piid: string;
  agency: string;
  solicitation_identifier: string | null;
  description: string | null;
  recipient_name: string | null;
  status: 'ok' | 'not_found' | 'error';
}

const args = process.argv.slice(2);
const limitArg = args.includes('--limit') ? Number(args[args.indexOf('--limit') + 1]) : null;

async function candidates(): Promise<string[]> {
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const ids = new Set<string>();
  for (const ag of AGENCIES) {
    for (let from = 0; ; from += 1000) {
      const { data, error } = await db
        .from('recompete_opportunities')
        .select('contract_id')
        .like('contract_id', `CONT_AWD_%_${ag}`)
        .order('contract_id')
        .range(from, from + 999);
      if (error) throw new Error(`candidate read failed: ${error.message}`);
      for (const r of data ?? []) {
        const m = /^CONT_AWD_.+_[0-9A-Z]{4}_(.+)_([0-9A-Z]{4})$/i.exec(String(r.contract_id));
        if (m && m[1] !== '-NONE-') ids.add(`CONT_IDV_${m[1].toUpperCase()}_${m[2].toUpperCase()}`);
      }
      if (!data || data.length < 1000) break;
    }
  }
  return [...ids].sort();
}

async function fetchOne(parentId: string): Promise<ParentRecord> {
  const m = /^CONT_IDV_(.+)_([0-9A-Z]{4})$/.exec(parentId)!;
  const base = { parent_id: parentId, piid: m[1], agency: m[2] };
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(`https://api.usaspending.gov/api/v2/awards/${parentId}/`, { signal: AbortSignal.timeout(30_000) });
      if (res.status === 404) return { ...base, solicitation_identifier: null, description: null, recipient_name: null, status: 'not_found' };
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json();
      return {
        ...base,
        solicitation_identifier: j?.latest_transaction_contract_data?.solicitation_identifier ?? null,
        description: j?.description ?? null,
        recipient_name: j?.recipient?.recipient_name ?? null,
        status: 'ok',
      };
    } catch (e) {
      if (attempt === 3) {
        console.error(`[verify] ${parentId} failed: ${(e as Error).message}`);
        return { ...base, solicitation_identifier: null, description: null, recipient_name: null, status: 'error' };
      }
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
    }
  }
  throw new Error('unreachable');
}

/**
 * Evidence → runtime registry. A parent is a member ONLY when its own recorded solicitation is one of
 * the vehicle's published solicitations. Candidates whose record could not be read are counted as
 * unresolved (membership unknown) — never assumed in or out.
 */
function compile() {
  const ev = JSON.parse(readFileSync(OUT, 'utf8')) as { verified_at: string; source: string; candidate_population: string; candidates: number; parents: ParentRecord[] };
  const vehicles: Record<string, { members: { parent_id: string; solicitation_identifier: string; recipient_name: string | null }[] }> = {};
  for (const def of Object.values(VEHICLES)) {
    vehicles[def.key] = {
      members: ev.parents
        .filter((r) => r.status === 'ok' && r.solicitation_identifier && def.solicitations[r.solicitation_identifier.trim().toUpperCase()])
        .map((r) => ({ parent_id: r.parent_id, solicitation_identifier: r.solicitation_identifier!.trim().toUpperCase(), recipient_name: r.recipient_name }))
        .sort((a, b) => a.parent_id.localeCompare(b.parent_id)),
    };
  }
  const out = {
    verified_at: ev.verified_at, source: ev.source, candidate_population: ev.candidate_population, candidates: ev.candidates,
    unresolved_candidates: ev.parents.filter((r) => r.status !== 'ok').length + Math.max(0, ev.candidates - ev.parents.length),
    vehicles,
  };
  mkdirSync(dirname(COMPILED), { recursive: true });
  writeFileSync(COMPILED, JSON.stringify(out, null, 1) + '\n');
  for (const [k, v] of Object.entries(vehicles)) console.error(`[compile] ${k}: ${v.members.length} verified parent IDVs`);
  console.error(`[compile] unresolved candidates: ${out.unresolved_candidates} of ${out.candidates}`);
}

async function main() {
  if (args.includes('--compile')) { compile(); return; }
  const prior: Record<string, ParentRecord> = {};
  if (existsSync(OUT)) {
    for (const r of JSON.parse(readFileSync(OUT, 'utf8')).parents as ParentRecord[]) if (r.status === 'ok' || r.status === 'not_found') prior[r.parent_id] = r;
  }
  let ids = await candidates();
  console.error(`[verify] ${ids.length} candidate parent IDVs (agencies ${AGENCIES.join(',')}); ${Object.keys(prior).length} already verified`);
  if (limitArg) ids = ids.slice(0, limitArg);
  const todo = ids.filter((id) => !prior[id]);
  const out: Record<string, ParentRecord> = { ...prior };
  let done = 0;
  const save = () => {
    mkdirSync(dirname(OUT), { recursive: true });
    const parents = ids.map((id) => out[id]).filter(Boolean);
    writeFileSync(OUT, JSON.stringify({
      source: 'https://api.usaspending.gov/api/v2/awards/<parent_id>/ → latest_transaction_contract_data.solicitation_identifier',
      candidate_population: `distinct parent IDVs on orders in recompete_opportunities, parent agency in (${AGENCIES.join(', ')})`,
      verified_at: new Date().toISOString(),
      candidates: ids.length,
      parents,
    }, null, 1) + '\n');
  };
  const queue = [...todo];
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (queue.length) {
      const id = queue.shift()!;
      out[id] = await fetchOne(id);
      if (++done % 200 === 0) { console.error(`[verify] ${done}/${todo.length}`); save(); }
    }
  }));
  save();
  const recs = ids.map((id) => out[id]);
  console.error(`[verify] done: ok=${recs.filter((r) => r.status === 'ok').length} not_found=${recs.filter((r) => r.status === 'not_found').length} error=${recs.filter((r) => r.status === 'error').length}`);
  if (!limitArg) compile();
}

main().catch((e) => { console.error(e); process.exit(1); });
