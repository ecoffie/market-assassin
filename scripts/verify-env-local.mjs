/**
 * Fail loudly when .env.local is unusable.
 *
 * WHY THIS EXISTS: on 2026-09-05 .env.local became a SELF-REFERENCING SYMLINK
 * (.env.local -> /abs/path/to/.env.local). Every local runner does
 * `dotenv.config({ path: '.env.local' })`, and dotenv does NOT throw on an
 * unreadable path — it returns an error object almost nobody checks. So
 * `sow-catalog-drain`, `sow-embed-drain`, `db.mjs` and ~12 others silently
 * loaded ZERO variables and failed later with confusing downstream errors
 * (missing Supabase URL, "no SAM keys configured") that pointed nowhere near
 * the real cause. The file is gitignored and untracked, so git could not
 * restore it and no backup survived.
 *
 * This is the silent-failure class the repo already gates elsewhere: a missing
 * source must never read as an empty one. An unreadable env file is UNKNOWN,
 * not "no variables set".
 *
 * Run:
 *   npm run verify:env            # all families
 *   npm run verify:env -- --json  # machine-readable
 *   npm run verify:env -- --require sam,supabase
 *
 * Exit 0 = usable. 1 = broken (symlink / unreadable / empty / missing families).
 *
 * Prints only MASKED suffixes — never a full secret.
 */
import fs from 'node:fs';
import path from 'node:path';

const ENV_PATH = path.resolve(process.cwd(), '.env.local');
const args = process.argv.slice(2);
const asJson = args.includes('--json');
const reqIdx = args.indexOf('--require');
const onlyFamilies = reqIdx !== -1 && args[reqIdx + 1] ? args[reqIdx + 1].split(',').map(s => s.trim()) : null;

/** Variable families the local runners actually read. Counts are measured call sites. */
const FAMILIES = {
  supabase: {
    label: 'Supabase (133 call sites — blocks db.mjs and every drain runner)',
    required: ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'],
  },
  sam: {
    label: 'SAM shared rotation (getAllDistinctSAMKeys)',
    // The loader accepts numbered OR base; require at least one usable key.
    anyOf: ['SAM_API_KEY', 'SAM_API_KEY_1', 'SAM_API_KEY_2', 'SAM_API_KEY_BACKUP'],
  },
  sow: {
    label: 'SOW drain pool (getSowDrainKeys — falls back to the shared pool if absent)',
    anyOf: ['SOW_DRAIN_KEY', ...Array.from({ length: 10 }, (_, i) => `SOW_DRAIN_KEY_${i + 1}`)],
    optional: true,
  },
};

const mask = v => (!v ? '(empty)' : v.length <= 6 ? '***' : `...${v.slice(-6)}`);
const fail = [];
const warn = [];

// ── Structural checks: these are the ones that bit on 2026-09-05 ──
let lstat;
try {
  lstat = fs.lstatSync(ENV_PATH);
} catch {
  fail.push('.env.local DOES NOT EXIST');
}

if (lstat?.isSymbolicLink()) {
  const target = fs.readlinkSync(ENV_PATH);
  const resolved = path.resolve(path.dirname(ENV_PATH), target);
  const selfRef = resolved === ENV_PATH;
  fail.push(
    `.env.local is a SYMLINK -> ${target}` +
      (selfRef ? '  ⟵ SELF-REFERENCING (this is the 2026-09-05 breakage)' : '') +
      '\n     It must be a REAL FILE. dotenv fails silently on an unreadable path.'
  );
}

let raw = null;
if (lstat && !fail.length) {
  try {
    raw = fs.readFileSync(ENV_PATH, 'utf8');
  } catch (e) {
    fail.push(`.env.local is UNREADABLE (${e.code || e.message})`);
  }
}
if (raw !== null && raw.trim() === '') fail.push('.env.local is EMPTY (0 usable bytes)');

// ── Family checks (only when the file is structurally sound) ──
const found = {};
if (raw) {
  for (const line of raw.split('\n')) {
    const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m) found[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }

  for (const [name, spec] of Object.entries(FAMILIES)) {
    if (onlyFamilies && !onlyFamilies.includes(name)) continue;
    const bucket = spec.optional ? warn : fail;

    for (const key of spec.required || []) {
      if (!found[key]) bucket.push(`${name}: MISSING ${key} — ${spec.label}`);
    }
    if (spec.anyOf) {
      const present = spec.anyOf.filter(k => found[k]);
      if (!present.length) {
        bucket.push(`${name}: no key set (need at least one of ${spec.anyOf.slice(0, 4).join(', ')}…) — ${spec.label}`);
      }
    }
  }
}

// ── Report (masked only) ──
if (asJson) {
  const distinctSam = [...new Set(Object.entries(found).filter(([k]) => /^SAM_API_KEY/.test(k)).map(([, v]) => v))].length;
  const distinctSow = [...new Set(Object.entries(found).filter(([k]) => /^SOW_DRAIN_KEY/.test(k)).map(([, v]) => v))].length;
  console.log(JSON.stringify({ ok: !fail.length, failures: fail, warnings: warn, distinctSam, distinctSow }, null, 2));
  process.exit(fail.length ? 1 : 0);
}

console.log('── verify:env — .env.local usability ──');
if (raw) {
  const show = k => found[k] !== undefined && console.log(`  ${k.padEnd(28)} ${mask(found[k])}`);
  ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'].forEach(show);
  const sam = [...new Set(Object.entries(found).filter(([k]) => /^SAM_API_KEY/.test(k)).map(([, v]) => v))];
  const sow = [...new Set(Object.entries(found).filter(([k]) => /^SOW_DRAIN_KEY/.test(k)).map(([, v]) => v))];
  console.log(`  SAM rotation                 ${sam.length} distinct key(s)`);
  console.log(`  SOW drain pool               ${sow.length} distinct key(s)`);
}
for (const w of warn) console.log(`  ⚠  ${w}`);
if (fail.length) {
  console.error('\n✗ .env.local is NOT usable:\n');
  for (const f of fail) console.error(`  • ${f}`);
  console.error('\n  Local runners load this file via dotenv, which does NOT throw on an');
  console.error('  unreadable path — they would silently run with zero variables.\n');
  process.exit(1);
}
console.log('\n✓ .env.local is a real, readable, populated file with the required families.');
