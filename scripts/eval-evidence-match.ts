/**
 * Evidence-weave eval harness (Phase 5 of the Vault semantic weave).
 *
 * Runs the REAL requirement→evidence matcher against a real embedded vault and
 * asserts the grounding properties that would break the weave silently:
 *
 *   1. NO FABRICATION (hard) — every cited evidence id + label is an ACTUAL row in
 *      the matched user's vault. A citation the vault doesn't contain is the whole
 *      bug class this feature could introduce (the drafter would present invented
 *      experience as real). This is an AUTO-FAIL.
 *   2. RECALL — requirements the vault CAN support surface their expected evidence
 *      (by a label substring). Catches a threshold set too high / a broken RPC.
 *   3. HONEST GAP — requirements the vault CANNOT support are returned as gaps, not
 *      force-matched to an unrelated contract. Catches a threshold set too low.
 *   4. RERANK "why" — matched evidence carries a non-empty rationale (the cited
 *      "why this fits"), so the drafter has something to ground the citation in.
 *
 * Fixtures: scripts/eval-fixtures/evidence-match/*.json —
 *   {
 *     "name": "...",
 *     "email": "eric@govcongiants.com",         // whose embedded vault to match
 *     "requirements": [
 *       { "id": "REQ-001", "requirement": "...", "source_quote": "...",
 *         "expect_labels": ["South Street", "Longmeadow"],   // >=1 must appear (recall)
 *         "expect_gap": false }                              // or true (honest gap)
 *     ]
 *   }
 *
 * Run:  npx tsx --env-file=.env.local scripts/eval-evidence-match.ts
 * Seed: npx tsx --env-file=.env.local scripts/eval-evidence-match.ts --seed eric@govcongiants.com
 *       (writes a starter fixture from the user's real vault so expectations are grounded)
 *
 * Exit non-zero on any failure → gates predeploy. Skips green when no vault /
 * no LLM key / no fixtures (infra-absent, not a code regression).
 */
