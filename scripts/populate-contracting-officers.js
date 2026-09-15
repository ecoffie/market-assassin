/**
 * Populate federal_contacts from sam_opportunities.points_of_contact.
 *
 * Source: sam_opportunities (Supabase) has 75K+ rows, each with a
 * points_of_contact JSONB array containing 1-3 contacts. Each contact
 * has fullName, email, phone, type ("primary"/"secondary").
 *
 * Destination: federal_contacts table (already provisioned by
 * 20260512_federal_contacts.sql migration). Schema:
 *   contact_fullname, contact_title, contact_email, contact_phone,
 *   department_ind_agency, office, sub_tier, posted_date,
 *   solicitation_number, source_row_key (unique), raw_data
 *
 * Dedup model: contact_email is the natural key when present, falls
 * back to {fullName + department} hash. source_row_key encodes the
 * source notice + contact index so re-runs are idempotent.
 *
 * Data quality filters:
 *   - Skip contacts where fullName is multi-sentence garbage (DLA
 *     auto-populates this field with buyer-lookup instructions)
 *   - Skip contacts where fullName is a SAM "Telephone: ###" placeholder
 *     (SAM emits this when there's no real POC name — measured 2026-07-26:
 *     1,348 federal_contacts rows carried this literal string as the
 *     "name". Mirrors src/lib/gov-contacts/contact-quality.ts
 *     isUsableContactName — keep both in sync if either changes.)
 *   - Skip contacts with no email AND no phone (useless for outreach)
 *   - Trim/normalize whitespace
 *
 * ============================================================================
 * ⚠️  RETIRED — NOT THE CANONICAL PRODUCER. DANGEROUS IF RE-RUN.
 * ============================================================================
 *
 * The canonical producer is `src/lib/gov-contacts/buyer-contact-run.ts`, scheduled as the
 * `sync-decision-makers` cron. It owns THIS EXACT KEY SPACE (`<notice_id>::<slot>`) and keeps
 * a durable checkpoint in `decision_makers_sync_state`.
 *
 * WHY THIS SCRIPT IS DANGEROUS: it explicitly writes
 * `source_table: 'sam_opportunities_pointOfContact'`. The live producer deliberately OMITS
 * source_table so each row keeps its original import-generation label. Re-running this would
 * silently RELABEL rows the live producer now owns — destroying the only import-lineage signal
 * the provenance audit relies on. It also predates `contact_kind`, so its rows would land
 * UNCLASSIFIED. It deletes nothing, which is exactly why the damage would be easy to miss.
 *
 * It is retained (not deleted) because it documents how the 30,439-row first generation was
 * created — 94.7% of which the live drain has since re-adopted in place.
 *
 * Usage (read-only by default):
 *   node scripts/populate-contracting-officers.js            # dry run, writes nothing
 *   node scripts/populate-contracting-officers.js --legacy-replay --i-understand-this-relabels-live-rows
 */
// Load env explicitly from .env.local (dotenv default looks for .env)
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '..', '.env.local') });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

const BATCH_SIZE = 1000;        // Supabase pages
const INSERT_CHUNK = 500;       // upsert chunks
const MAX_FULLNAME_LENGTH = 80; // anything longer is a paragraph, not a name

// Mirrors src/lib/gov-contacts/contact-quality.ts PLACEHOLDER_NAME_RE / ALL_DIGITS_RE
// (a plain .js script can't import the TS path alias, so this is a faithful copy).
const PLACEHOLDER_NAME_RE = /^(telephone|phone|fax|tel)\s*:?\s*[\d().\-\s]{6,}$/i;
const ALL_DIGITS_RE = /^[\d().\-\s+]{6,}$/;

function isGarbageName(name) {
  if (!name || typeof name !== 'string') return true;
  if (name.length > MAX_FULLNAME_LENGTH) return true;
  if (name.includes('\n') || name.includes('  ')) return true;
  if (name.toLowerCase().includes('please') || name.toLowerCase().includes('emailed')) return true;
  // Single-token names like "Buyer" or "Contracting" are useless
  if (name.split(/\s+/).length === 1 && name.length < 6) return true;
  // SAM's own "no real name" placeholder ("Telephone: 7175503112") or a bare
  // phone-number-shaped string with no name at all.
  if (PLACEHOLDER_NAME_RE.test(name.trim()) || ALL_DIGITS_RE.test(name.trim())) return true;
  return false;
}

function normalize(s) {
  if (!s || typeof s !== 'string') return null;
  const trimmed = s.trim();
  return trimmed.length === 0 ? null : trimmed;
}

