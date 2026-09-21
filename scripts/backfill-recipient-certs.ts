/**
 * Backfill recipient_certifications from SAM.gov (Eric 2026-07-28).
 *
 * Populates the UEI → real SBA cert cache the map reads, so company set-aside chips are AUTHORITATIVE
 * (SAM's actual certifications) instead of inferred from award behavior — the SAIC mislabel fix.
 *
 * SAM's entity API is rate-limited (~10/min on the standard key), so this drains a bounded batch per
 * run at a deliberate pace. Resumable: it refreshes the LEAST-recently-checked (or never-checked)
 * UEIs first, so re-running continues where it left off and old rows re-refresh on a cadence.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/backfill-recipient-certs.ts --dry            # show the queue, no writes
 *   npx tsx --env-file=.env.local scripts/backfill-recipient-certs.ts --limit 50 --go  # refresh 50 UEIs
 *   npx tsx --env-file=.env.local scripts/backfill-recipient-certs.ts --uei X --go     # one UEI (test)
 *
 * Seeds the queue from the company recipients that actually appear on the map (top firms by $).
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { refreshCertForUei } from '../src/lib/sam/recipient-certs';

const args = process.argv.slice(2);
const flag = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const GO = args.includes('--go');
const LIMIT = Number(flag('--limit') || 50);
const ONE_UEI = flag('--uei');
const RATE_MS = Number(flag('--rateMs') || 6500); // ~9/min — safely under SAM's 10/min

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function ueiQueue(limit: number): Promise<string[]> {
  if (ONE_UEI) return [ONE_UEI];
  // Company UEIs that show on the map: pull distinct recipient UEIs from the recipients rollup.
  // (The map ranks by $, so the biggest firms — the ones a wrong chip most misrepresents — get
  // seeded first.) Cap generously; the cadence, not this cap, bounds SAM calls.
  const { data: recips, error } = await sb
    .from('recipients')
    .select('uei')
    .not('uei', 'is', null)
    .order('total_obligated', { ascending: false })
    .limit(2000);
  if (error) { console.error('recipient seed read failed:', error.message); return []; }
  const seedUeis = [...new Set((recips || []).map((r) => r.uei as string).filter(Boolean))];

  // Already-checked UEIs (skip the freshest; refresh stale ones oldest-first).
  const { data: checked, error: checkedErr } = await sb
    .from('recipient_certifications')
    .select('uei, checked_at')
    .in('uei', seedUeis);
  if (checkedErr) { console.error('checked-UEIs read failed:', checkedErr.message); return []; }
  const checkedAt = new Map((checked || []).map((r) => [r.uei as string, r.checked_at as string]));
  const STALE_DAYS = 30;
  const staleCut = new Date(Date.now() - STALE_DAYS * 86_400_000).toISOString();

  const never = seedUeis.filter((u) => !checkedAt.has(u));
  const stale = seedUeis
    .filter((u) => checkedAt.has(u) && (checkedAt.get(u)! < staleCut))
    .sort((a, b) => (checkedAt.get(a)! < checkedAt.get(b)! ? -1 : 1));
  return [...never, ...stale].slice(0, limit);
}

async function main() {
  const queue = await ueiQueue(LIMIT);
  console.log(`Queue: ${queue.length} UEI(s) to refresh (limit ${LIMIT}, rate ~${Math.round(60000 / RATE_MS)}/min).`);
  if (!GO) {
    console.log('DRY RUN — pass --go to write. First few:', queue.slice(0, 10).join(', '));
    return;
  }
  let ok = 0, miss = 0, fail = 0;
  for (let i = 0; i < queue.length; i++) {
    const uei = queue[i];
    const cert = await refreshCertForUei(uei);
    if (cert === null) fail++;
    else if (!cert.found) miss++;
    else ok++;
    if (cert) {
      const chips = [cert.is8a && '8a', cert.isSdvosb && 'SDVOSB', cert.isWosb && 'WOSB', cert.isHubzone && 'HUBZone'].filter(Boolean).join(',') || 'none';
      console.log(`  [${i + 1}/${queue.length}] ${uei}: found=${cert.found} certs=${chips}`);
    } else {
      console.log(`  [${i + 1}/${queue.length}] ${uei}: FAILED (see error above)`);
    }
    if (i < queue.length - 1) await sleep(RATE_MS);
  }
  console.log(`\nDone. certified/registered-no-cert/not-found+failed = ${ok}/${miss}/${fail}.`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
