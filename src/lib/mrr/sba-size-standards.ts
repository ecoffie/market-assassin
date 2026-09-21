/**
 * §5 SBA size-standard lookup — versioned local fixture.
 *
 * There is NO verified Mindy tool that returns the SBA NAICS size-standard
 * threshold (`lookup_sam_entity` returns an entity's own registration and
 * self-certifications, which is a different fact). So this is a deliberately
 * SMALL, version-stamped fixture covering only the codes we have actually
 * sourced — never a stand-in for the full production table.
 *
 * A code that is not in the fixture returns `unknown`. It never guesses a
 * threshold: a wrong size standard mis-sizes the market a KO surveys and can
 * flip a set-aside determination.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { GroundedField } from './types';
import { evidence, unknown, value } from './grounding';

export interface SizeStandard {
  naics: string;
  title: string;
  value: number;
  unit: string;
  measure: 'receipts' | 'employees';
  footnote: string | null;
}

interface Fixture {
  table: {
    publisher: string;
    title: string;
    version: string;
    effectiveDate: string;
    authority: string;
    sourceUrl: string;
    retrievedAt: string;
    verification: { method: string; note: string; primarySourceRetrieved: boolean };
  };
  standards: Record<string, SizeStandard>;
}

let cached: Fixture | null = null;

export function loadFixture(): Fixture {
  if (!cached) {
    const p = join(process.cwd(), 'src/lib/mrr/data/sba-size-standards.json');
    cached = JSON.parse(readFileSync(p, 'utf8')) as Fixture;
  }
  return cached;
}

/** The table's citation, for the §5 basis line and the appendix. */
export function tableCitation(): string {
  const t = loadFixture().table;
  return `${t.publisher}, ${t.title} (${t.version}); ${t.authority}`;
}

/** True when the fixture's value came from the primary PDF, not a secondary source. */
export function isPrimaryVerified(): boolean {
  return loadFixture().table.verification.primarySourceRetrieved === true;
}

/**
 * Look up a 6-digit NAICS. Absent → `unknown` with the attempt recorded.
 * Never falls back to a sibling/prefix code — a neighbouring industry's
 * threshold is a different legal fact, not an approximation.
 */
export function sizeStandardFor(naics: string | undefined): GroundedField<SizeStandard> {
  const fx = loadFixture();
  const ev = evidence(`SBA ${fx.table.version} (${fx.table.authority})`, { naics: naics ?? null }, fx.table.sourceUrl);

  if (!naics) {
    return unknown('no primary NAICS established, so no size standard can be looked up', [ev]);
  }
  const hit = fx.standards[naics];
  if (!hit) {
    return unknown(
      `NAICS ${naics} is not in the versioned local SBA fixture (which covers only ${Object.keys(fx.standards).length} sourced code(s)); consult ${fx.table.sourceUrl}`,
      [ev],
    );
  }
  return value(hit, ev);
}

/** Display form, always carrying units — a bare "34" is not a size standard. */
export function formatSizeStandard(s: SizeStandard): string {
  const fx = loadFixture();
  const caveat = fx.table.verification.primarySourceRetrieved ? '' : ' [secondary-sourced]';
  return s.measure === 'receipts'
    ? `$${s.value.toFixed(1)} million in average annual receipts (${fx.table.version})${caveat}`
    : `${s.value} employees (${fx.table.version})${caveat}`;
}