async function fetchPage(offset) {
  const { data, error } = await sb
    .from('sam_opportunities')
    .select('notice_id, solicitation_number, department, office, sub_tier, posted_date, points_of_contact')
    .not('points_of_contact', 'eq', '[]')
    .range(offset, offset + BATCH_SIZE - 1);
  if (error) throw error;
  return data;
}

function extractContacts(row) {
  const contacts = row.points_of_contact;
  if (!Array.isArray(contacts) || contacts.length === 0) return [];

  return contacts
    .map((c, idx) => {
      const fullName = normalize(c.fullName);
      const email = normalize(c.email);
      const phone = normalize(c.phone);

      // Filters
      if (isGarbageName(fullName)) return null;
      if (!email && !phone) return null;

      return {
        source_table: 'sam_opportunities_pointOfContact',
        source_row_key: `${row.notice_id}::${idx}`,
        contact_fullname: fullName,
        contact_title: normalize(c.title) || (c.type === 'primary' ? 'Primary Contact' : c.type === 'secondary' ? 'Secondary Contact' : null),
        contact_email: email,
        contact_phone: phone,
        department_ind_agency: normalize(row.department),
        office: normalize(row.office),
        sub_tier: normalize(row.sub_tier),
        posted_date: normalize(row.posted_date),
        solicitation_number: normalize(row.solicitation_number),
        raw_data: c,
      };
    })
    .filter(Boolean);
}

async function upsertChunk(rows) {
  // The guard lives at the WRITE, not only at the entry point, so no future refactor of main()
  // can route around it.
  if (!WRITES_ENABLED) return;
  const { error } = await sb
    .from('federal_contacts')
    .upsert(rows, { onConflict: 'source_row_key' });
  if (error) {
    console.error('Upsert error:', error.message);
    throw error;
  }
}

// ── WRITE GUARD ──────────────────────────────────────────────────────────────
// Two independent, deliberately unguessable flags. One alone is not enough: a half-remembered
// command line must not be able to write production.
const ARGV = process.argv.slice(2);
const LEGACY_REPLAY = ARGV.includes('--legacy-replay');
const ACKNOWLEDGED = ARGV.includes('--i-understand-this-relabels-live-rows');
export const WRITES_ENABLED = LEGACY_REPLAY && ACKNOWLEDGED;

function announceGuard() {
  console.error('='.repeat(78));
  console.error('  RETIRED SCRIPT — populate-contracting-officers.js');
  console.error('  The canonical producer is the `sync-decision-makers` cron');
  console.error('  (src/lib/gov-contacts/buyer-contact-run.ts).');
  console.error('');
  if (WRITES_ENABLED) {
    console.error('  *** WRITES ENABLED *** This will RELABEL source_table on rows the live');
    console.error('  producer owns, and will write rows with contact_kind UNSET.');
  } else {
    console.error('  DRY RUN — nothing will be written.');
    console.error('  Writing requires BOTH --legacy-replay and');
    console.error('  --i-understand-this-relabels-live-rows');
  }
  console.error('='.repeat(78));
}

async function main() {
  announceGuard();
  const start = Date.now();
  let offset = 0;
  let totalSeen = 0;
  let totalExtracted = 0;
  let totalUpserted = 0;

  while (true) {
    const page = await fetchPage(offset);
    if (!page || page.length === 0) break;

    totalSeen += page.length;

    const extracted = page.flatMap(extractContacts);
    totalExtracted += extracted.length;

    // Upsert in chunks
    for (let i = 0; i < extracted.length; i += INSERT_CHUNK) {
      const chunk = extracted.slice(i, i + INSERT_CHUNK);
      await upsertChunk(chunk);
      totalUpserted += chunk.length;
    }

    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`[${elapsed}s] offset=${offset} seen=${totalSeen} extracted=${totalExtracted} upserted=${totalUpserted}`);

    if (page.length < BATCH_SIZE) break;
    offset += BATCH_SIZE;
  }

  console.log('---');
  console.log(`Done. Opportunities scanned: ${totalSeen}`);
  console.log(`Contacts extracted (after filters): ${totalExtracted}`);
  console.log(`Contacts ${WRITES_ENABLED ? 'upserted' : 'that WOULD be upserted (dry run)'}: ${totalUpserted}`);
  console.log(`Filtered out as garbage: ${totalSeen > 0 ? `${((totalSeen - totalExtracted) / totalSeen * 100).toFixed(1)}% of source rows had usable contacts` : 'n/a'}`);
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
