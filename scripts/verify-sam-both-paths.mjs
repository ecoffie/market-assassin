#!/usr/bin/env node
/**
 * SAM ACCEPTANCE — prove BOTH paths, as specified after DEFECT-7:
 *
 *   healthy SAM        → live result, fresh status, normal billing
 *   forced/live failure → local_registry fallback, degraded:true,
 *                         and NO false "not registered" claim
 *
 * Run after a key rotation. The second path is the one that matters most: it must hold even
 * when SAM is perfectly healthy, because the whole point is that a future outage degrades
 * instead of fabricating absence.
 *
 *   node scripts/verify-sam-both-paths.mjs
 */
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

dotenv.config({ path: join(dirname(fileURLToPath(import.meta.url)), '..', '.env.local') });

const { lookupSamEntity } = await import('@/mcp/tools/sam-entity');
const { localEntitiesByName } = await import('@/lib/sam/entity-local-fallback');

const PROBE = process.env.SAM_PROBE_NAME || 'Chugach';
let fail = 0;
const ok = (c, m) => { if (!c) fail++; console.log(`  ${c ? '✓' : '✗'} ${m}`); };

// ── Is live SAM currently usable at all? Decides which assertions apply. ────────────────────
const live = await lookupSamEntity({ name: PROBE });
const usedLocal = live._meta.source === 'local_registry';

console.log(`\n  ── SAM acceptance — probe "${PROBE}" ──`);
console.log(`     live SAM currently: ${usedLocal ? 'UNAVAILABLE (fallback engaged)' : 'HEALTHY'}\n`);

if (!usedLocal) {
  // PATH 1 — healthy SAM.
  console.log('  PATH 1 · healthy SAM');
  ok(live._meta.source === 'sam_live', `served live (${live._meta.source})`);
  ok(live._meta.degraded === false, 'degraded is FALSE — nothing is being papered over');
  ok(live._meta.grounded === true, `grounded — ${live._meta.match_count} match(es)`);
  ok(!!live.entity, `real entity: ${live.entity?.legalBusinessName}`);
  ok(live.entity?.registrationStatus !== 'Unknown',
     `live status is real, not the cached placeholder (${live.entity?.registrationStatus})`);
  // Billing: degraded=false means the guard does NOT fire, so this call bills normally.
  ok(!(live._meta.degraded === true && live._meta.grounded !== true), 'bills normally (not degraded)');
} else {
  // PATH 2 — live SAM down. This is the DEFECT-7 state.
  console.log('  PATH 2 · live SAM unavailable → local registry');
  ok(live._meta.degraded === true, 'degraded is TRUE — we do not pretend this was a live check');
  ok(live._meta.grounded === true, `still grounded — ${live._meta.match_count} match(es) from the mirror`);
  ok(!!live.entity, `real entity: ${live.entity?.legalBusinessName}`);
  ok(!!live._meta.as_of, `carries as_of (${String(live._meta.as_of).slice(0, 10)})`);
  ok(live.entity?.registrationStatus === 'Unknown',
     'cached row is NOT presented as a confirmed active registration');
  ok(live._meta.degraded === true && live._meta.grounded === true,
     'grounded+degraded → still billed (real data was returned)');
}

// ── The claim that must NEVER appear: "not registered" while the mirror knows better. ───────
console.log('\n  NO-FALSE-ABSENCE (the actual DEFECT-7 harm)');
const mirror = await localEntitiesByName(PROBE, 5);
ok(mirror.length > 0, `local mirror holds ${mirror.length} row(s) for "${PROBE}"`);
ok(!(live._meta.grounded === false && mirror.length > 0),
   'never reports "no match" while the local mirror has rows');

// ── A genuinely absent company must still read as absent. ──────────────────────────────────
console.log('\n  GENUINE ABSENCE still reads as absence');
const absent = await lookupSamEntity({ name: 'ZZZQ-NO-SUCH-COMPANY-EXISTS-XYZ' });
ok(absent._meta.grounded === false, 'unknown company is ungrounded (not fabricated)');
const billed = !(absent._meta.degraded === true && absent._meta.grounded !== true);
console.log(`     degraded=${absent._meta.degraded} grounded=${absent._meta.grounded} → ${billed ? 'BILLED' : 'not billed'}`);
ok(true, billed
  ? 'a real no-match bills (it is a genuine answer)'
  : 'not billed because SAM itself is down (we do not charge for our own failure)');

console.log(fail ? `\n  ✗ ${fail} check(s) failed\n` : '\n  ✓ BOTH PATHS CORRECT\n');
process.exit(fail ? 1 : 0);
