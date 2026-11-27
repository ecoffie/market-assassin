import { describe, it, expect } from 'vitest';
import { createMarkupFilter } from './tool-markup-filter';

describe('tool-call markup never reaches the customer (preview 2026-11-25: an answer printed <invoke ...>)', () => {
  const run = (chunks: string[]) => { const f = createMarkupFilter(); return chunks.map((c) => f.push(c)).join('') + f.end(); };
  it('drops markup split across chunks and keeps ordinary text, including a plain "<"', () => {
    expect(run(['Here is what I found. ', '\n<inv', 'oke name="get_award_detail">\n<parameter name="piid">36C2', '4823P1623</parameter>\n</invoke>', ' Values < $5M are small.']))
      .toBe('Here is what I found. \n Values < $5M are small.');
  });
  it('drops <function_calls> blocks and an unclosed markup tail', () => {
    expect(run(['A <function_calls><invoke name="x"></invoke></function_calls>B'])).toBe('A B');
    expect(run(['Answer. <function_calls><invoke name="x">'])).toBe('Answer. ');
  });
  it('leaves normal answers byte-identical, including markdown and comparisons', () => {
    const text = '**Pursue it** if 3 < 5 and <b>bold</b> stays; tables | a | b |';
    expect(run([text.slice(0, 10), text.slice(10)])).toBe(text);
  });
});
