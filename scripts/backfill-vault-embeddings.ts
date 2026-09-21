/**
 * Backfill Vault evidence embeddings into pgvector.
 *
 * One-time drain (per the bulk-job rule: local tsx runner + concurrency pool,
 * NOT an HTTP cron loop). Resumable — only embeds rows where embedding IS NULL,
 * so re-running is safe and picks up where it left off. Embed-on-write handles
 * steady state; this catches everything that existed before that shipped.
 *
 * Run all users:   npx tsx --env-file=.env.local scripts/backfill-vault-embeddings.ts
 * One user:        npx tsx --env-file=.env.local scripts/backfill-vault-embeddings.ts eric@govcongiants.com
 */
import { createClient } from '@supabase/supabase-js';
import {
  embedVaultRow, type VaultKind,
} from '../src/lib/vault/embed-evidence';

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const ONLY_EMAIL = process.argv[2] || null;
const CONCURRENCY = 6;
const STAMP = new Date().toISOString();

const KINDS: { kind: VaultKind; table: string; cols: string }[] = [
  { kind: 'past_performance', table: 'user_past_performance',
    cols: 'id, contract_title, agency, sub_agency, role, scope_description, outcomes, relevance_keywords, naics_codes' },
  { kind: 'capability', table: 'user_capabilities_library',
    cols: 'id, capability_name, description, evidence, keywords, related_naics, tools_methods' },
  { kind: 'person', table: 'user_team_members',
    cols: 'id, full_name, title, role_type, security_clearance, certifications, bio_short, bio_full' },
];

async function pool<T>(items: T[], n: number, fn: (t: T) => Promise<boolean>): Promise<number> {
  let ok = 0, i = 0;
  const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      if (await fn(items[idx])) ok++;
    }
  });
  await Promise.all(workers);
  return ok;
}

(async () => {
  if (!process.env.OPENAI_API_KEY) { console.error('OPENAI_API_KEY not set'); process.exit(1); }
  let grandOk = 0, grandTotal = 0;

  for (const { kind, table, cols } of KINDS) {
    let q = sb.from(table).select(cols)
      .is('archived_at', null)
      .is('embedding', null);          // resumable: only unembedded rows
    if (ONLY_EMAIL) q = q.eq('user_email', ONLY_EMAIL);
    const { data, error } = await q;
    if (error) { console.error(`${table}: ${error.message}`); continue; }
    const rows = data || [];
    grandTotal += rows.length;
    if (!rows.length) { console.log(`${kind}: nothing to embed`); continue; }

    const ok = await pool(rows, CONCURRENCY, (row) => embedVaultRow(sb, kind, row, STAMP));
    grandOk += ok;
    console.log(`${kind}: embedded ${ok}/${rows.length}`);
  }

  console.log(`\nDONE: ${grandOk}/${grandTotal} rows embedded${ONLY_EMAIL ? ` for ${ONLY_EMAIL}` : ''}.`);
})();
