const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { kv } = require('@vercel/kv');

const ROOT = path.resolve(__dirname, '..');

function loadEnv(filename) {
  const file = path.join(ROOT, filename);
  if (!fs.existsSync(file)) return;

  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key]) continue;
    process.env[key] = rawValue.replace(/^['"]|['"]$/g, '').replace(/\\n/g, '').trim();
  }
}

loadEnv('.env.local');
loadEnv('.env.codex-production');

const EMAILS = [
  'fernando.mercado@venerandavalor.com',
  'kenworthbudd@yahoo.com',
  'sylvester.anderson@andslylegacy.com',
  'powerwealthprofits@protonmail.com',
  'hello@eganrose.com',
  'sylwiak@hjgovcontractingcorp.com',
  'kydun00@yahoo.com',
];

function normalizeEmail(email) {
  return String(email || '').toLowerCase().trim();
}

function displayMarketAssassin(value) {
  if (!value) return 'none';
  if (typeof value === 'object' && value.tier === 'premium') return 'Premium';
  if (typeof value === 'object' && value.tier === 'standard') return 'Standard';
  return 'access present, tier unknown';
}

function displayContentReaper(value) {
  if (!value) return 'none';
  if (typeof value === 'object' && value.tier === 'full-fix') return 'Full Fix';
  if (typeof value === 'object' && value.tier === 'content-engine') return 'Content Engine';
  return 'access present, tier unknown';
}

function hasUltimateMa(value) {
  return !!value && typeof value === 'object' && value.tier === 'premium';
}

function hasUltimateCr(value) {
  return !!value && typeof value === 'object' && value.tier === 'full-fix';
}

function isObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function generateDatabaseToken() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let token = '';
  for (let i = 0; i < 24; i += 1) {
    token += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return token;
}

async function lpushIfMissing(listKey, email, exists) {
  if (!exists) {
    await kv.lpush(listKey, email);
  }
}

async function readAccess(email) {
  const normalized = normalizeEmail(email);
  const [ma, content, database, recompete, briefings] = await Promise.all([
    kv.get(`ma:${normalized}`),
    kv.get(`contentgen:${normalized}`),
    kv.get(`dbaccess:${normalized}`),
    kv.get(`recompete:${normalized}`),
    kv.get(`briefings:${normalized}`),
  ]);

  const hasAnyTool = Boolean(ma || content || database || recompete);
  const missing = [];
  if (!hasUltimateMa(ma)) missing.push('Market Assassin Premium');
  if (!hasUltimateCr(content)) missing.push('Content Reaper Full Fix');
  if (!database) missing.push('Federal Contractor Database');
  if (!recompete) missing.push('Recompete Tracker');

  let category = 'Full Ultimate access';
  if (missing.length === 4 && !hasAnyTool) category = 'No access';
  else if (missing.length > 0) category = 'Partial access';

  return {
    email: normalized,
    raw: { ma, content, database, recompete, briefings },
    marketAssassinTier: displayMarketAssassin(ma),
    contentReaperTier: displayContentReaper(content),
    databaseAccess: database ? 'yes' : 'no',
    databaseTier: database ? 'full' : 'none',
    recompeteAccess: recompete ? 'yes' : 'no',
    recompeteTier: recompete ? 'full' : 'none',
    briefingsEntitlement: briefings ? 'active' : 'not active',
    category,
    missing,
  };
}

async function grantUltimate(email, before) {
  const normalized = normalizeEmail(email);
  const now = new Date().toISOString();
  const fixed = [];

  if (!hasUltimateMa(before.raw.ma)) {
    await kv.set(`ma:${normalized}`, {
      email: normalized,
      customerName: isObject(before.raw.ma) ? before.raw.ma.customerName : undefined,
      tier: 'premium',
      createdAt: isObject(before.raw.ma) ? before.raw.ma.createdAt || now : now,
      upgradedAt: before.raw.ma ? now : undefined,
    });
    await lpushIfMissing('ma:all', normalized, before.raw.ma);
    fixed.push('Market Assassin Premium');
  }

  if (!hasUltimateCr(before.raw.content)) {
    await kv.set(`contentgen:${normalized}`, {
      email: normalized,
      customerName: isObject(before.raw.content) ? before.raw.content.customerName : undefined,
      tier: 'full-fix',
      createdAt: isObject(before.raw.content) ? before.raw.content.createdAt || now : now,
      upgradedAt: before.raw.content ? now : undefined,
      productId: 'govcon-content-generator',
    });
    await lpushIfMissing('contentgen:all', normalized, before.raw.content);
    fixed.push('Content Reaper Full Fix');
  }

  if (!before.raw.database) {
    const token = generateDatabaseToken();
    await kv.set(`dbtoken:${token}`, {
      token,
      email: normalized,
      createdAt: now,
    });
    await kv.set(`dbaccess:${normalized}`, {
      token,
      createdAt: now,
    });
    await kv.lpush('db:all', normalized);
    fixed.push('Federal Contractor Database');
  }

  if (!before.raw.recompete) {
    await kv.set(`recompete:${normalized}`, {
      email: normalized,
      createdAt: now,
    });
    await kv.lpush('recompete:all', normalized);
    fixed.push('Recompete Tracker');
  }

  if (!before.raw.briefings) {
    await kv.set(`briefings:${normalized}`, 'true');
    fixed.push('Briefings entitlement');
  }

  return fixed;
}

function table(results) {
  const rows = results.map(row => ({
    email: row.email,
    marketAssassin: row.marketAssassinTier,
    contentReaper: row.contentReaperTier,
    database: `${row.databaseAccess}${row.databaseAccess === 'yes' ? ` (${row.databaseTier})` : ''}`,
    recompete: `${row.recompeteAccess}${row.recompeteAccess === 'yes' ? ` (${row.recompeteTier})` : ''}`,
    briefings: row.briefingsEntitlement,
    category: row.category,
    missing: row.missing.join('; ') || 'none',
    fixed: row.fixed?.join('; ') || 'none',
  }));
  console.table(rows);
}

async function main() {
  const execute = process.argv.includes('--execute');
  const before = [];
  for (const email of EMAILS) {
    before.push(await readAccess(email));
  }

  if (execute) {
    for (const row of before) {
      row.fixed = row.category === 'Full Ultimate access' ? [] : await grantUltimate(row.email, row);
    }
  }

  const after = [];
  for (const email of EMAILS) {
    const row = await readAccess(email);
    const original = before.find(item => item.email === row.email);
    row.beforeCategory = original.category;
    row.fixed = original.fixed || [];
    after.push(row);
  }

  const output = {
    mode: execute ? 'execute' : 'preview',
    generatedAt: new Date().toISOString(),
    before: before.map(({ raw, ...row }) => row),
    after: after.map(({ raw, ...row }) => row),
    sendStandardActivation: after
      .filter(row => row.category === 'Full Ultimate access' && row.beforeCategory === 'Full Ultimate access')
      .map(row => row.email),
    sendApologyEmail: after
      .filter(row => row.category === 'Full Ultimate access' && row.beforeCategory !== 'Full Ultimate access')
      .map(row => ({
        email: row.email,
        previousCategory: row.beforeCategory,
        fixed: row.fixed,
      })),
    stillNotFullUltimate: after
      .filter(row => row.category !== 'Full Ultimate access')
      .map(row => ({ email: row.email, missing: row.missing })),
  };

  table(after);
  console.log(JSON.stringify(output, null, 2));
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
