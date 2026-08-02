/**
 * Guards the DA-format PDF record-JOINER.
 *
 * These district PDFs (New Orleans, Sacramento) flatten a table into text that
 * wraps column headers across ~15 lines and spills every record across 2-5
 * lines. Read a line at a time, they corrupt in three specific ways, all of
 * which reached a dry run before this parser existed:
 *
 *   - 53 "rows" from 26 real records (continuation fragments became titles)
 *   - naics=384351 — a PROJECT CODE lifted out of the title; the real NAICS on
 *     that row is 237990
 *   - "$25-100M" read as $100.0M — the range collapsed to its ceiling,
 *     overstating the floor 4x
 *
 * Every fixture is VERBATIM extracted text from the live files.
 */
import { describe, it, expect } from 'vitest';
import {
  isDataTail, isContinuationFragment, naicsFromTail, valueFromTail,
  stripHeaderPhrases, parseUsaceDaPdf,
} from './usace-da-pdf';

describe('isDataTail — the structural anchor', () => {
  it('matches a line carrying BOTH a 6-digit NAICS and a dollar amount', () => {
    // Measured on the live files: New Orleans 26/26, Sacramento 100/100.
    expect(isDataTail('CG BBA18 West Shore \t$100-250M \tN/A \t237990 \tUnrestricted')).toBe(true);
    expect(isDataTail('Operations \tEnglebright HQ Building \tN/A \t$10M - $25M \tTBD \t236220')).toBe(true);
  });

  it('rejects a title line and a continuation fragment', () => {
    expect(isDataTail('Natomas - Pumping Plant 5 Upgrade:')).toBe(false);
    expect(isDataTail('Contract FY26 Q2')).toBe(false);
    expect(isDataTail('alone) IFB \tFY26 Q1 \tFY26 Q3')).toBe(false);
  });
});

describe('naicsFromTail — never read an industry out of the title', () => {
  it('takes the NAICS from its own cell, not a project code in the prose', () => {
    // THE BUG: "Construction WP 384351" is a project code. Reading the first
    // 6-digit run in the record produced naics=384351 on a row whose real
    // NAICS is 237990 — a fabricated industry on a live card.
    const tail = 'DRSAA FCCE Lake Pontchartrain and Vicinity, LA | Construction WP 384351 \t$25-100M \tN/A \t237990 \tUnrestricted';
    expect(naicsFromTail(tail)).toBe('237990');
  });

  it('reads a clean tab-delimited cell', () => {
    expect(naicsFromTail('x \t$1M - $5M \tTBD \t237110 \tUnrestricted')).toBe('237110');
  });

  it('returns undefined when there is no code', () => {
    expect(naicsFromTail('Some title \t$1M - $5M \tTBD')).toBeUndefined();
  });
});

describe('valueFromTail — keep the published range', () => {
  it('preserves a range instead of collapsing it to the ceiling', () => {
    // "$25-100M" became $100.0M, which overstates the floor by 4x.
    const v = valueFromTail('x \t$25-100M \tN/A \t237990');
    expect(v.range).toBe('$25-100M');
    expect(v.min).toBe(25_000_000);
    expect(v.max).toBe(100_000_000);
  });

  it('handles the spaced form', () => {
    const v = valueFromTail('x \t$250K - $500K \tTBD \t238210');
    expect(v.min).toBe(250_000);
    expect(v.max).toBe(500_000);
  });

  it('reads a UNICODE dash — the PDF does not use ASCII hyphens throughout', () => {
    // "$5‐10M" here uses U+2010 NON-BREAKING HYPHEN. A [-–] class missed it, so
    // the range fell through to the single-amount branch and stored $5 as both
    // floor AND ceiling on a $5-10M contract.
    const v = valueFromTail('Lively Bayou Clearing and Snagging \t$5‑10M \tN/A \t237990');
    expect(v.min).toBe(5_000_000);
    expect(v.max).toBe(10_000_000);
  });

  it('applies a SHARED suffix to both bounds', () => {
    // "$25-100M" is $25M to $100M, not $25 to $100M.
    expect(valueFromTail('x \t$1-5M \t237990').min).toBe(1_000_000);
  });
});

