import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ASK_MINDY_ANSWER_FORMAT,
  ASK_MINDY_RULES_LAYER,
  askMindyRulesEnabledFor,
  askMindyRulesPromptBlock,
  rulesLayerFindContract,
} from './ask-mindy-rules';
import { CURRENT_FIND_CHAT_CONTRACT } from '@/lib/mcp/potato-journey';

afterEach(() => vi.unstubAllEnvs());

describe('ASK_MINDY_RULES_LAYER flag', () => {
  it('is off by default and for unknown values', () => {
    vi.stubEnv('ASK_MINDY_RULES_LAYER', '');
    expect(askMindyRulesEnabledFor('a@b.com')).toBe(false);
    vi.stubEnv('ASK_MINDY_RULES_LAYER', 'yes');
    expect(askMindyRulesEnabledFor('a@b.com')).toBe(false);
  });

  it("'true' turns it on for everyone", () => {
    vi.stubEnv('ASK_MINDY_RULES_LAYER', 'true');
    expect(askMindyRulesEnabledFor('anyone@x.com')).toBe(true);
  });

  it("'allowlist' turns it on only for listed verified emails", () => {
    vi.stubEnv('ASK_MINDY_RULES_LAYER', 'allowlist');
    vi.stubEnv('ASK_MINDY_RULES_ALLOWLIST', 'Tester@X.com, other@y.com');
    expect(askMindyRulesEnabledFor('tester@x.com')).toBe(true);
    expect(askMindyRulesEnabledFor('someone@x.com')).toBe(false);
    expect(askMindyRulesEnabledFor(null)).toBe(false);
  });
});

describe('rules layer text', () => {
  const block = askMindyRulesPromptBlock();

  it('contains no em dashes (the model copies punctuation it sees)', () => {
    expect(block).not.toMatch(/—/);
    expect(rulesLayerFindContract()).not.toMatch(/—/);
  });

  it('never asks the model for a fit score the backend does not compute yet', () => {
    expect(block).toMatch(/Never print a fit score/);
    expect(block).not.toMatch(/fit score of|score below the cutoff|scored below/i);
  });

  it('gates the PAE rule on a tool result (no PAE feed exists yet)', () => {
    expect(ASK_MINDY_RULES_LAYER).toMatch(/when a tool result names the Portfolio Acquisition Executive/);
    expect(ASK_MINDY_RULES_LAYER).toMatch(/do not guess/);
  });

  it('accepts the profile and the user\'s own statements as sources', () => {
    expect(ASK_MINDY_RULES_LAYER).toMatch(/tool result in this turn, the user profile, or what the user said about their own company/);
  });

  it('drops unsourced pain point and contact sections instead of filling them', () => {
    expect(ASK_MINDY_ANSWER_FORMAT).toMatch(/Leave out WHAT THE BUYER IS DEALING WITH when no tool returned/);
    expect(ASK_MINDY_ANSWER_FORMAT).toMatch(/Leave out WHO TO CONTACT when no tool returned/);
  });

  it('keeps Mindy plans and pricing out of answers (Eric, 2026-11-21: Mindy subscription only, not contract pricing)', () => {
    expect(ASK_MINDY_RULES_LAYER).toContain(
      '- Never mention Mindy plans, prices, seats or upgrades in an answer. Pricing lives on the pricing page, not in market intelligence.',
    );
  });

  it('bans the "ask me to list them" pattern', () => {
    expect(ASK_MINDY_RULES_LAYER).toMatch(/Never report a count and then say "ask me to list them\."/);
  });
});

describe('rules-layer FIND contract', () => {
  const contract = rulesLayerFindContract();

  it('keeps the shared classification and one-call rules verbatim', () => {
    for (const line of CURRENT_FIND_CHAT_CONTRACT.split('\n').filter((l) => /^- (Classify first|CURRENT FIND:)/.test(l))) {
      expect(contract).toContain(line);
    }
    expect(contract).toMatch(/solicitation number or notice id: call lookup_solicitation/);
  });

  it('replaces the shared list lengths with top 3 to 5 picks', () => {
    expect(contract).not.toMatch(/up to 10|top 10/);
    expect(contract).toMatch(/3 to 5 best fits/);
  });

  it('keeps unavailable-is-not-zero and the competition label rules', () => {
    expect(contract).toMatch(/unavailable, never zero/);
    expect(contract).toMatch(/competition\.label/);
    expect(contract).toMatch(/never "full and open"/);
  });

  it('leaves the shared MCP contract untouched', () => {
    expect(CURRENT_FIND_CHAT_CONTRACT).toMatch(/up to 10/);
  });
});

describe('chat route wiring', () => {
  const route = readFileSync(join(__dirname, '../../app/api/app/chat/route.ts'), 'utf8');

  it('adds the rules layer only when the flag is on for the verified email', () => {
    expect(route).toMatch(/const rulesLayer = askMindyRulesEnabledFor\(auth\.email\);/);
    expect(route).toMatch(/const findContract = rulesLayer \? rulesLayerFindContract\(\) : CURRENT_FIND_CHAT_CONTRACT;/);
    // Merged with #2204: an FMP ask keeps its own contract and gets only the rules, never the answer format.
    expect(route).toMatch(/const rulesBlock = !rulesLayer \? '' : federalMarketProfileAsk \? `\\n\\n\$\{ASK_MINDY_RULES_LAYER\}` : `\\n\\n\$\{askMindyRulesPromptBlock\(\)\}`;/);
    expect(route).toMatch(/\+ hostContract\n\s+\+ rulesBlock;/);
  });
});
