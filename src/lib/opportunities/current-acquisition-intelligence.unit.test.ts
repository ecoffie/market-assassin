/**
 * Unit + red-team tests for Current Acquisition Intelligence v0.
 */
import { describe, it, expect } from 'vitest';
import {
  applyCausalKillerRule,
  textEstablishesCso,
  textEstablishesOtherTransaction,
  isConventionalSolicitationNoticeType,
  classifyObservedPathways,
  rejectUnsupportedObservedPathway,
  CAI_NEXT_PROMPT,
  type CaiItem,
} from './current-acquisition-intelligence';

describe('applyCausalKillerRule', () => {
  const baseChange: CaiItem = {
    id: 'chg_01',
    epistemic: 'observed_change',
    statement: 'A contract field moved.',
    citations: [{ source_kind: 'recompete_changes', source_id: '1', locator: 'x', as_of: null }],
  };
  const baseSee: CaiItem = {
    id: 'see_01',
    epistemic: 'current_state',
    statement: 'Open demand exists.',
    citations: [{ source_kind: 'sam_opportunities', source_id: 'n1', locator: 'y', as_of: null }],
  };

  it('drops do_differently when caused_by points at missing id', () => {
    const badAction: CaiItem = {
      id: 'act_bad',
      epistemic: 'do_differently',
      statement: 'Do something generic.',
      citations: [],
      caused_by: ['chg_99'],
    };
    const out = applyCausalKillerRule({
      what_changed: [baseChange],
      what_we_are_seeing_now: [baseSee],
      what_that_may_mean: [],
      do_differently: [badAction],
    });
    expect(out.do_differently).toHaveLength(0);
  });

  it('drops supported_implication when caused_by is empty', () => {
    const badImp: CaiItem = {
      id: 'imp_bad',
      epistemic: 'supported_implication',
      statement: 'Unearned inference.',
      citations: [],
      caused_by: [],
    };
    const out = applyCausalKillerRule({
      what_changed: [baseChange],
      what_we_are_seeing_now: [],
      what_that_may_mean: [badImp],
      do_differently: [],
    });
    expect(out.what_that_may_mean).toHaveLength(0);
  });

  it('keeps actions when every caused_by id is cited in change/state', () => {
    const goodAction: CaiItem = {
      id: 'act_ok',
      epistemic: 'do_differently',
      statement: 'Engage now.',
      citations: [],
      caused_by: ['chg_01', 'see_01'],
    };
    const out = applyCausalKillerRule({
      what_changed: [baseChange],
      what_we_are_seeing_now: [baseSee],
      what_that_may_mean: [],
      do_differently: [goodAction],
    });
    expect(out.do_differently).toHaveLength(1);
    expect(out.do_differently[0].id).toBe('act_ok');
  });

  it('removing causal source id drops dependent recommendation', () => {
    const action: CaiItem = {
      id: 'act_dep',
      epistemic: 'do_differently',
      statement: 'Act on the change.',
      citations: [],
      caused_by: ['chg_01'],
    };
    const withChange = applyCausalKillerRule({
      what_changed: [baseChange],
      what_we_are_seeing_now: [],
      what_that_may_mean: [],
      do_differently: [action],
    });
    expect(withChange.do_differently).toHaveLength(1);

    const withoutChange = applyCausalKillerRule({
      what_changed: [],
      what_we_are_seeing_now: [],
      what_that_may_mean: [],
      do_differently: [action],
    });
    expect(withoutChange.do_differently).toHaveLength(0);
  });
});

describe('pathway classifiers', () => {
  it('textEstablishesCso matches CSO phrases', () => {
    expect(textEstablishesCso('Commercial Solutions Opening for cyber')).toBe(true);
    expect(textEstablishesCso('CSO phase II')).toBe(true);
    expect(textEstablishesCso('commercial services only')).toBe(false);
  });

  it('textEstablishesOtherTransaction rejects bare OTA', () => {
    expect(textEstablishesOtherTransaction('OTA prototype agreement')).toBe(true);
    expect(textEstablishesOtherTransaction('other transaction for research')).toBe(true);
    expect(textEstablishesOtherTransaction('OTA only')).toBe(false);
  });

  it('isConventionalSolicitationNoticeType rejects Special Notice alone', () => {
    expect(isConventionalSolicitationNoticeType('Special Notice', 'Industry day announcement')).toBe(false);
    expect(isConventionalSolicitationNoticeType('Combined Synopsis/Solicitation', 'IT support')).toBe(true);
  });

  it('rejects consortium as observed pathway kind', () => {
    expect(rejectUnsupportedObservedPathway('consortium')).toBe(true);
    expect(rejectUnsupportedObservedPathway('conventional_solicitation')).toBe(false);
  });

  it('classifyObservedPathways never emits consortium as observed', () => {
    const { observed, potential_not_established } = classifyObservedPathways(
      [
        {
          notice_type: 'Special Notice',
          title: 'DIU consortium partnership',
          description: 'consortium rapid office',
          source_kind: 'sam_opportunities',
          source_id: 'x',
          locator: 'sam_opportunities.notice_id=x',
          as_of: null,
        },
      ],
      'USSOCOM',
      'cybersecurity',
    );
    expect(observed.some((o) => rejectUnsupportedObservedPathway(o.kind))).toBe(false);
    expect(potential_not_established.some((p) => p.kind === 'consortium')).toBe(true);
  });
});

describe('CAI_NEXT_PROMPT', () => {
  it('has no set-aside-first language', () => {
    expect(CAI_NEXT_PROMPT.toLowerCase()).not.toMatch(/set-aside|set aside|8\(a\)|sdvosb|wosb/);
    expect(CAI_NEXT_PROMPT).toMatch(/doors your company can actually walk through/);
  });
});

describe('empty what_changed is OK', () => {
  it('killer rule allows empty change list with valid current-state actions only', () => {
    const see: CaiItem = {
      id: 'see_02',
      epistemic: 'current_state',
      statement: 'Concentration at one office.',
      citations: [{ source_kind: 'sam_opportunities', source_id: 'a', locator: 'z', as_of: null }],
    };
    const action: CaiItem = {
      id: 'act_02',
      epistemic: 'do_differently',
      statement: 'Focus on that office.',
      citations: [],
      caused_by: ['see_02'],
    };
    const out = applyCausalKillerRule({
      what_changed: [],
      what_we_are_seeing_now: [see],
      what_that_may_mean: [],
      do_differently: [action],
    });
    expect(out.do_differently).toHaveLength(1);
  });
});
