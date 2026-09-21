import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * THE ACTIVATION GAP, measured 2026-08-23 (the day after launch):
 *
 *   109 connected Mindy to their assistant
 *    35 ever asked it anything
 *    74 NEVER DID -- with zero errors and zero credit rejections between them
 *
 * Nothing failed for those 74. The setup guide ended at "you're connected", which is a dead
 * end, and the MCP asked them to invent a question from nothing -- inconsistent with the
 * product's own premise that discovery beats search.
 */
const SRC = readFileSync(join(__dirname, 'FirstQuestions.tsx'), 'utf8');
const PAGE = readFileSync(join(__dirname, 'page.tsx'), 'utf8');

describe('the setup guide ends with a question, not a dead end', () => {
  it('is wired into the page', () => {
    expect(PAGE).toContain('<FirstQuestions />');
    expect(PAGE).toContain('Ask Mindy your first question');
  });

  it('offers three JOBS, never tool names', () => {
    // A contractor should not need to know a tool exists. 54 tools, three questions.
    for (const job of ['Find opportunities', 'Understand my market', 'Get ahead']) {
      expect(SRC).toContain(job);
    }
    for (const tool of ['search_sam_opportunities', 'assess_market_depth', 'get_expiring_contracts']) {
      expect(SRC).not.toContain(tool);
    }
  });

  it('degrades to a working generic question when the market is unknown', () => {
    // A half-personalised question ("NAICS undefined") is worse than a general one, so every
    // job carries a fallback string that stands on its own.
    const fallbacks = SRC.match(/: '[A-Z][^']{40,}'/g) || [];
    expect(fallbacks.length).toBeGreaterThanOrEqual(3);
  });

  it('reads the profile field the API actually returns', () => {
    // The route maps naics_codes -> naicsCodes on the way out. Reading the snake_case name
    // would silently never personalise -- the exact class of bug this codebase spent the day
    // removing.
    expect(SRC).toContain('profile?.naicsCodes');
    expect(SRC).not.toContain('profile?.naics_codes');
  });

  it('sends the session headers the profile GET requires', () => {
    // GET /api/app/profile calls verifyUserSession and 401s without them.
    expect(SRC).toContain('x-mi-auth-token');
    expect(SRC).toContain('mi_beta_auth_token');
  });

  it('never lets a personalisation failure break the block', () => {
    expect(SRC).toMatch(/\.catch\(\(\) => \{ \/\* generic questions stand \*\/ \}\)/);
  });
});
