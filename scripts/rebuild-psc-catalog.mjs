/**
 * Rebuild src/data/psc-codes.json from USASpending's PSC filter tree.
 *
 * WHY: the checked-in file had 869 codes and was missing real ones — D314
 * ("IT AND TELECOM- SYSTEM ACQUISITION SUPPORT", $134.6M and 9% of the
 * acquisition-support market) rendered in Settings as "not a known PSC".
 * A customer hit that on 2026-08-15: our own recommender told him to add
 * D314, our own settings panel told him it wasn't real, and he swapped in a
 * code that added no coverage. The label is cosmetic (it never blocked the
 * save) but it actively discouraged a correct action.
 *
 * SOURCE: api.usaspending.gov /api/v2/references/filter_tree/psc/ — the same
 * catalog the award data is coded against, so a code that appears in spending
 * can never be "unknown" here again.
 *
 * Keeps the existing file shape (codes keyed by code, with title/category/
 * category_name/level) so every consumer of getPsc() is unchanged.
 *
 *   node scripts/rebuild-psc-catalog.mjs          # dry run, prints the diff
 *   node scripts/rebuild-psc-catalog.mjs --write  # writes the file
 */
import fs from 'fs';

const WRITE = process.argv.includes('--write');
const OUT = 'src/data/psc-codes.json';
const BASE = 'https://api.usaspending.gov/api/v2/references/filter_tree/psc';

async function get(path) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const r = await fetch(`${BASE}${path}`, { signal: AbortSignal.timeout(45000) });
      if (r.ok) return await r.json();
      if (r.status === 429 || r.status >= 500) { await new Promise((s) => setTimeout(s, 1500 * attempt)); continue; }
      return null;
    } catch { await new Promise((s) => setTimeout(s, 1500 * attempt)); }
  }
  return null;
}

/** Collect every 4-char leaf under a node. PSC leaves are the codes users enter. */
function leaves(nodes, out) {
  for (const n of nodes || []) {
    const id = String(n.id ?? '');
    // 4-char (D314, R425) and legacy 4-digit product codes (1005) are both leaves.
    if (id.length === 4) out.set(id, String(n.description ?? '').trim());
    leaves(n.children, out);
  }
}

const existing = JSON.parse(fs.readFileSync(OUT, 'utf8'));
const found = new Map();

const roots = await get('/');
if (!roots?.results?.length) { console.error('✗ could not read the PSC filter tree root'); process.exit(1); }

for (const root of roots.results) {
  const rid = String(root.id);
  const branch = await get(`/${encodeURIComponent(rid)}/?depth=3`);
  leaves(branch?.results ?? [], found);
  // Second pass one level down — the tree paginates depth, so a single deep
  // request silently truncates the larger branches.
  for (const child of branch?.results ?? []) {
    const cid = String(child.id);
    if (found.size && cid.length >= 2) {
      const sub = await get(`/${encodeURIComponent(rid)}/${encodeURIComponent(cid)}/?depth=2`);
      leaves(sub?.results ?? [], found);
    }
  }
  console.error(`  ${rid}: ${found.size} leaf codes so far`);
}

console.log(`\nlive catalog leaves: ${found.size}`);
console.log(`current file:        ${Object.keys(existing.codes).length}`);

const added = [...found.keys()].filter((c) => !existing.codes[c]);
const kept = Object.keys(existing.codes).filter((c) => found.has(c));
const onlyLocal = Object.keys(existing.codes).filter((c) => !found.has(c));
console.log(`would ADD:  ${added.length}`);
console.log(`unchanged:  ${kept.length}`);
console.log(`local-only (kept anyway, never drop a code someone may have saved): ${onlyLocal.length}`);
console.log('\nsample additions:', added.slice(0, 8).join(', '));
console.log('D314 in live catalog:', found.has('D314'), found.get('D314') ?? '');

if (!WRITE) { console.log('\nDry run — nothing written. Re-run with --write.\n'); process.exit(0); }

// Merge: live titles win, local-only codes are PRESERVED. Dropping a code a
// customer already saved would recreate the exact bug this fixes.
const merged = { ...existing.codes };
for (const [code, title] of found) {
  const prev = existing.codes[code];
  merged[code] = {
    title: title || prev?.title || code,
    category: prev?.category ?? code[0],
    category_name: prev?.category_name ?? '',
    level: 4,
  };
}
const out = {
  lastUpdated: new Date().toISOString().slice(0, 10),
  version: (Number(existing.version) || 1) + 1,
  source: 'api.usaspending.gov/api/v2/references/filter_tree/psc (rebuild-psc-catalog.mjs)',
  totalCodes: Object.keys(merged).length,
  codes: Object.fromEntries(Object.entries(merged).sort(([a], [b]) => a.localeCompare(b))),
};
fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');
console.log(`\n✓ wrote ${OUT} — ${out.totalCodes} codes`);
