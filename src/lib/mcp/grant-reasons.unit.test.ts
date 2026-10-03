/**
 * GUARD: no credit-grant reason can reach production unclassified for the ChatGPT
 * auto-recharge attribution window.
 *
 *   1. The SQL allowlist (mcp_grant_resets_chatgpt_window) == CHATGPT_WINDOW_RESET_REASONS.
 *   2. Every reason the code passes to applyCreditOnce / grantCredits / topUpToCeiling is
 *      classified in GRANT_REASONS (source scan). A new grant type therefore fails this
 *      test until someone decides reset vs no-reset.
 *   3. The grant RPCs are only called through their wrappers (so the scan sees every call).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { GRANT_REASONS, CHATGPT_WINDOW_RESET_REASONS } from './grant-reasons';

const ROOT = process.cwd();
const MIGRATION = readFileSync(join(ROOT, 'supabase/migrations/20261003_mcp_autorecharge_chatgpt_attribution.sql'), 'utf8');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|mjs|js)$/.test(name) && !/\.test\.(ts|tsx|mjs|js)$/.test(name)) out.push(p);
  }
  return out;
}

/** Wrapper name → index of its `reason` argument. */
const WRAPPERS: Record<string, number> = { applyCreditOnce: 3, grantCredits: 2, topUpToCeiling: 3 };

/** Call sites whose reason is an expression, with the reasons that expression can take. */
const DYNAMIC_SITES: Record<string, string[]> = {
  'src/lib/mcp/stripe-subscription.ts::ledgerReason': ['mcp_sub_annual', 'mcp_sub_monthly'],
  'src/lib/mcp/app-tier-subscription.ts::`app_tier_${tier}`': ['app_tier_pro', 'app_tier_team'],
  'src/app/api/cron/grant-mcp-pro-credits/route.ts::allowanceReason': ['comp_monthly', 'pro_monthly'],
};

/** Split a call's argument text on top-level commas. */
function splitArgs(s: string): string[] {
  const out: string[] = [];
  let depth = 0; let q: string | null = null; let cur = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) { cur += ch; if (ch === q && s[i - 1] !== '\\') q = null; continue; }
    if (ch === '\'' || ch === '"' || ch === '`') { q = ch; cur += ch; continue; }
    if ('([{'.includes(ch)) depth++;
    if (')]}'.includes(ch)) depth--;
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function grantCallSites(): { file: string; wrapper: string; arg: string }[] {
  const sites: { file: string; wrapper: string; arg: string }[] = [];
  for (const file of [...walk(join(ROOT, 'src')), ...walk(join(ROOT, 'scripts'))]) {
    const rel = relative(ROOT, file);
    const src = readFileSync(file, 'utf8');
    const re = /\b(applyCreditOnce|grantCredits|topUpToCeiling)\s*\(/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) {
      const before = src.slice(Math.max(0, m.index - 16), m.index);
      if (/function\s+$/.test(before)) continue; // the wrapper's own definition
      // Skip prose mentions inside comments.
      const lineStart = src.lastIndexOf('\n', m.index) + 1;
      const linePrefix = src.slice(lineStart, m.index).trim();
      if (linePrefix.startsWith('//') || linePrefix.startsWith('*')) continue;
      let depth = 1; let i = re.lastIndex;
      for (; i < src.length && depth > 0; i++) { if (src[i] === '(') depth++; else if (src[i] === ')') depth--; }
      const args = splitArgs(src.slice(re.lastIndex, i - 1));
      const arg = args[WRAPPERS[m[1]]];
      if (arg === undefined) continue; // e.g. `.catch(grantCredits)`-style reference — none today
      sites.push({ file: rel, wrapper: m[1], arg });
    }
  }
  return sites;
}

