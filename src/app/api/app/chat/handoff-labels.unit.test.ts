/**
 * D1-a (review 2026-11-16): the add/save/track handoff line in Ask Mindy's system prompt names map-card
 * buttons. Every label it names must exist as a real button on the opportunity card, or the prompt sends
 * customers looking for a control that is not there (it once said "Save"; the card's control is
 * "Start pursuit"). If a label is renamed on the map, this fails until the prompt line is updated too.
 * #2093 added "Start a proposal" on the attached-notice chip; the line names it in the same release.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const chatRoute = readFileSync(join(__dirname, 'route.ts'), 'utf8');
const mapRoute = readFileSync(join(__dirname, '../../../opportunity-map/route.ts'), 'utf8');
const chatPanel = readFileSync(join(__dirname, '../../../../components/app/panels/MindyChatPanel.tsx'), 'utf8');

describe('handoff line names only real map-card buttons', () => {
  const line = chatRoute.split('\n').find((l) => l.includes('ADD / SAVE / TRACK requests')) ?? '';

  it('the handoff line exists', () => {
    expect(line).not.toBe('');
  });

  it('every quoted button label in the line is a real button', () => {
    const labels = [...line.matchAll(/"([^"]+)"/g)].map((m) => m[1]).filter((l) => l !== "I can't");
    expect(labels).toEqual(['Start pursuit', 'Generate proposal', 'Start a proposal']);
    // Map-card buttons.
    for (const label of ['Start pursuit', 'Generate proposal']) expect(mapRoute).toMatch(new RegExp(`<button[^>]*>${label}</button>`));
    // #2093: the attached-notice chip's button, on BOTH surfaces (map drawer and /app Ask Mindy).
    expect(mapRoute).toMatch(/<button[^>]*class="sp"[^>]*>Start a proposal<small>/);
    expect(chatPanel).toMatch(/: 'Start a proposal'\}/);
  });

  it('does not name a bare "Save button" (the SAM card has none)', () => {
    expect(line).not.toMatch(/Save button/);
  });
});
