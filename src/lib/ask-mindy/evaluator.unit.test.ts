import { describe, it, expect } from 'vitest';
import { softwareChecks } from './evaluator';
import type { RecordCheck } from './evidence-checks';
import type { AnalystDecision } from './analyst';

const chk = (id: string, verdict: RecordCheck['verdict']): RecordCheck => ({ contract_id: id, verdict, exclusions: [], barriers: [], actions: [] });
const dec = (ids: string[], move = 'Check SAM.gov now'): AnalystDecision => ({
  headline: 'h', ruled_out: 'r', gaps: [], next_question: 'q',
  pursuits: ids.map((contract_id) => ({ contract_id, title: 't', why: ['w'], barrier: null, next_move: move })),
});
const byName = (r: ReturnType<typeof softwareChecks>) => Object.fromEntries(r.map((x) => [x.criterion, x.pass]));

describe('softwareChecks (gate checks 1 and 2)', () => {
  const checks = [chk('A', 'pursue'), chk('B', 'out_of_scope'), chk('C', 'blocked')];
  it('passes when every pursuit passed the record checks and has a move', () => {
    expect(byName(softwareChecks(dec(['A']), checks))).toEqual({ relevant: true, pursuable: true });
  });
  it('fails when a pursuit is out of scope or blocked', () => {
    expect(byName(softwareChecks(dec(['A', 'B']), checks)).relevant).toBe(false);
    expect(byName(softwareChecks(dec(['C']), checks)).pursuable).toBe(false);
  });
  it('fails "none found" when a record did pass', () => {
    expect(byName(softwareChecks(dec([]), checks)).relevant).toBe(false);
  });
  it('passes an honest "none found" when nothing passed', () => {
    expect(byName(softwareChecks(dec([]), [chk('B', 'out_of_scope')])).relevant).toBe(true);
  });
  it('fails a pursuit with an empty move', () => {
    expect(byName(softwareChecks(dec(['A'], '  '), checks)).pursuable).toBe(false);
  });
});