import { readFileSync, readdirSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { createClient } from '@supabase/supabase-js';
import { matchRequirementsToEvidence, type RequirementInput } from '../src/lib/proposal/evidence-match';

const FIXTURE_DIR = join(process.cwd(), 'scripts', 'eval-fixtures', 'evidence-match');

interface FixtureReq extends RequirementInput {
  expect_labels?: string[];
  expect_gap?: boolean;
}
interface Fixture {
  name: string;
  email: string;
  requirements: FixtureReq[];
}
interface Failure { fixture: string; check: string; detail: string }

const sb = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

/** Load the {id,label} of every real vault row for a user — the grounding truth set. */
async function loadVaultTruth(email: string): Promise<Map<string, string>> {
  const client = sb();
  const [pp, caps, team] = await Promise.all([
    client.from('user_past_performance').select('id, contract_title').eq('user_email', email).is('archived_at', null),
    client.from('user_capabilities_library').select('id, capability_name').eq('user_email', email).is('archived_at', null),
    client.from('user_team_members').select('id, full_name').eq('user_email', email).is('archived_at', null),
  ]);
  const m = new Map<string, string>();
  for (const r of pp.data || []) m.set(String(r.id), String(r.contract_title || ''));
  for (const r of caps.data || []) m.set(String(r.id), String(r.capability_name || ''));
  for (const r of team.data || []) m.set(String(r.id), String(r.full_name || ''));
  return m;
}

async function evalFixture(fx: Fixture): Promise<Failure[]> {
  const fails: Failure[] = [];
  const truth = await loadVaultTruth(fx.email);
  if (truth.size === 0) {
    console.log(`⏭️  ${fx.name}: ${fx.email} has an empty/unembedded vault — skipping`);
    return fails;
  }

  const reqs: RequirementInput[] = fx.requirements.map((r) => ({ id: r.id, requirement: r.requirement, source_quote: r.source_quote, section: r.section }));
  const results = await matchRequirementsToEvidence(fx.email, reqs, { useRerank: true, topN: 4 });
  const byId = new Map(results.map((r) => [r.requirementId, r]));

  for (const req of fx.requirements) {
    const res = byId.get(req.id);
    if (!res) { fails.push({ fixture: fx.name, check: 'missing-result', detail: `${req.id} produced no result` }); continue; }

    // 1. NO FABRICATION (hard) — every cited item must be a real vault row, and its
    //    label must match the vault's stored label for that id (no relabeling).
    for (const e of res.evidence) {
      if (!truth.has(e.id)) {
        fails.push({ fixture: fx.name, check: 'FABRICATION', detail: `${req.id} cited id ${e.id} ("${e.label}") which is NOT in the vault` });
      } else {
        const realLabel = truth.get(e.id)!;
        if (realLabel && e.label && realLabel.trim() !== e.label.trim()) {
          fails.push({ fixture: fx.name, check: 'FABRICATION/label', detail: `${req.id} id ${e.id} label "${e.label}" != vault "${realLabel}"` });
        }
      }
      // 4. RERANK "why" — a matched item should carry a rationale.
      if (!e.why || !e.why.trim()) {
        fails.push({ fixture: fx.name, check: 'rerank/why', detail: `${req.id} evidence "${e.label}" has no "why"` });
      }
    }

    // 3. HONEST GAP — expected-gap requirements must NOT be force-matched.
    if (req.expect_gap === true && !res.gap) {
      fails.push({ fixture: fx.name, check: 'honest-gap', detail: `${req.id} expected a GAP but matched ${res.evidence.map((e) => e.label).join(', ')}` });
    }

    // 2. RECALL — at least one expected label must appear among the matches.
    if (req.expect_labels?.length) {
      const got = res.evidence.map((e) => e.label.toLowerCase());
      const hit = req.expect_labels.some((want) => got.some((g) => g.includes(want.toLowerCase())));
      if (!hit) {
        fails.push({ fixture: fx.name, check: 'recall', detail: `${req.id} expected one of [${req.expect_labels.join(', ')}], got [${res.evidence.map((e) => e.label).join(', ')}]` });
      }
    }
  }

  const status = fails.length ? '❌' : '✅';
  const gaps = results.filter((r) => r.gap).length;
  console.log(`${status} ${fx.name}: ${results.length} reqs, ${results.length - gaps} matched, ${gaps} gap(s), failures=${fails.length}`);
  return fails;
}

/** Seed a starter fixture from a user's real vault so expectations are grounded. */
async function seedFixture(email: string) {
  const truth = await loadVaultTruth(email);
  if (truth.size === 0) { console.error(`No embedded vault rows for ${email}`); process.exit(1); }
  const labels = [...truth.values()].filter(Boolean).slice(0, 3);
  if (!existsSync(FIXTURE_DIR)) mkdirSync(FIXTURE_DIR, { recursive: true });
  const out: Fixture = {
    name: `${email.split('@')[0]}-starter`,
    email,
    requirements: [
      {
        id: 'REQ-001',
        requirement: `EDIT ME — a requirement this vault SHOULD satisfy (e.g. based on "${labels[0] || 'a real contract'}").`,
        expect_labels: labels.slice(0, 1),
        expect_gap: false,
      },
      {
        id: 'REQ-002',
        requirement: 'EDIT ME — a requirement this vault CANNOT satisfy (an unrelated domain, e.g. FedRAMP cloud hosting for a construction firm).',
        expect_gap: true,
      },
    ],
  };
  const path = join(FIXTURE_DIR, `${email.split('@')[0]}-starter.json`);
  writeFileSync(path, JSON.stringify(out, null, 2));
  console.log(`Wrote ${path}`);
  console.log('Vault labels available for expect_labels:');
  for (const l of truth.values()) if (l) console.log(`  - ${l}`);
  console.log('\nEdit the requirements + expectations, then run without --seed.');
}

(async () => {
  if (process.argv[2] === '--seed') {
    await seedFixture(process.argv[3] || 'eric@govcongiants.com');
    return;
  }
  // Skip (green) when infra is absent — this gate protects against CODE regressions,
  // not a missing embedding key / DB in a bare CI env.
  if (!process.env.OPENAI_API_KEY) { console.log('evidence-match eval: skipped (no OPENAI_API_KEY for embeddings)'); process.exit(0); }
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) { console.log('evidence-match eval: skipped (no Supabase creds)'); process.exit(0); }
  if (!existsSync(FIXTURE_DIR)) { console.log('evidence-match eval: no fixtures yet (seed one: --seed <email>)'); process.exit(0); }
  const files = readdirSync(FIXTURE_DIR).filter((f) => f.endsWith('.json'));
  if (!files.length) { console.log('evidence-match eval: no fixtures in eval-fixtures/evidence-match/'); process.exit(0); }

  const allFails: Failure[] = [];
  for (const f of files) {
    const fx: Fixture = JSON.parse(readFileSync(join(FIXTURE_DIR, f), 'utf8'));
    allFails.push(...await evalFixture(fx));
  }

  if (allFails.length) {
    console.log(`\n❌ ${allFails.length} failure(s):`);
    for (const f of allFails) console.log(`   [${f.check}] ${f.fixture}: ${f.detail}`);
    // Fabrication failures are the critical class — call them out.
    const fab = allFails.filter((f) => f.check.startsWith('FABRICATION'));
    if (fab.length) console.log(`\n🚨 ${fab.length} FABRICATION failure(s) — the matcher cited evidence not in the vault. This MUST be fixed before rollout.`);
    process.exit(1);
  }
  console.log('\n✅ evidence-match eval passed — every citation grounded in the real vault.');
})().catch((e) => { console.error(e); process.exit(1); });
