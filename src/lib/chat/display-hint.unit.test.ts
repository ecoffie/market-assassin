import { describe, it, expect } from 'vitest';
import { parseDisplayHint, displayHintNote, NARROW_PANEL_NOTE } from './display-hint';
describe('display hint', () => {
  it('only the known value parses', () => {
    expect(parseDisplayHint('narrow_panel')).toBe('narrow_panel');
    for (const v of [undefined, null, '', 'wide', 'Narrow_Panel', 1, {}]) expect(parseDisplayHint(v)).toBeNull();
  });
  it('note for narrow_panel, nothing otherwise', () => {
    expect(displayHintNote('narrow_panel')).toBe(NARROW_PANEL_NOTE);
    expect(displayHintNote(null)).toBeNull();
    expect(NARROW_PANEL_NOTE).toMatch(/Where I would start/);
    expect(NARROW_PANEL_NOTE).toMatch(/presentation only/);
  });
});
