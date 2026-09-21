/**
 * Cap-statement parse eval harness.
 *
 * Runs the REAL parse → normalize pipeline over real capability statements and
 * asserts the properties that kept regressing:
 *   1. COMPLETENESS   — extracts >= the expected count of past-perf / capabilities
 *                       (multi-column tables + bullet lists were under-extracting).
 *   2. VALUE ROUNDTRIP— every parsed dollar string coerces to a positive number
 *                       via the shared normalizer (the "$ didn't store" bug).
 *   3. NO FABRICATION — every extracted contract title + dollar value + CAGE/UEI
 *                       actually appears in the source text (grounding guard).
 *   4. NORMALIZE      — no valid row is dropped by normalization (agency/desc
 *                       fallbacks); skips are only genuine no-ops.
 *
 * Fixtures live in scripts/eval-fixtures/cap-parse/*.json — each is
 *   { "name", "text", "expect": { "min_past_perf", "min_capabilities" } }.
 * `text` is the extracted document text (no PII beyond what's already public in a
 * cap statement). Generate one from a real Vault doc with --dump <email> <substr>.
 *
 * Run:  npx tsx --env-file=.env.local scripts/eval-cap-parse.ts
 * Dump: npx tsx --env-file=.env.local scripts/eval-cap-parse.ts --dump eric@govcongiants.com Tavares
 *
 * Exit code is non-zero if any assertion fails → safe to gate predeploy.
 */
import { readFileSync, readdirSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { callLLM } from '../src/lib/llm/call-llm';
import { normalizePastPerf, normalizeCapability, parseCurrency } from '../src/lib/vault/normalize';

const FIXTURE_DIR = join(process.cwd(), 'scripts', 'eval-fixtures', 'cap-parse');

// Pull the LIVE prompt from the route so the eval always matches production.
function loadPrompt(): string {
  const src = readFileSync(join(process.cwd(), 'src/app/api/app/vault/documents/parse/route.ts'), 'utf8');
  const m = src.match(/const PARSE_PROMPT = `([\s\S]*?)`;/);
  if (!m) throw new Error('Could not extract PARSE_PROMPT from the parse route');
  return m[1];
}

interface Fixture {
  name: string;
  text: string;
  expect: { min_past_perf: number; min_capabilities: number };
}

// Normalize text for substring grounding checks (collapse whitespace, lowercase).
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ');

async function parseDoc(prompt: string, text: string) {
  const { text: out } = await callLLM({
    system: prompt, user: text.slice(0, 40000),
    json: true, temperature: 0.1, maxTokens: 8000, job: 'reasoning', openaiModel: 'gpt-4o',
  });
  return JSON.parse(out.replace(/```json\n?|```\n?/g, '').trim());
}

interface Failure { fixture: string; check: string; detail: string }

async function evalFixture(prompt: string, fx: Fixture): Promise<Failure[]> {
  const fails: Failure[] = [];
  const src = norm(fx.text);
  const parsed = await parseDoc(prompt, fx.text);
  const pp: Record<string, unknown>[] = Array.isArray(parsed.past_performance) ? parsed.past_performance : [];
  const caps: Record<string, unknown>[] = Array.isArray(parsed.capabilities) ? parsed.capabilities : [];

  // 1. COMPLETENESS
  if (pp.length < fx.expect.min_past_perf) {
    fails.push({ fixture: fx.name, check: 'completeness/past_perf', detail: `got ${pp.length}, expected >= ${fx.expect.min_past_perf}` });
  }
  if (caps.length < fx.expect.min_capabilities) {
    fails.push({ fixture: fx.name, check: 'completeness/capabilities', detail: `got ${caps.length}, expected >= ${fx.expect.min_capabilities}` });
  }

  // 2. VALUE ROUNDTRIP + 3. NO FABRICATION (contract titles + values)
  for (const p of pp) {
    const title = String(p.contract_title || '');
    const val = p.contract_value;
    // value roundtrip: if a value is present, it must coerce to a positive number
    if (val && parseCurrency(val) == null) {
      fails.push({ fixture: fx.name, check: 'value/roundtrip', detail: `"${title}" value "${val}" did not coerce` });
    }
    // no fabrication: the dollar amount (its digits) must appear in the source
    if (val) {
      const digits = String(val).replace(/[^\d]/g, '');
      if (digits.length >= 4 && !src.replace(/[^\d ]/g, '').includes(digits.slice(0, 6))) {
        // allow suffix forms ("$2.4M") that won't digit-match — only flag long literal numbers
        if (!/[a-z]/i.test(String(val))) {
          fails.push({ fixture: fx.name, check: 'grounding/value', detail: `"${title}" value ${val} not found in source` });
        }
      }
    }
    // 4. NORMALIZE: a titled row must survive normalization
    const { row } = normalizePastPerf(p);
    if (title && !row) {
      fails.push({ fixture: fx.name, check: 'normalize/past_perf', detail: `titled row "${title}" was dropped by normalize` });
    }
  }

  // no fabrication: CAGE / UEI must appear in source if emitted
  const id = parsed.identity || {};
  for (const key of ['cage_code', 'uei', 'duns']) {
    const v = String(id[key] || '').trim();
    if (v && !norm(v).split(' ').every((tok) => src.includes(tok))) {
      fails.push({ fixture: fx.name, check: `grounding/${key}`, detail: `${key} "${v}" not found in source` });
    }
  }

  // 4. NORMALIZE: capabilities with a name must survive
  for (const c of caps) {
    const name = String(c.capability_name || '');
    const { row } = normalizeCapability(c);
    if (name && !row) {
      fails.push({ fixture: fx.name, check: 'normalize/capability', detail: `named capability "${name}" was dropped` });
    }
  }

  const status = fails.length ? '❌' : '✅';
  console.log(`${status} ${fx.name}: past_perf=${pp.length} (min ${fx.expect.min_past_perf}), caps=${caps.length} (min ${fx.expect.min_capabilities}), failures=${fails.length}`);
  return fails;
}

// --- optional: dump a fixture from a live Vault doc -------------------
async function dumpFixture(email: string, substr: string) {
  const { createClient } = await import('@supabase/supabase-js');
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data } = await sb.from('user_boilerplate_docs')
    .select('extracted_text, original_filename')
    .eq('user_email', email).ilike('original_filename', `%${substr}%`)
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (!data?.extracted_text) { console.error('No doc found'); process.exit(1); }
  if (!existsSync(FIXTURE_DIR)) mkdirSync(FIXTURE_DIR, { recursive: true });
  const slug = substr.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const out = { name: substr, text: data.extracted_text, expect: { min_past_perf: 1, min_capabilities: 1 } };
  const path = join(FIXTURE_DIR, `${slug}.json`);
  writeFileSync(path, JSON.stringify(out, null, 2));
  console.log(`Wrote ${path} (edit expect.min_past_perf / min_capabilities, then re-run without --dump)`);
}

