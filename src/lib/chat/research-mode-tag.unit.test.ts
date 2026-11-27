import { describe, it, expect } from 'vitest';
import { researchTagFromEvent, researchTagFromTrace, cleanResearchLabel, RESEARCH_BETA_LABEL_DEFAULT } from './research-mode-tag';

describe('research mode tag', () => {
  it('a research-beta mode event gives its label; anything else gives null', () => {
    expect(researchTagFromEvent({ type: 'mode', mode: 'research', beta: true, label: 'Research · Beta' })).toBe('Research · Beta');
    expect(researchTagFromEvent({ type: 'mode', mode: 'research', beta: false, label: 'x' })).toBeNull();
    expect(researchTagFromEvent({ type: 'mode', mode: 'standard', beta: true })).toBeNull();
    expect(researchTagFromEvent({ type: 'token', content: 'hi' })).toBeNull();
    expect(researchTagFromEvent(null)).toBeNull();
  });
  it('a saved research-beta trace gives only { label }', () => {
    expect(researchTagFromTrace({ engine: 'research_mode', beta: true, label: 'Research · Beta', model: 'm', calls: [1] })).toEqual({ label: 'Research · Beta' });
    expect(researchTagFromTrace({ engine: 'research_mode' })).toBeNull();
    expect(researchTagFromTrace({ engine: 'standard', beta: true })).toBeNull();
    expect(researchTagFromTrace(null)).toBeNull();
  });
  it('labels are plain, bounded, and fall back to the default', () => {
    expect(cleanResearchLabel('  Research\n·  Beta ')).toBe('Research · Beta');
    expect(cleanResearchLabel('x'.repeat(41))).toBe(RESEARCH_BETA_LABEL_DEFAULT);
    expect(cleanResearchLabel(7)).toBe(RESEARCH_BETA_LABEL_DEFAULT);
    expect(cleanResearchLabel('')).toBe(RESEARCH_BETA_LABEL_DEFAULT);
  });
});
