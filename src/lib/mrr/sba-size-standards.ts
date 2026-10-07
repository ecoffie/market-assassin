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
  /** Where the value was read: the live regulation, or the versioned fixture. */
  source?: 'ecfr' | 'fixture';
  /** eCFR: the date the regulation text was current as of. Fixture: its effective date. */
  asOf?: string;
  /** eCFR: the date §121.201 was last amended. */
  lastAmended?: string | null;
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

/** Display form, always carrying units and the source date — a bare "34" is not a size standard. */
export function formatSizeStandard(s: SizeStandard): string {
  const amount =
    s.measure === 'receipts'
      ? `$${s.value.toFixed(1)} million in average annual receipts`
      : `${s.value.toLocaleString('en-US')} employees`;
  if (s.source === 'ecfr') {
    return `${amount} (13 CFR 121.201 on eCFR, current as of ${s.asOf}${s.lastAmended ? `; section last amended ${s.lastAmended}` : ''})${s.footnote ? `. ${s.footnote}` : ''}`;
  }
  const fx = loadFixture();
  const caveat = fx.table.verification.primarySourceRetrieved ? '' : ' [secondary-sourced]';
  return `${amount} (${fx.table.version}; eCFR was unreachable, so the stored copy was used)${caveat}`;
}

export interface ResolvedSizeStandard {
  field: GroundedField<SizeStandard>;
  citation: string;
}

type TableLoader = () => Promise<import('./ecfr-size-standards').EcfrSizeTable>;

async function defaultTableLoader(): Promise<import('./ecfr-size-standards').EcfrSizeTable> {
  // Unit tests never touch the network; they inject a loader to exercise the eCFR path.
  if (process.env.VITEST) throw new Error('eCFR is not reachable from unit tests');
  const { fetchEcfrSizeTable } = await import('./ecfr-size-standards');
  const { withCache } = await import('@/lib/mcp/external-cache');
  const { value: table } = await withCache('ecfr_size_standards', { section: '121.201' }, 24 * 60 * 60, () =>
    fetchEcfrSizeTable(),
  );
  return table;
}

/**
 * Resolve the size standard for a 6-digit NAICS from the regulation itself
 * (eCFR, 13 CFR 121.201). If eCFR cannot be read, the versioned fixture is used
 * and labelled as such; a code in neither is Unknown — never guessed, never a
 * sibling/prefix code.
 */
export async function resolveSizeStandard(
  naics: string | undefined,
  loadTable: TableLoader = defaultTableLoader,
): Promise<ResolvedSizeStandard> {
  const { ECFR_SECTION_URL } = await import('./ecfr-size-standards');
  if (!naics) {
    return {
      field: unknown('not looked up — no NAICS code was provided'),
      citation: '13 CFR 121.201 (not looked up: no NAICS code was provided)',
    };
  }
  try {
    const table = await loadTable();
    const ev = evidence(
      `eCFR 13 CFR 121.201 (current as of ${table.asOf})`,
      { naics, as_of: table.asOf, last_amended: table.lastAmended },
      ECFR_SECTION_URL,
    );
    const citation =
      `U.S. Small Business Administration, Table of Small Business Size Standards, 13 CFR 121.201, ` +
      `read from eCFR (current as of ${table.asOf}${table.lastAmended ? `; section last amended ${table.lastAmended}` : ''}). ${ECFR_SECTION_URL}`;
    const row = table.rows[naics];
    if (!row) {
      return {
        field: unknown(`NAICS ${naics} does not appear in 13 CFR 121.201 as published on eCFR (current as of ${table.asOf})`, [ev]),
        citation,
      };
    }
    const receipts = row.receiptsMillions != null;
    return {
      field: value<SizeStandard>(
        {
          naics,
          title: row.title,
          value: receipts ? row.receiptsMillions! : row.employees!,
          unit: receipts ? 'million USD annual receipts' : 'employees',
          measure: receipts ? 'receipts' : 'employees',
          footnote: row.exceptions.length
            ? `13 CFR 121.201 lists ${row.exceptions.length} exception(s) for this NAICS with different thresholds: ` +
              row.exceptions
                .map((e) => `${e.title} (${e.receiptsMillions != null ? `$${e.receiptsMillions.toFixed(1)} million` : `${e.employees} employees`})`)
                .join('; ') +
              '. Confirm whether one applies.'
            : null,
          source: 'ecfr',
          asOf: table.asOf,
          lastAmended: table.lastAmended,
        },
        ev,
      ),
      citation,
    };
  } catch (error) {
    console.warn('[mrr] eCFR size-standard lookup failed; using fixture', error);
    const fixture = sizeStandardFor(naics);
    const fx = loadFixture();
    return {
      field:
        fixture.state === 'value'
          ? value({ ...fixture.value, source: 'fixture', asOf: fx.table.effectiveDate }, fixture.evidence)
          : unknown(`eCFR could not be reached and NAICS ${naics} is not in the stored copy; size standard not stated`, fixture.state === 'unknown' ? fixture.attemptedEvidence : undefined),
      citation: `${tableCitation()} — stored copy used because eCFR could not be reached`,
    };
  }
}
