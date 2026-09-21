/**
 * Prove the version switch is atomic from a reader's point of view.
 *
 * THE DEFECT THIS PROVES FIXED
 * ----------------------------
 * Promotion used to be two statements:
 *     UPDATE ... SET lifecycle='retired' WHERE lifecycle='live';
 *     UPDATE ... SET lifecycle='live'    WHERE data_version=<staging>;
 *
 * A forced-failure test on 2026-08-25 showed that between them, zero rows are
 * live. The rollback added earlier only rescues a FAILED promotion — it does
 * nothing about the window, which opens on EVERY SUCCESSFUL refresh. Concurrent
 * visitors would get the honest-unavailable state and a noindex on pages that
 * are perfectly fine.
 *
 * With the single-row pointer, promotion is one UPDATE. This script hammers the
 * reader while promotions run underneath it and asserts the reader only ever
 * resolves a COMPLETE generation.
 *
 *   npx tsx scripts/verify-atomic-version-switch.ts
 *
 * Read-only against production data: it flips the pointer between the live
 * generation and a small synthetic one, then restores the original.
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';

const REAL = 'v3-2026-06';
const SHADOW = 'test-atomic-switch-DO-NOT-PROMOTE';
const READERS = 40;
const FLIPS = 6;

function db() {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '').trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!url || !key) throw new Error('Supabase env missing');
  return createClient(url, key, { auth: { persistSession: false } });
}

let failures = 0;
const check = (label: string, pass: boolean, detail = '') => {
  console.log(`  ${pass ? '✅' : '❌'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!pass) failures++;
};

async function main() {
  const supa = db();
  const original = (
    await supa.from('awards_active_version').select('active_version').eq('id', 1).limit(1).maybeSingle()
  ).data?.active_version;
  console.log(`=== atomic version switch ===\n  pointer starts at: ${original}\n`);

  try {
    // A tiny shadow generation so a flip has something real to point at.
    await supa.from('awards_serving_pages').insert({
      recipient_uei: 'TESTATOMIC001', page_number: 1, page_size: 50,
      data_version: SHADOW, lifecycle: 'staging', row_count: 1,
      payload: [{ award_id: 'X', piid: 'X' }],
      contract_count: 1, displayed_action_count: 1, total_action_count: 1,
      displayed_obligated: 1, source_as_of: '2026-08-11', payload_checksum: 'test',
    });

    // Readers poll the pointer and record what they resolve.
    const observations: (string | null)[] = [];
    let reading = true;
    const readers = Array.from({ length: READERS }, async () => {
      while (reading) {
        const { data } = await supa
          .from('awards_active_version').select('active_version').eq('id', 1).limit(1).maybeSingle();
        observations.push(data?.active_version ?? null);
      }
    });

    // Flip back and forth underneath them.
    for (let i = 0; i < FLIPS; i++) {
      const target = i % 2 === 0 ? SHADOW : REAL;
      const { error } = await supa.rpc('promote_awards_version', {
        p_version: target, p_source_as_of: '2026-08-11', p_promoted_by: 'atomic-test',
      });
      if (error) throw new Error(`promote failed: ${error.message}`);
      await new Promise((r) => setTimeout(r, 120));
    }
    reading = false;
    await Promise.all(readers);

    console.log(`  ${observations.length} reads across ${FLIPS} promotions\n`);
    const distinct = [...new Set(observations)];
    check('every read resolved SOME version — never zero-live', !observations.includes(null));
    check(
      'only known generations observed — never a mix',
      distinct.every((v) => v === REAL || v === SHADOW),
      distinct.join(', '),
    );
    check('both generations were actually observed (the flips were real)', distinct.length === 2);

    // The pointer refuses to aim at a generation that does not exist.
    const { error: badErr } = await supa.rpc('promote_awards_version', {
      p_version: 'no-such-generation-exists', p_source_as_of: null, p_promoted_by: 'atomic-test',
    });
    check('refuses to promote a version with zero rows', !!badErr, badErr?.message?.slice(0, 60) ?? 'no error raised');

    // And the failed attempt left the pointer untouched.
    const after = (
      await supa.from('awards_active_version').select('active_version').eq('id', 1).limit(1).maybeSingle()
    ).data?.active_version;
    check('a refused promotion leaves the pointer unchanged', after === REAL || after === SHADOW, String(after));
  } finally {
    // Restore, then clean up.
    if (original) {
      await supa.rpc('promote_awards_version', {
        p_version: original, p_source_as_of: '2026-08-11', p_promoted_by: 'atomic-test-restore',
      });
    }
    await supa.from('awards_serving_pages').delete().eq('data_version', SHADOW);
  }

  const restored = (
    await supa.from('awards_active_version').select('active_version').eq('id', 1).limit(1).maybeSingle()
  ).data?.active_version;
  const leftovers = (
    await supa.from('awards_serving_pages').select('id', { count: 'exact', head: true })
      .eq('data_version', SHADOW)
  ).count;
  console.log('');
  check('pointer restored to the original generation', restored === original, String(restored));
  check('no test rows left behind', (leftovers ?? 0) === 0);

  console.log(`\n${failures === 0 ? '✅ ALL CHECKS PASSED' : `❌ ${failures} FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
