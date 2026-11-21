import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NEXT_STEP_SYSTEM_PROMPT, filterNextSteps, isGroundedNextStep } from './next-step-buttons';

const llm = vi.hoisted(() => ({ text: '', calls: [] as Array<{ system: string; maxTokens?: number }> }));
vi.mock('@/lib/llm/call-llm', () => ({
  callLLM: async (args: { system: string; maxTokens?: number }) => { llm.calls.push(args); return { text: llm.text }; },
}));
import { generateFollowups } from './followup-suggestions';

// A rules-layer-shaped answer (spec section 8 format), with real-looking items to ground buttons on.
const ANSWER = `Two Tennessee staffing contracts come back in the next year, and the Army small business day on December 9 is your shortest route in.

TOP PICKS (ranked by fit for Superb Staffing Solutions)
1. Administrative Clerk Support, Fort Campbell, $2.1M, ends Feb. 28, 2027, likely recompete
   Why it fits: Matches your clerk staffing work; set aside for small business.
   Pathway: small business set-aside.
2. Laboratory Staffing Services, Memphis VA Medical Center, 36C24927Q0113, forecast, solicitation expected Q2 2027
   Why it fits: Same buyer type as your past VA work; in Memphis.
   Pathway: GSA Schedule.

WHO TO CONTACT
Jane Ortiz, Small Business Specialist, Army Contracting Command. Ask whether the clerk follow-on stays a set-aside.

NEXT MOVE
Register for the Army small business day on December 9.`;

afterEach(() => { llm.text = ''; llm.calls = []; });

describe('isGroundedNextStep: the spec examples', () => {
  it('keeps the spec "Instead" column', () => {
    expect(isGroundedNextStep('Build my plan for the Army small business day on December 9', ANSWER)).toBe(true);
    expect(isGroundedNextStep('Draft a capability email to the contracting officer for pick #1', ANSWER)).toBe(true);
    expect(isGroundedNextStep('Who holds the Administrative Clerk Support contract now, and do they subcontract?', ANSWER)).toBe(true);
  });

  it('drops generic buttons that would fit any answer', () => {
    expect(isGroundedNextStep('Find open opportunities at Department of Defense', ANSWER)).toBe(false);
    expect(isGroundedNextStep('Who is the incumbent?', ANSWER)).toBe(false);
    expect(isGroundedNextStep('Show me more small business opportunities', ANSWER)).toBe(false);
  });

  it('grounds on a solicitation number only when the answer has it', () => {
    expect(isGroundedNextStep('Pull the documents for 36C24927Q0113', ANSWER)).toBe(true);
    expect(isGroundedNextStep('Pull the documents for 36C24927Q9999', ANSWER)).toBe(false);
  });

  it('grounds on a pick number only when the answer shows that pick', () => {
    expect(isGroundedNextStep('Who is the incumbent on pick #2?', ANSWER)).toBe(true);
    expect(isGroundedNextStep('Who is the incumbent on pick #4?', ANSWER)).toBe(false);
  });

  it('never sends the user to another website or asks chat to save or track', () => {
    expect(isGroundedNextStep('Check SAM.gov for the Fort Campbell notice', ANSWER)).toBe(false);
    expect(isGroundedNextStep('Visit the Memphis VA website', ANSWER)).toBe(false);
    expect(isGroundedNextStep('Save Laboratory Staffing Services to my pipeline', ANSWER)).toBe(false);
    expect(isGroundedNextStep('Track the Fort Campbell recompete', ANSWER)).toBe(false);
  });

  it('a name the answer does not contain does not ground a button', () => {
    expect(isGroundedNextStep('Draft an email to Ranco Construction', ANSWER)).toBe(false);
    expect(isGroundedNextStep('Draft an email to Jane Ortiz about the clerk follow-on', ANSWER)).toBe(true);
  });
});

describe('filterNextSteps', () => {
  it('keeps grounded buttons in order, drops duplicates, caps at three, never pads', () => {
    const out = filterNextSteps([
      'Find open opportunities at Department of Defense',
      'Draft a capability email to the contracting officer for pick #1',
      'draft a capability email to the contracting officer for pick #1',
      'Build my plan for the Army small business day on December 9',
    ], ANSWER);
    expect(out).toEqual([
      'Draft a capability email to the contracting officer for pick #1',
      'Build my plan for the Army small business day on December 9',
    ]);
  });
});

describe('the prompt', () => {
  it('carries the spec pattern and bans', () => {
    expect(NEXT_STEP_SYSTEM_PROMPT).toMatch(/MUST name one specific item from the answer/);
    expect(NEXT_STEP_SYSTEM_PROMPT).toMatch(/Find open opportunities at Department of Defense/);
    expect(NEXT_STEP_SYSTEM_PROMPT).toMatch(/cannot save, track or add anything/);
    expect(NEXT_STEP_SYSTEM_PROMPT).not.toMatch(/—/);
  });
});

describe('generateFollowups', () => {
  const MODEL = JSON.stringify({ suggestions: [
    'Find open opportunities at Department of Defense',
    'Who holds the Administrative Clerk Support contract now?',
    'Check SAM.gov for updates',
  ] });

  it('off (default): the existing prompt and no grounding filter, unchanged', async () => {
    llm.text = MODEL;
    const out = await generateFollowups('What should we go after?', ANSWER);
    expect(llm.calls[0].system).toMatch(/^You suggest the NEXT action/);
    expect(out).toEqual(['Find open opportunities at Department of Defense', 'Who holds the Administrative Clerk Support contract now?', 'Check SAM.gov for updates']);
  });

  it('rules layer on: the spec prompt, and only grounded buttons survive', async () => {
    llm.text = MODEL;
    const out = await generateFollowups('What should we go after?', ANSWER, { rulesLayer: true });
    expect(llm.calls[0].system).toBe(NEXT_STEP_SYSTEM_PROMPT);
    expect(out).toEqual(['Who holds the Administrative Clerk Support contract now?']);
  });
});

describe('suggestions route wiring', () => {
  it('passes the rules-layer flag for the verified email', () => {
    const route = readFileSync(join(__dirname, '../../app/api/app/chat/suggestions/route.ts'), 'utf8');
    expect(route).toMatch(/generateFollowups\(message, answer, \{ userEmail: auth\.email, rulesLayer: askMindyRulesEnabledFor\(auth\.email\) \}\)/);
  });
});