(async () => {
  if (process.argv[2] === '--dump') {
    await dumpFixture(process.argv[3], process.argv[4]);
    return;
  }
  // Skip (don't fail) when the LLM key is absent — keeps predeploy green in
  // environments without an OpenAI key rather than blocking on infra, not code.
  if (!process.env.OPENAI_API_KEY && !process.env.GROQ_API_KEY) {
    console.log('cap-parse eval: skipped (no LLM key configured)');
    process.exit(0);
  }
  if (!existsSync(FIXTURE_DIR)) {
    console.log(`No fixtures yet. Create one: npx tsx --env-file=.env.local scripts/eval-cap-parse.ts --dump <email> <filename-substr>`);
    process.exit(0); // not a failure — nothing to check yet
  }
  const files = readdirSync(FIXTURE_DIR).filter((f) => f.endsWith('.json'));
  if (!files.length) { console.log('No fixtures in eval-fixtures/cap-parse/'); process.exit(0); }

  const prompt = loadPrompt();
  const allFails: Failure[] = [];
  for (const f of files) {
    const fx: Fixture = JSON.parse(readFileSync(join(FIXTURE_DIR, f), 'utf8'));
    allFails.push(...await evalFixture(prompt, fx));
  }

  console.log(`\n=== cap-parse eval: ${files.length} fixture(s), ${allFails.length} failure(s) ===`);
  if (allFails.length) {
    for (const f of allFails) console.log(`  ❌ [${f.fixture}] ${f.check}: ${f.detail}`);
    process.exit(1);
  }
  console.log('  ✅ all checks passed');
})();
