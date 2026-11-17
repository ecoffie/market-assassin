/** The follow-up prompt must not tell the model chat can write to a pipeline or target list: chat has
 * only read tools (chat-tool-policy CHAT_PRIVATE_READ_TOOLS), so such a chip would promise an action
 * Mindy cannot take. */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = readFileSync(join(__dirname, 'followup-suggestions.ts'), 'utf8');

describe('follow-up suggestion prompt', () => {
  it('does not claim chat can add items to a pipeline or target list', () => {
    expect(src).not.toMatch(/add items to a pipeline/i);
    expect(src).not.toMatch(/add to my pipeline/i);
  });
  it('tells the model not to suggest saving or tracking', () => {
    expect(src).toMatch(/cannot save, track or add anything to a pipeline or target list/);
  });
});
