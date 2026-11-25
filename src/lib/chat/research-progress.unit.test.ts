import { describe, it, expect } from 'vitest';
import { addProgress, startProgress, formatElapsed, currentLine, summaryLine, RESEARCH_STEP_CAP } from './research-progress';

describe('research-progress', () => {
  it('de-duplicates steps, counts every event, caps the list', () => {
    let p = startProgress(0);
    for (let i = 0; i < RESEARCH_STEP_CAP + 5; i++) p = addProgress(p, { message: `Checking tool ${i}.` }, i);
    p = addProgress(p, { message: `Checking tool ${RESEARCH_STEP_CAP + 4}.` }, 99);
    expect(p.steps.length).toBe(RESEARCH_STEP_CAP);
    expect(p.total).toBe(RESEARCH_STEP_CAP + 6);
    expect(p.steps[p.steps.length - 1].count).toBe(2);
  });
  it('phase is a headline; a later step clears it; blank messages ignored', () => {
    let p = addProgress(startProgress(0), { message: 'Writing the answer.', phase: 'writing' }, 1);
    expect(currentLine(p)).toBe('Writing the answer.');
    expect(p.total).toBe(0);
    p = addProgress(p, { message: '   ' }, 2);
    expect(p.lastEventAt).toBe(1);
    p = addProgress(p, { message: 'Checking awards.' }, 3);
    expect(currentLine(p)).toBe('Checking awards.');
    expect(addProgress(p, { message: 'x', phase: 'bogus' }, 4).steps.length).toBe(2);
  });
  it('formats time and the summary', () => {
    expect(formatElapsed(7_900)).toBe('0:07');
    expect(formatElapsed(725_000)).toBe('12:05');
    const p = addProgress(startProgress(0), { message: 'a' }, 0);
    expect(summaryLine(p, 222_000)).toBe('Researched · 1 step · 3:42');
  });
});