describe('isContinuationFragment — shape, not vocabulary', () => {
  it('recognises wrapped tails from BOTH files', () => {
    // New Orleans wraps as separate words, Sacramento as a run-on. A fixed word
    // list fixed one file and left the other leaking its previous record's tail
    // into the next title.
    for (const s of ['Contract FY26 Q2', 'Woman', 'Owned Set', 'Aside',
                     'N/A Stand Alone', 'alone) IFB \tFY26 Q1 \tFY26 Q3',
                     '(TO) FY26 Q1 \tFY26 Q3', 'FY26 Q1', 'TBD']) {
      expect(isContinuationFragment(s), `"${s}" should be a continuation`).toBe(true);
    }
  });

  it('does NOT swallow a real project title', () => {
    for (const s of ['Natomas - Pumping Plant 5 Upgrade:',
                     'Operations Englebright - VOIP (Work to be included in',
                     'MCNARY SPILLWAY CRANES 6 & 7']) {
      expect(isContinuationFragment(s), `"${s}" is a real title`).toBe(false);
    }
  });
});

describe('stripHeaderPhrases', () => {
  it('removes the wrapped column headers that run into the first title', () => {
    const t = stripHeaderPhrases('Project Title and Description Anticipated of Performance NAICS CG BBA18 West Shore');
    expect(t).toBe('CG BBA18 West Shore');
  });

  it('leaves an ordinary title alone', () => {
    expect(stripHeaderPhrases('MTC Morganza to the Gulf — MTG07A Reach F Construction'))
      .toBe('MTC Morganza to the Gulf — MTG07A Reach F Construction');
  });
});

describe('parseUsaceDaPdf — end to end', () => {
  // Verbatim from the New Orleans extraction, including the wrapped header block.
  const NOLA = [
    'USACE New Orleans District Acquisition Forecast - FY26 and Beyond',
    'Project Title and Description Anticipated',
    'Dollar Value',
    'NAICS',
    'CG BBA18 West Shore Lake Pontchartrain | Major Pump Stations and Drainage Structures \t$100-250M \tN/A \t237990 \tUnrestricted \tN/A Stand Alone',
    'Contract FY26 Q2',
    'MTC Atchafalaya Basin, L | Bayou Sale East West Tie \t$5-10M \tN/A \t237990',
    'Woman',
    'Owned Set',
    'Aside',
    'N/A Stand Alone',
    'Contract FY26 Q2',
  ].join('\n');

  it('reconstructs one record per data tail, not one per line', () => {
    const res = parseUsaceDaPdf(NOLA);
    expect(res.rows).toHaveLength(2);
    expect(res.skipped).toBe(0);
  });

  it('attributes a wrapped tail to the record ABOVE it', () => {
    // "Woman / Owned Set / Aside" belongs to the Atchafalaya row. Attributing it
    // forward put "Contract FY26 Q2" at the head of the next title and dropped
    // fiscal-year coverage to 4%.
    const [a, b] = parseUsaceDaPdf(NOLA).rows;
    expect(a.title).toBe('CG BBA18 West Shore Lake Pontchartrain — Major Pump Stations and Drainage Structures');
    expect(a.fiscalYear).toBe('FY2026');
    expect(a.anticipatedQuarter).toBe('Q2');
    expect(a.setAside).toBe('Full and Open');

    expect(b.title).toBe('MTC Atchafalaya Basin, L — Bayou Sale East West Tie');
    expect(b.setAside).toBe('WOSB');
    expect(b.fiscalYear).toBe('FY2026');
  });

  it('keeps an inline title that shares its line with the data', () => {
    // Sacramento writes the whole record on one line. Cutting at the FIRST tab
    // kept only the program label "Operations" and threw the project name away.
    const res = parseUsaceDaPdf(
      'Operations \tEnglebright HQ Building \tN/A \t$10M - $25M \tTBD \t236220 \tSB C-type (stand-\nalone) IFB \tFY26 Q1 \tFY26 Q3',
    );
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].title).toBe('Operations Englebright HQ Building');
    expect(res.rows[0].naicsCode).toBe('236220');
    expect(res.rows[0].estimatedValueMin).toBe(10_000_000);
  });
});