describe('SQL allowlist == TS mirror', () => {
  it('mcp_grant_resets_chatgpt_window ARRAY equals CHATGPT_WINDOW_RESET_REASONS', () => {
    const fn = MIGRATION.slice(MIGRATION.indexOf('FUNCTION mcp_grant_resets_chatgpt_window'));
    const arr = fn.slice(fn.indexOf('ARRAY['), fn.indexOf(']::TEXT[]'));
    const sqlReasons = [...arr.matchAll(/'([a-z0-9_]+)'/g)].map((x) => x[1]).sort();
    expect(sqlReasons).toEqual([...CHATGPT_WINDOW_RESET_REASONS]);
  });

  it('needs-owner reasons are NOT in the reset list (they default to no reset)', () => {
    for (const [r, e] of Object.entries(GRANT_REASONS)) {
      if (e.class !== 'reset') expect(CHATGPT_WINDOW_RESET_REASONS).not.toContain(r);
    }
  });
});

describe('every grant reason in code is classified', () => {
  const sites = grantCallSites();

  it('finds the known grant call sites (scan is not vacuous)', () => {
    const files = new Set(sites.map((s) => s.file));
    for (const f of [
      'src/lib/mcp/autorecharge.ts', 'src/app/api/stripe-webhook/route.ts', 'src/lib/mcp/stripe-topup.ts',
      'src/lib/mcp/stripe-subscription.ts', 'src/lib/mcp/app-tier-subscription.ts', 'src/lib/mcp/referrals.ts',
      'src/app/api/cron/grant-mcp-pro-credits/route.ts', 'src/app/api/admin/mcp-credits/route.ts', 'scripts/reset-comp-credits.ts',
    ]) expect(files, f).toContain(f);
  });

  it('each call site\'s reason (literal or known dynamic expression) is in GRANT_REASONS', () => {
    const unclassified: string[] = [];
    for (const s of sites) {
      const lit = /^'([^']*)'$|^"([^"]*)"$/.exec(s.arg);
      const reasons = lit ? [lit[1] ?? lit[2]] : DYNAMIC_SITES[`${s.file}::${s.arg}`];
      if (!reasons) { unclassified.push(`${s.file}: ${s.wrapper}(…, ${s.arg}) — dynamic reason not in DYNAMIC_SITES`); continue; }
      for (const r of reasons) if (!GRANT_REASONS[r]) unclassified.push(`${s.file}: ${s.wrapper}(…, '${r}')`);
    }
    expect(unclassified).toEqual([]);
  });

  it('the dynamic expressions still produce exactly the listed reasons', () => {
    const sub = readFileSync(join(ROOT, 'src/lib/mcp/stripe-subscription.ts'), 'utf8');
    expect(sub).toMatch(/ledgerReason = grant\.interval === 'year' \? 'mcp_sub_annual' : 'mcp_sub_monthly'/);
    const tier = readFileSync(join(ROOT, 'src/lib/mcp/app-tier-subscription.ts'), 'utf8');
    expect(tier).toMatch(/let tier: 'pro' \| 'team' \| null/);
    const cron = readFileSync(join(ROOT, 'src/app/api/cron/grant-mcp-pro-credits/route.ts'), 'utf8');
    expect(cron).toMatch(/allowanceReason = group === 'internal' \|\| group === 'advocate' \? 'comp_monthly' : 'pro_monthly'/);
  });

  it('grant RPCs are only invoked through their wrappers', () => {
    const allowed: Record<string, string[]> = {
      mcp_apply_credit: ['src/lib/mcp/credits.ts'],
      mcp_grant_credits: ['src/lib/mcp/credits.ts'],
      mcp_grant_signup_credits: ['src/lib/mcp/credits.ts'],
      mcp_topup_to_ceiling: ['src/lib/mcp/sponsor-entitlements.ts'],
    };
    const bad: string[] = [];
    for (const file of [...walk(join(ROOT, 'src')), ...walk(join(ROOT, 'scripts'))]) {
      const rel = relative(ROOT, file);
      const src = readFileSync(file, 'utf8');
      for (const m of src.matchAll(/rpc\(\s*['"](mcp_[a-z_]+)['"]/g)) {
        if (allowed[m[1]] && !allowed[m[1]].includes(rel)) bad.push(`${rel}: rpc('${m[1]}')`);
      }
    }
    expect(bad).toEqual([]);
  });
});
