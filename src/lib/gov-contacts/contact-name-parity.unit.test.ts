/**
 * SURFACE PARITY — there must be exactly ONE name-quality decision.
 *
 * Before 2026-09-15 the same decision existed in SIX divergent places:
 *   1. contact-quality.ts               PLACEHOLDER_NAME_RE (telephone|phone|fax|tel)
 *   2-5. four hand-copied PostgREST ilike prefix lists (federal-contacts, contacts-map,
 *        buyer-detail, contact-roster)
 *   6. events/query.ts                  its own inline copy of the same regex
 * plus market-report.ts with a private name CLEANER no other surface had, and
 * relationships/route.ts with no guard at all.
 *
 * Result: MCP showed a cleaned name, Maps showed the raw pollution, and the CRM directory
 * emitted the placeholder verbatim — three answers for one observation. These tests fail the
 * build if a seventh copy appears.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
const read = (p: string) => strip(readFileSync(join(process.cwd(), p), 'utf8'));

const CONSUMERS = [
  'src/app/api/app/federal-contacts/route.ts',
  'src/app/api/app/contacts-map/route.ts',
  'src/lib/gov-contacts/contact-roster.ts',
  'src/lib/gov-contacts/buyer-detail.ts',
  'src/lib/events/query.ts',
  'src/mcp/tools/market-report.ts',
  'src/app/api/app/relationships/route.ts',
];

describe('no surface re-implements the placeholder decision', () => {
  it.each(CONSUMERS)('%s hand-rolls no placeholder prefix list', (p) => {
    const src = read(p);
    for (const prefix of ['telephone:%', 'phone:%', 'fax:%', 'tel:%']) {
      expect(src, `${p} still hand-copies ${prefix}`).not.toContain(prefix);
    }
  });

  it.each(CONSUMERS)('%s hand-rolls no placeholder regex', (p) => {
    // The exact shape events/query.ts used to carry.
    expect(read(p)).not.toMatch(/\(telephone\|phone\|fax\|tel\)/i);
  });

  it('market-report no longer carries its own private name cleaner', () => {
    const src = read('src/mcp/tools/market-report.ts');
    expect(src).not.toMatch(/replace\(\/\\s\*DSN/);
    expect(src).toContain('displayContactName(');
  });

  it('every consumer imports the shared contract', () => {
    for (const p of CONSUMERS) {
      expect(read(p), `${p} does not import the shared contract`).toMatch(
        /(displayContactName|placeholderNameFilter|isUsableContactCard)/,
      );
    }
  });
});

describe('the raw observation is never rewritten', () => {
  it('no consumer UPDATEs contact_fullname — this is a presentation fix', () => {
    for (const p of CONSUMERS) {
      const src = read(p);
      expect(src, `${p} mutates the stored name`).not.toMatch(/update\([^)]*contact_fullname/);
    }
  });

  it('the ingest producer still stores the raw SAM value verbatim', () => {
    const src = read('src/lib/gov-contacts/buyer-contact-source.ts');
    // It filters unusable rows out, but what it DOES store is normalizeValue(fullName) —
    // never displayContactName. Source evidence must survive for identity analysis.
    expect(src).toContain('contact_fullname: fullName');
    expect(src).not.toContain('displayContactName');
  });
});

describe('buyer-detail keeps raw-vs-display separate', () => {
  it('matches the DB on the raw name and shows the cleaned one', () => {
    const src = read('src/lib/gov-contacts/buyer-detail.ts');
    // Cleaning the value used for .eq() would match zero rows — the stored string is polluted.
    expect(src).toMatch(/\.eq\('contact_fullname', nameRaw\)/);
    expect(src).toMatch(/const name = displayContactName\(nameRaw\)/);
  });
});

// ── PHASE 13: the government-buyer classification contract ───────────────────
//
// Before contact_kind, vendor exclusion depended on incidental predicates that happened to
// correlate with vendor shape. A seventh route written without that folklore would have leaked
// 82,017 vendor entity POCs as government buyers. These tests make the contract structural.

describe('every customer government-buyer surface is contact_kind-scoped', () => {
  const GOV_SURFACES = [
    'src/app/api/app/federal-contacts/route.ts',
    'src/app/api/app/contacts-map/route.ts',
    'src/lib/gov-contacts/contact-roster.ts',
    'src/lib/gov-contacts/buyer-detail.ts',
    'src/lib/events/query.ts',
  ];

  it.each(GOV_SURFACES)('%s requires government_buyer', (p) => {
    const src = read(p);
    expect(src, `${p} does not scope on contact_kind`).toMatch(
      /governmentBuyersOnly\(|\.eq\('contact_kind', 'government_buyer'\)/,
    );
  });

  it('buyer-detail scopes its DIRECT by-id lookup too, not just its listings', () => {
    // The latent gap: .eq('id', id) had no scope of its own, and isUsableContactCard could not
    // save it — hasOrg passes on a vendor row because the COMPANY sits in sub_tier.
    const src = read('src/lib/gov-contacts/buyer-detail.ts');
    const byId = src.slice(src.indexOf("from('federal_contacts')"), src.indexOf('.limit(1)'));
    expect(byId).toContain("eq('contact_kind', 'government_buyer')");
  });

  it('no surface re-implements the vendor predicate by hand', () => {
    // The whole point is ONE contract. A route asserting vendor shape itself (UEI present,
    // department null, …) is a seventh copy by another name.
    for (const p of GOV_SURFACES) {
      const src = read(p);
      expect(src, `${p} hand-rolls a vendor test`).not.toMatch(/raw_data\s*\?\s*'uei'/);
      expect(src, `${p} hand-rolls a vendor test`).not.toContain("'vendor_entity_poc'");
    }
  });

  it('isUsableContactCard rejects vendor rows centrally as defense in depth', () => {
    const src = read('src/lib/gov-contacts/contact-quality.ts');
    expect(src).toMatch(/if \(row\.contact_kind === 'vendor_entity_poc'\) return false;/);
  });

  it('the producer sets the kind, so the fail-closed scope cannot starve live rows', () => {
    // governmentBuyersOnly hides UNCLASSIFIED rows. That is only safe because the canonical
    // producer states the kind on every write — these two facts must stay true together.
    expect(read('src/lib/gov-contacts/buyer-contact-source.ts')).toContain('contact_kind: CONTACT_KIND_GOVERNMENT');
  });
});
