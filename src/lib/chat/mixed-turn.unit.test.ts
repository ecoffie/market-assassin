import { describe, it, expect } from 'vitest';
import { splitMixedAnswer, dropRecordRestatements, composeMixedAnswer, mixedTurnNote, MIXED_TURN_MARKER } from './mixed-turn';
import type { RenderedRecords } from './record-render';

const rendered = [{ tool: 'get_expiring_contracts', text: 'LIST', ids: ['36C24927C0001', 'A1'], total: 1, retrieved: 1, from: 1, to: 1, shown: 1, exhaustive: true } as unknown as RenderedRecords];

describe('splitMixedAnswer', () => {
  it.each([
    ['A fact.\nNEXT STEPS:\nDo X.', 'A fact.', 'Do X.'],
    ['A fact.\n**NEXT STEPS:**\nDo X.', 'A fact.', 'Do X.'],
    ['A fact.\nNext steps: Do X.', 'A fact.', 'Do X.'],
  ])('splits %j', (input, summary, next) => {
    expect(splitMixedAnswer(input)).toEqual({ summary, nextSteps: next, markerFound: true });
  });
  it('without a marker everything is part 1', () => {
    expect(splitMixedAnswer('Only facts.')).toEqual({ summary: 'Only facts.', nextSteps: '', markerFound: false });
  });
});

describe('dropRecordRestatements', () => {
  it('drops a sentence naming a rendered id, keeps the rest, ignores short ids', () => {
    const r = dropRecordRestatements('DOE has 12 awards. Contract 36c24927c0001 ends soon. Plan A1 later.', rendered);
    expect(r.text).toBe('DOE has 12 awards. Plan A1 later.');
    expect(r.dropped).toEqual(['Contract 36c24927c0001 ends soon.']);
  });
  it('does not match an id inside a longer token', () => {
    expect(dropRecordRestatements('Ref X36C24927C0001Y is unrelated.', rendered).text).toBe('Ref X36C24927C0001Y is unrelated.');
  });
});

describe('composeMixedAnswer', () => {
  it('keeps part 1 facts and lints part 2', () => {
    const r = composeMixedAnswer('DOE lists grid work for 2026.\nNEXT STEPS:\nYou have 3 great records. Open each record.', rendered, 'FALLBACK');
    expect(r.text).toBe('DOE lists grid work for 2026.\n\nOpen each record.');
    expect(r.nextStepsText).toBe('Open each record.');
  });
  it('uses the fallback when nothing survives', () => {
    expect(composeMixedAnswer('Contract 36C24927C0001 is big.', rendered, 'FALLBACK').text).toBe('FALLBACK');
  });
});

describe('mixedTurnNote', () => {
  it('names the unshown tools (with failure status) and carries the rendered lists', () => {
    const n = mixedTurnNote(rendered, [{ tool: 'find_opportunities', status: 'success' }, { tool: 'get_agency_intel', status: 'failed' }]);
    expect(n).toContain('NOT shown to the user: find_opportunities, get_agency_intel (did not return data: failed)');
    expect(n).toContain(MIXED_TURN_MARKER);
    expect(n.endsWith('LIST')).toBe(true);
  });
});
