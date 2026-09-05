/**
 * Block 4 done-test — the eight required renderer tests, plus the two
 * done-test assertions (a bare value fails the build; missing and true-zero
 * serialize AND render differently).
 */
import { describe, it, expect } from 'vitest';
import {
  renderField, EvidenceCollector, AssemblyError, UNKNOWN_PREFIX, DEGRADED_PREFIX,
  evidence, value, trueZero, unknown, degraded, unknownFromError,
} from './grounding';
import type { EvidenceRef, GroundedField } from './types';

const EV: EvidenceRef = {
  source: 'Mindy MCP get_keyword_coverage (USASpending)',
  retrievedAt: '2026-09-05T12:00:00.000Z',
  query: { keyword: 'medical modeling and simulation' },
};

describe('grounding renderer — the 8 required tests', () => {
  it('1. a grounded value with complete evidence renders and enters the appendix', () => {
    const c = new EvidenceCollector();
    const cell = c.render('§5 Primary NAICS', value('541512', EV));
    expect(cell.text).toBe('541512');
    expect(cell.state).toBe('value');
    expect(c.sourced()).toHaveLength(1);
    expect(c.sourced()[0].evidence[0].source).toContain('get_keyword_coverage');
  });

  it('2. a grounded TRUE ZERO renders explicitly as a measured zero', () => {
    const cell = renderField('§9 Offerors', trueZero('offer count reported by USASpending', EV));
    expect(cell.text).toBe('Recorded: 0 — offer count reported by USASpending');
    expect(cell.state).toBe('true_zero');
    expect(cell.text).not.toBe('0');
  });

  it('3. a MISSING value renders Unknown, not zero', () => {
    const cell = renderField('§9 Offerors', unknown<number>('source did not report an offeror count'));
    expect(cell.text).toContain(UNKNOWN_PREFIX);
    expect(cell.text).not.toMatch(/\b0\b/);
    expect(cell.state).toBe('unknown');
  });

  it('4. grounded:false renders Unknown', () => {
    // The shape a tool returns when _meta.grounded === false.
    const f: GroundedField<number> = unknown('tool returned grounded:false', [EV]);
    const cell = renderField('§5 Market total', f);
    expect(cell.text).toContain(UNKNOWN_PREFIX);
    expect(cell.state).toBe('unknown');
    expect(cell.evidence).toHaveLength(1); // the ATTEMPT is still recorded
  });

  it('5. degraded/conflicting evidence is visible and cannot render as an unqualified fact', () => {
    const cell = renderField(
      '§9 Predecessor',
      degraded('no sufficiently consistent predecessor award established', [EV], 'US Army NVESD award'),
    );
    expect(cell.text.startsWith(DEGRADED_PREFIX)).toBe(true);
    expect(cell.text).toContain('no sufficiently consistent predecessor');
    // the partial is present but only BEHIND the degraded label
    expect(cell.text).toContain('partial:');
    expect(cell.text).not.toBe('US Army NVESD award');
    expect(cell.state).toBe('degraded');
  });

  it('6. a value without SOURCE throws', () => {
    const bad = { state: 'value', value: 42, evidence: { source: '', retrievedAt: EV.retrievedAt, query: {} } } as GroundedField<number>;
    expect(() => renderField('§5 X', bad)).toThrow(AssemblyError);
    expect(() => renderField('§5 X', bad)).toThrow(/no source/);
  });

  it('7. a value without RETRIEVAL TIME throws', () => {
    const bad = { state: 'value', value: 42, evidence: { source: 'x', retrievedAt: '', query: {} } } as GroundedField<number>;
    expect(() => renderField('§5 X', bad)).toThrow(AssemblyError);
    expect(() => renderField('§5 X', bad)).toThrow(/no retrieval time/);
  });

  it('8. a query exception becomes Unknown WITH error provenance, never an empty success', () => {
    const attempted = evidence('Mindy MCP search_past_contracts', { naics: '541512' });
    let f: GroundedField<number[]>;
    try {
      throw new Error('ECONNRESET');
    } catch (e) {
      f = unknownFromError(e, attempted);
    }
    const cell = renderField('§9 Awards', f);
    expect(cell.state).toBe('unknown');
    expect(cell.text).toContain('query failed: ECONNRESET');
    expect(cell.evidence[0].source).toContain('search_past_contracts');
    expect(cell.text).not.toContain('Recorded: 0');
  });
});

describe('Block 4 done-test assertions', () => {
  it('deliberately passing a BARE value fails the build', () => {
    const bare = { state: 'value', value: 7 } as unknown as GroundedField<number>;
    expect(() => renderField('§5 Bare', bare)).toThrow(AssemblyError);
    expect(() => renderField('§5 Bare', bare)).toThrow(/without provenance/);
  });

  it('missing and true-zero produce DIFFERENT serialized and rendered outputs', () => {
    const miss = unknown<number>('not reported');
    const zero = trueZero('measured zero', EV);
    expect(JSON.stringify(miss)).not.toBe(JSON.stringify(zero));
    expect(renderField('x', miss).text).not.toBe(renderField('x', zero).text);
    expect(renderField('x', miss).state).toBe('unknown');
    expect(renderField('x', zero).state).toBe('true_zero');
  });

  it('every safe rendered fact generates an appendix entry', () => {
    const c = new EvidenceCollector();
    c.render('a', value('x', EV));
    c.render('b', trueZero('measured zero', EV));
    c.render('c', unknown('missing'));
    c.render('d', degraded('conflict', [EV]));
    expect(c.sourced()).toHaveLength(2);
    for (const cell of c.sourced()) {
      expect(cell.evidence.length).toBeGreaterThan(0);
      expect(cell.evidence[0].source).toBeTruthy();
      expect(cell.evidence[0].retrievedAt).toBeTruthy();
    }
    expect(c.summary()).toEqual({ value: 1, true_zero: 1, unknown: 1, degraded: 1 });
  });

  it('an empty value in state "value" throws rather than rendering blank', () => {
    const empty = { state: 'value', value: '', evidence: EV } as GroundedField<string>;
    expect(() => renderField('§5 Empty', empty)).toThrow(AssemblyError);
  });

  it('a true_zero without a label throws', () => {
    const bad = { state: 'true_zero', value: 0, label: '', evidence: EV } as GroundedField<number>;
    expect(() => renderField('§9 Z', bad)).toThrow(AssemblyError);
  });
});
